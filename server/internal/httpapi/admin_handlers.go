package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/users"
)

func (s *Server) handleListUsers(w http.ResponseWriter, _ *http.Request, _ users.User) {
	list := s.users.List()
	out := make([]users.Public, 0, len(list))
	for _, u := range list {
		out = append(out, u.Public())
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

// handleCreateUser is the owner setting up an account directly, with a
// temporary password the person must change at their first sign-in.
func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request, _ users.User) {
	var body struct {
		Username    string     `json:"username"`
		DisplayName string     `json:"displayName"`
		Password    string     `json:"password"`
		Role        users.Role `json:"role"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	user, err := s.users.CreateMember(body.Username, body.DisplayName, body.Password, body.Role)
	switch {
	case errors.Is(err, users.ErrUsernameTaken):
		writeError(w, http.StatusConflict, err.Error())
	case err != nil && isUserInputError(err):
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not create account")
	default:
		writeJSON(w, http.StatusCreated, map[string]any{"user": user.Public()})
	}
}

// handleResetPassword sets a new temporary password: the person is signed
// out everywhere and must choose their own at the next sign-in.
func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request, owner users.User) {
	var body struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	id := r.PathValue("id")
	if id == owner.ID {
		writeError(w, http.StatusBadRequest, "change your own password from your profile")
		return
	}
	user, err := s.users.SetTemporaryPassword(id, body.Password)
	switch {
	case errors.Is(err, users.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, users.ErrWeakPassword):
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not reset password")
	default:
		writeJSON(w, http.StatusOK, map[string]any{"user": user.Public()})
	}
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request, owner users.User) {
	id := r.PathValue("id")
	if id == owner.ID {
		writeError(w, http.StatusBadRequest, "you cannot delete your own account")
		return
	}
	err := s.users.Delete(id)
	switch {
	case errors.Is(err, users.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, users.ErrLastOwner):
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not delete account")
	default:
		if err := s.shares.DeleteByUser(id); err != nil {
			// Harmless: publicShare also requires the creator to exist.
			slog.Warn("stop share links of deleted account", "err", err)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func isUserInputError(err error) bool {
	for _, known := range []error{
		users.ErrInvalidUsername, users.ErrInvalidPhone, users.ErrWeakPassword,
		users.ErrInvalidRole, users.ErrDisplayName,
	} {
		if errors.Is(err, known) {
			return true
		}
	}
	return false
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request, _ users.User) {
	var patch users.Patch
	if !readJSON(w, r, &patch) {
		return
	}
	updated, err := s.users.Update(r.PathValue("id"), patch)
	switch {
	case errors.Is(err, users.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeJSON(w, http.StatusOK, map[string]any{"user": updated.Public()})
	}
}

func (s *Server) handleRevokeUser(w http.ResponseWriter, r *http.Request, _ users.User) {
	if _, err := s.users.RevokeSessions(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// inviteView is an invite as the admin page sees it: never the code hash.
type inviteView struct {
	ID        string     `json:"id"`
	Role      users.Role `json:"role"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	UsedBy    string     `json:"usedBy,omitempty"`
	UsedAt    *time.Time `json:"usedAt,omitempty"`
}

func (s *Server) handleListInvites(w http.ResponseWriter, _ *http.Request, _ users.User) {
	invites := s.users.ListInvites()
	out := make([]inviteView, 0, len(invites))
	for _, inv := range invites {
		view := inviteView{ID: inv.ID, Role: inv.Role, CreatedAt: inv.CreatedAt, ExpiresAt: inv.ExpiresAt, UsedAt: inv.UsedAt}
		if inv.UsedBy != "" {
			if u, ok := s.users.Get(inv.UsedBy); ok {
				view.UsedBy = u.Username
			}
		}
		out = append(out, view)
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": out})
}

func (s *Server) handleCreateInvite(w http.ResponseWriter, r *http.Request, owner users.User) {
	var body struct {
		Role          users.Role `json:"role"`
		ExpiresInDays int        `json:"expiresInDays"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.ExpiresInDays <= 0 || body.ExpiresInDays > 30 {
		body.ExpiresInDays = 7
	}

	code, invite, err := s.users.CreateInvite(body.Role, owner.ID, time.Duration(body.ExpiresInDays)*24*time.Hour)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// The code is returned exactly once; only its hash is stored.
	writeJSON(w, http.StatusCreated, map[string]any{
		"code": code,
		"invite": inviteView{
			ID: invite.ID, Role: invite.Role, CreatedAt: invite.CreatedAt, ExpiresAt: invite.ExpiresAt,
		},
	})
}

func (s *Server) handleDeleteInvite(w http.ResponseWriter, r *http.Request, _ users.User) {
	if err := s.users.DeleteInvite(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
