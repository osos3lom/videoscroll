package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/shares"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// publicStreamSlots caps concurrent video bytes sent to people without an
// account, so a link that spreads cannot use up the home connection members
// need. A browser often holds two requests for one video (the stream and a
// seek to the index at the end), so 6 is about three viewers.
const publicStreamSlots = 6

// ShareView is mirrored by `ShareView` in src/types/api.ts.
type ShareView struct {
	ID            string     `json:"id"`
	VideoID       string     `json:"videoId"`
	Title         string     `json:"title"`
	CreatedBy     string     `json:"createdBy"`
	CreatedByName string     `json:"createdByName"`
	CreatedAt     time.Time  `json:"createdAt"`
	ExpiresAt     *time.Time `json:"expiresAt,omitempty"`
}

// PublicShare is mirrored by `PublicShare` in src/types/api.ts. It is all a
// person without an account learns: no ids, names, or file names.
type PublicShare struct {
	Title     string     `json:"title"`
	Width     int        `json:"width"`
	Height    int        `json:"height"`
	Duration  float64    `json:"duration"`
	Size      int64      `json:"size"`
	Ext       string     `json:"ext"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

func (s *Server) shareView(share shares.Share, meta media.Meta) ShareView {
	view := ShareView{
		ID: share.ID, VideoID: share.VideoID, Title: meta.Title,
		CreatedBy: share.CreatedBy, CreatedAt: share.CreatedAt, ExpiresAt: share.ExpiresAt,
	}
	if creator, ok := s.users.Get(share.CreatedBy); ok {
		view.CreatedByName = creator.DisplayName
	}
	return view
}

// ------------------------------------------------------------ for members --

var shareDays = map[int]time.Duration{0: 0, 1: 24 * time.Hour, 7: 7 * 24 * time.Hour, 30: 30 * 24 * time.Hour}

func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		VideoID       string `json:"videoId"`
		ExpiresInDays int    `json:"expiresInDays"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	ttl, ok := shareDays[body.ExpiresInDays]
	if !ok {
		writeError(w, http.StatusBadRequest, "expiry must be 1, 7 or 30 days, or 0 for no expiry")
		return
	}
	meta, ok := s.index.Get(body.VideoID)
	if !ok {
		writeError(w, http.StatusNotFound, "video not found")
		return
	}
	code, share, err := s.shares.Create(meta.VideoID, user.ID, ttl)
	if err != nil {
		slog.Error("create share link", "err", err)
		writeError(w, http.StatusInternalServerError, "could not create share link")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"code": code, "share": s.shareView(share, meta)})
}

// handleListShares returns the caller's links; the owner sees everyone's.
func (s *Server) handleListShares(w http.ResponseWriter, _ *http.Request, user users.User) {
	out := []ShareView{}
	for _, share := range s.shares.List() {
		if user.Role != users.RoleOwner && share.CreatedBy != user.ID {
			continue
		}
		meta, ok := s.index.Get(share.VideoID)
		if !ok {
			continue
		}
		out = append(out, s.shareView(share, meta))
	}
	writeJSON(w, http.StatusOK, map[string]any{"shares": out})
}

func (s *Server) handleDeleteShare(w http.ResponseWriter, r *http.Request, user users.User) {
	share, ok := s.shares.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "share link not found")
		return
	}
	if user.Role != users.RoleOwner && share.CreatedBy != user.ID {
		writeError(w, http.StatusForbidden, "you can only stop your own share links")
		return
	}
	if err := s.shares.Delete(share.ID); err != nil && !errors.Is(err, shares.ErrNotFound) {
		slog.Error("delete share link", "err", err)
		writeError(w, http.StatusInternalServerError, "could not stop share link")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ------------------------------------------------------------ for anyone --

// publicShare resolves ?s= to a live link. A link is live only while it is
// unexpired, its video is published, and the member who shared it still has
// an active account. Every failure looks the same, and counts toward the
// caller's guessing budget.
func (s *Server) publicShare(w http.ResponseWriter, r *http.Request) (media.Meta, *shares.Share, bool) {
	ip := auth.ClientIP(r, s.cfg.TrustLoopbackProxy)
	if s.publicByIP.Blocked(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return media.Meta{}, nil, false
	}
	share, err := s.shares.Lookup(r.URL.Query().Get("s"))
	if err == nil {
		meta, ok := s.index.Get(share.VideoID)
		creator, found := s.users.Get(share.CreatedBy)
		if ok && found && !creator.Disabled {
			return meta, &share, true
		}
	}
	s.publicByIP.Fail(ip)
	writeError(w, http.StatusNotFound, "this share link is invalid, expired, or stopped")
	return media.Meta{}, nil, false
}

func (s *Server) handlePublicShare(w http.ResponseWriter, r *http.Request) {
	meta, share, ok := s.publicShare(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, PublicShare{
		Title: meta.Title, Width: meta.Width, Height: meta.Height, Duration: meta.Duration,
		Size: meta.Size, Ext: filepath.Ext(meta.FileName), ExpiresAt: share.ExpiresAt,
	})
}

func (s *Server) handlePublicVideo(w http.ResponseWriter, r *http.Request) {
	s.servePublicVideo(w, r, false)
}

func (s *Server) handlePublicDownload(w http.ResponseWriter, r *http.Request) {
	s.servePublicVideo(w, r, true)
}

func (s *Server) servePublicVideo(w http.ResponseWriter, r *http.Request, attachment bool) {
	meta, _, ok := s.publicShare(w, r)
	if !ok {
		return
	}
	select {
	case s.publicStreams <- struct{}{}:
		defer func() { <-s.publicStreams }()
	default:
		writeError(w, http.StatusServiceUnavailable, "too many people are watching shared videos, try again shortly")
		return
	}
	if attachment {
		setAttachment(w, meta.Title, meta.FileName)
	}
	s.serveFile(w, r, s.videosRoot, meta.FileName, media.MimeType(meta.FileName))
}

func (s *Server) handlePublicPoster(w http.ResponseWriter, r *http.Request) {
	meta, _, ok := s.publicShare(w, r)
	if !ok {
		return
	}
	s.servePoster(w, r, meta.VideoID)
}
