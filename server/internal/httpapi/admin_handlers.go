package httpapi

import (
	"errors"
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
