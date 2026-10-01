package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/osos3lom/videoscroll/server/internal/reactions"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// importBatchMax bounds one import request; the app sends larger local
// histories in several requests.
const importBatchMax = 1000

// VideoSocial is mirrored by `VideoSocial` in src/types/api.ts: community
// totals for one media item.
type VideoSocial struct {
	Likes     int `json:"likes"`
	Bookmarks int `json:"bookmarks"`
}

// socialCounts merges the legacy per-video counts with every member's likes
// and saves.
func (s *Server) socialCounts() map[string]VideoSocial {
	out := make(map[string]VideoSocial, len(s.social))
	for id, raw := range s.social {
		var legacy VideoSocial
		if json.Unmarshal(raw, &legacy) == nil {
			out[id] = legacy
		}
	}
	for id, c := range s.reactions.Counts() {
		v := out[id]
		v.Likes += c.Likes
		v.Bookmarks += c.Saves
		out[id] = v
	}
	return out
}

// canSeeMedia: every member sees every video; an image only its uploader
// and the owner.
func (s *Server) canSeeMedia(user users.User, mediaID string) bool {
	_, _, ok := s.mediaFor(user, mediaID)
	return ok
}

// forgetMedia drops every reference to deleted media. The media itself is
// already gone; this only cleans up.
func (s *Server) forgetMedia(mediaID string) {
	if err := s.reactions.RemoveMedia(mediaID); err != nil {
		slog.Warn("forget reactions of deleted media", "err", err)
	}
	if err := s.collections.RemoveMedia(mediaID); err != nil {
		slog.Warn("remove deleted media from collections", "err", err)
	}
}

func (s *Server) visibleEntries(user users.User, entries []reactions.Entry) []reactions.Entry {
	out := make([]reactions.Entry, 0, len(entries))
	for _, e := range entries {
		if s.canSeeMedia(user, e.MediaID) {
			out = append(out, e)
		}
	}
	return out
}

// handleListReactions returns the caller's likes and saves, newest first,
// leaving out media that has since been deleted or is no longer visible.
func (s *Server) handleListReactions(w http.ResponseWriter, _ *http.Request, user users.User) {
	lists := s.reactions.List(user.ID)
	writeJSON(w, http.StatusOK, reactions.Lists{
		Likes: s.visibleEntries(user, lists.Likes),
		Saves: s.visibleEntries(user, lists.Saves),
	})
}

func (s *Server) handleSetReaction(w http.ResponseWriter, r *http.Request, user users.User) {
	kind, ok := reactions.ParseKind(r.PathValue("kind"))
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	mediaID := r.PathValue("id")
	on := r.Method == http.MethodPut
	// Removing is always allowed, so a reaction to media that has gone can
	// still be cleared.
	if on && !s.canSeeMedia(user, mediaID) {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	err := s.reactions.Set(user.ID, kind, mediaID, on)
	switch {
	case errors.Is(err, reactions.ErrLimit):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, reactions.ErrInvalid):
		writeError(w, http.StatusNotFound, "media not found")
	case err != nil:
		slog.Error("save reaction", "err", err)
		writeError(w, http.StatusInternalServerError, "could not save")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleImportReactions takes the likes and saves a device kept locally
// before they moved to the server. Unknown ids are skipped silently.
func (s *Server) handleImportReactions(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		Likes []string `json:"likes"`
		Saves []string `json:"saves"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if len(body.Likes) > importBatchMax || len(body.Saves) > importBatchMax {
		writeError(w, http.StatusBadRequest, "too many items in one request")
		return
	}
	added, err := s.reactions.Import(user.ID, body.Likes, body.Saves, func(id string) bool {
		return s.canSeeMedia(user, id)
	})
	if err != nil {
		slog.Error("import reactions", "err", err)
		writeError(w, http.StatusInternalServerError, "could not save")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"imported": added})
}
