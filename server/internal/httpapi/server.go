// Package httpapi is the HTTP surface of the server. It is API-only: the
// frontend is hosted on GitHub Pages and talks to this cross-origin.
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/config"
	"github.com/osos3lom/videoscroll/server/internal/jobs"
	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/store"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

type Server struct {
	cfg    config.Config
	layout media.Layout
	index  *media.Index
	users  *users.Store
	signer *auth.Signer
	jobs   *jobs.Manager

	// os.Root confines every media open to its directory, whatever the id
	// decodes to.
	videosRoot  *os.Root
	postersRoot *os.Root

	// Login failures, counted per address, per (address, account), and per
	// account. See handleLogin.
	loginByIP   *auth.Limiter
	loginByPair *auth.Limiter
	loginByUser *auth.Limiter
	joinByIP    *auth.Limiter

	social    map[string]json.RawMessage
	startedAt time.Time
}

type Deps struct {
	Config config.Config
	Layout media.Layout
	Index  *media.Index
	Users  *users.Store
	Signer *auth.Signer
	Jobs   *jobs.Manager
}

func New(d Deps) (*Server, error) {
	videosRoot, err := os.OpenRoot(d.Layout.Videos)
	if err != nil {
		return nil, err
	}
	postersRoot, err := os.OpenRoot(d.Layout.Posters)
	if err != nil {
		return nil, err
	}

	s := &Server{
		cfg: d.Config, layout: d.Layout, index: d.Index, users: d.Users, signer: d.Signer, jobs: d.Jobs,
		videosRoot:  videosRoot,
		postersRoot: postersRoot,
		loginByIP:   auth.NewLimiter(20, 15*time.Minute),
		loginByPair: auth.NewLimiter(10, 15*time.Minute),
		// High enough that locking an account out takes a botnet.
		loginByUser: auth.NewLimiter(200, 15*time.Minute),
		joinByIP:    auth.NewLimiter(10, 15*time.Minute),
		social:      map[string]json.RawMessage{},
		startedAt:   time.Now(),
	}
	// Legacy per-video like/bookmark counts, read once.
	_, _ = store.ReadJSON(filepath.Join(d.Layout.Data, "social.json"), &s.social)
	return s, nil
}

// Close releases the directory handles held by the media roots.
func (s *Server) Close() {
	_ = s.videosRoot.Close()
	_ = s.postersRoot.Close()
}

func (s *Server) SweepLimiters() {
	s.loginByIP.Sweep()
	s.loginByPair.Sweep()
	s.loginByUser.Sweep()
	s.joinByIP.Sweep()
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/join", s.handleJoin)
	// Reachable while a password change is pending (see requireUser).
	mux.HandleFunc("GET /api/auth/me", s.requireSession(s.handleMe))
	mux.HandleFunc("POST /api/auth/logout-all", s.requireSession(s.handleLogoutAll))
	mux.HandleFunc("POST /api/auth/password", s.requireSession(s.handleChangePassword))
	mux.HandleFunc("PATCH /api/auth/me", s.requireUser(s.handleUpdateMe))

	mux.HandleFunc("GET /api/videos", s.requireUser(s.handleListVideos))
	mux.HandleFunc("PATCH /api/videos/{id}", s.requireUser(s.handleUpdateVideo))
	mux.HandleFunc("DELETE /api/videos/{id}", s.requireUser(s.handleDeleteVideo))

	// GET patterns also match HEAD.
	mux.HandleFunc("GET /api/video/{id}", s.requireMedia(s.handleVideo))
	mux.HandleFunc("GET /api/poster/{id}", s.requireMedia(s.handlePoster))

	mux.HandleFunc("POST /api/uploads", s.requireUploader(s.handleCreateUpload))
	mux.HandleFunc("PUT /api/uploads/{id}", s.requireUploader(s.handleAppendUpload))
	mux.HandleFunc("GET /api/uploads/{id}", s.requireUser(s.handleGetUpload))
	mux.HandleFunc("DELETE /api/uploads/{id}", s.requireUser(s.handleCancelUpload))

	mux.HandleFunc("GET /api/admin/status", s.requireOwner(s.handleStatus))
	mux.HandleFunc("GET /api/admin/users", s.requireOwner(s.handleListUsers))
	mux.HandleFunc("POST /api/admin/users", s.requireOwner(s.handleCreateUser))
	mux.HandleFunc("PATCH /api/admin/users/{id}", s.requireOwner(s.handleUpdateUser))
	mux.HandleFunc("DELETE /api/admin/users/{id}", s.requireOwner(s.handleDeleteUser))
	mux.HandleFunc("POST /api/admin/users/{id}/password", s.requireOwner(s.handleResetPassword))
	mux.HandleFunc("POST /api/admin/users/{id}/revoke", s.requireOwner(s.handleRevokeUser))
	mux.HandleFunc("GET /api/admin/invites", s.requireOwner(s.handleListInvites))
	mux.HandleFunc("POST /api/admin/invites", s.requireOwner(s.handleCreateInvite))
	mux.HandleFunc("DELETE /api/admin/invites/{id}", s.requireOwner(s.handleDeleteInvite))

	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})

	return s.securityHeaders(s.cors(mux))
}

