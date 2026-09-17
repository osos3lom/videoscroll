package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

type sessionResponse struct {
	Token     string       `json:"token"`
	ExpiresAt time.Time    `json:"expiresAt"`
	User      users.Public `json:"user"`
}

func (s *Server) issueSession(w http.ResponseWriter, status int, user users.User) {
	token, claims := s.signer.IssueSession(user.ID, user.Ver)
	writeJSON(w, status, sessionResponse{Token: token, ExpiresAt: claims.ExpiresAt(), User: user.Public()})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &body) {
		return
	}

	// Only failures count, and the tight per-account limit is keyed by
	// (address, account). A stranger guessing at the owner's username can
	// exhaust their own budget but cannot lock the owner out from elsewhere.
	// The per-account key is a loose backstop against guessing spread over
	// many addresses; argon2id and 10+ character passwords do the rest.
	ip := auth.ClientIP(r, s.cfg.TrustLoopbackProxy)
	userKey := users.NormalizeUsername(body.Username)
	pairKey := ip + "\x00" + userKey
	if s.loginByIP.Blocked(ip) || s.loginByPair.Blocked(pairKey) || s.loginByUser.Blocked(userKey) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}

	user, ok := s.users.Authenticate(body.Username, body.Password)
	if !ok {
		s.loginByIP.Fail(ip)
		s.loginByPair.Fail(pairKey)
		s.loginByUser.Fail(userKey)
		// Same message either way: no hint whether the username exists.
		writeError(w, http.StatusUnauthorized, "incorrect username or password")
		return
	}

	s.loginByIP.Reset(ip)
	s.loginByPair.Reset(pairKey)
	s.issueSession(w, http.StatusOK, user)
}

func (s *Server) handleJoin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code     string `json:"code"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &body) {
		return
	}

	if !s.joinByIP.Allow(auth.ClientIP(r, s.cfg.TrustLoopbackProxy)) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}

	user, err := s.users.RedeemInvite(body.Code, body.Username, body.Password)
	switch {
	case errors.Is(err, users.ErrInviteInvalid):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, users.ErrUsernameTaken):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, users.ErrInvalidUsername), errors.Is(err, users.ErrInvalidPhone),
		errors.Is(err, users.ErrWeakPassword):
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not create account")
	default:
		s.issueSession(w, http.StatusCreated, user)
	}
}

func (s *Server) handleMe(w http.ResponseWriter, _ *http.Request, user users.User) {
	writeJSON(w, http.StatusOK, map[string]any{"user": user.Public()})
}

func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		DisplayName *string `json:"displayName"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	updated, err := s.users.Update(user.ID, users.Patch{DisplayName: body.DisplayName})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": updated.Public()})
}

// handleLogoutAll revokes every token for the account, on every device.
// Signing out of a single device is purely client-side: the app forgets its
// token.
func (s *Server) handleLogoutAll(w http.ResponseWriter, _ *http.Request, user users.User) {
	if _, err := s.users.RevokeSessions(user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not sign out")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	// Someone holding a stolen session must not get unlimited guesses at the
	// current password.
	pwKey := "password-change\x00" + user.ID
	if s.loginByPair.Blocked(pwKey) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}
	if !auth.VerifyPassword(body.CurrentPassword, user.PasswordHash) {
		s.loginByPair.Fail(pwKey)
		writeError(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}
	s.loginByPair.Reset(pwKey)
	if auth.VerifyPassword(body.NewPassword, user.PasswordHash) {
		writeError(w, http.StatusBadRequest, "choose a password different from the current one")
		return
	}
	updated, err := s.users.SetPassword(user.ID, body.NewPassword)
	if errors.Is(err, users.ErrWeakPassword) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not change password")
		return
	}
	// Every other device is now signed out; this one gets a fresh token.
	s.issueSession(w, http.StatusOK, updated)
}