// cors allows the configured frontend origins. Two details matter:
//
//   - Media is loaded in CORS mode (<video crossorigin>), so video and poster
//     responses need Access-Control-Allow-Origin like everything else.
//   - Vary: Origin goes on every response, not only CORS ones, so a response
//     cached for one origin is never replayed to another.
//   - No Allow-Credentials: auth is a bearer header or a query token, never a
//     cookie.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Add("Vary", "Origin")

		origin := r.Header.Get("Origin")
		allowed := origin != "" && slices.Contains(s.cfg.AllowedOrigins, origin)

		if allowed {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, ETag")
		}

		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			if !allowed {
				writeError(w, http.StatusForbidden, "origin not allowed")
				return
			}
			h.Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Range, If-Range, If-None-Match, Upload-Offset")
			h.Set("Access-Control-Max-Age", "7200")
			// Chrome's private/local network access check, for when the API
			// resolves to a LAN or Tailscale address.
			if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
				h.Set("Access-Control-Allow-Private-Network", "true")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Robots-Tag", "noindex, nofollow")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		// Media is embedded by the Pages origin, so it must be loadable
		// cross-origin; authorization is enforced by the token, not by CORP.
		h.Set("Cross-Origin-Resource-Policy", "cross-origin")
		next.ServeHTTP(w, r)
	})
}

// ----------------------------------------------------------------- helpers --

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Debug("write response", "err", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message, "code": errorCode(status, message)})
}

// jsonBodyTimeout bounds how long a client may take to send a JSON body. The
// server has no global ReadTimeout (it would cut off uploads and streams), so
// without this a trickling body would hold its goroutine forever.
var jsonBodyTimeout = 30 * time.Second

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(jsonBodyTimeout))
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

type userHandler func(http.ResponseWriter, *http.Request, users.User)

// authenticate validates a token and then the user it names: the account
// must exist, be enabled, and still be on the version the token was issued
// for. That last check is what makes stateless tokens revocable.
func (s *Server) authenticate(token string, scope auth.Scope) (users.User, error) {
	if token == "" {
		return users.User{}, auth.ErrInvalidToken
	}
	claims, err := s.signer.Verify(token, scope)
	if err != nil {
		return users.User{}, err
	}
	user, ok := s.users.Get(claims.UserID)
	if !ok || user.Disabled || user.Ver != claims.Ver {
		return users.User{}, auth.ErrInvalidToken
	}
	return user, nil
}

// codePasswordChangeRequired tells the app to show the "choose your
// password" screen instead of an error.
const codePasswordChangeRequired = "password_change_required"

// requireUser admits a signed-in user who has a password of their own.
// Someone still on an owner-set temporary password can only use the routes
// wrapped in requireSession, i.e. change it.
func (s *Server) requireUser(next userHandler) http.HandlerFunc {
	return s.requireSession(func(w http.ResponseWriter, r *http.Request, user users.User) {
		if user.MustChangePassword {
			writeJSON(w, http.StatusForbidden, map[string]string{
				"error": "choose a new password first",
				"code":  codePasswordChangeRequired,
			})
			return
		}
		next(w, r, user)
	})
}

// requireSession admits any valid session, including one whose password
// change is still pending.
func (s *Server) requireSession(next userHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.authenticate(bearerToken(r), auth.ScopeSession)
		if err != nil {
			message := "sign in required"
			if errors.Is(err, auth.ErrExpiredToken) {
				message = "session expired"
			}
			writeError(w, http.StatusUnauthorized, message)
			return
		}
		next(w, r, user)
	}
}

func (s *Server) requireUploader(next userHandler) http.HandlerFunc {
	return s.requireUser(func(w http.ResponseWriter, r *http.Request, u users.User) {
		if !u.Role.CanUpload() {
			writeError(w, http.StatusForbidden, "your account cannot upload")
			return
		}
		next(w, r, u)
	})
}

func (s *Server) requireOwner(next userHandler) http.HandlerFunc {
	return s.requireUser(func(w http.ResponseWriter, r *http.Request, u users.User) {
		if u.Role != users.RoleOwner {
			writeError(w, http.StatusForbidden, "owner only")
			return
		}
		next(w, r, u)
	})
}

// requireMedia authenticates <video> and poster loads, which cannot send an
// Authorization header, by a media-scoped token in the `t` query parameter.
func (s *Server) requireMedia(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.authenticate(r.URL.Query().Get("t"), auth.ScopeMedia)
		if err == nil && user.MustChangePassword {
			err = auth.ErrInvalidToken
		}
		if err != nil {
			writeError(w, http.StatusUnauthorized, "media token invalid or expired")
			return
		}
		next(w, r)
	}
}
