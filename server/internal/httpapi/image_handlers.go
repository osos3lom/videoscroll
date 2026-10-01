package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// ImagesResponse is mirrored by `ImagesResponse` in src/types/api.ts.
type ImagesResponse struct {
	Data                []media.Meta `json:"data"`
	MediaToken          string       `json:"mediaToken"`
	MediaTokenExpiresAt time.Time    `json:"mediaTokenExpiresAt"`
}

// canSeeImage: images are private to their uploader. The owner sees all of
// them, to manage the server; imported images (no uploader) only the owner.
func canSeeImage(user users.User, meta media.Meta) bool {
	return user.Role == users.RoleOwner || (meta.UploaderID != "" && meta.UploaderID == user.ID)
}

// handleListImages returns the caller's images, newest first. The owner may
// ask for every image with ?all=1.
func (s *Server) handleListImages(w http.ResponseWriter, r *http.Request, user users.User) {
	list := s.images.ListBy(user.ID)
	if user.Role == users.RoleOwner && r.URL.Query().Get("all") == "1" {
		list = s.images.List()
	}
	token, claims := s.signer.IssueMedia(user.ID, user.Ver)
	writeJSON(w, http.StatusOK, ImagesResponse{Data: list, MediaToken: token, MediaTokenExpiresAt: claims.ExpiresAt()})
}

// visibleImage is the image named in the path, or a 404 for anyone who may
// not see it: an image someone else uploaded does not exist for you.
func (s *Server) visibleImage(w http.ResponseWriter, r *http.Request, user users.User) (media.Meta, bool) {
	meta, ok := s.images.Get(r.PathValue("id"))
	if !ok || !canSeeImage(user, meta) {
		writeError(w, http.StatusNotFound, "image not found")
		return media.Meta{}, false
	}
	return meta, true
}

func (s *Server) handleUpdateImage(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		Title string `json:"title"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	meta, ok := s.visibleImage(w, r, user)
	if !ok {
		return
	}
	updated, err := s.images.UpdateTitle(meta.VideoID, body.Title)
	switch {
	case errors.Is(err, media.ErrInvalidTitle):
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not save")
	default:
		writeJSON(w, http.StatusOK, map[string]any{"image": updated})
	}
}

func (s *Server) handleDeleteImage(w http.ResponseWriter, r *http.Request, user users.User) {
	meta, ok := s.visibleImage(w, r, user)
	if !ok {
		return
	}
	if err := s.images.Delete(meta.VideoID); err != nil {
		slog.Error("delete image", "err", err)
		writeError(w, http.StatusInternalServerError, "could not delete image")
		return
	}
	s.forgetMedia(meta.VideoID)
	w.WriteHeader(http.StatusNoContent)
}

// handleImage serves the original bytes, as uploaded. ?download=1 makes it
// an attachment named after the title.
func (s *Server) handleImage(w http.ResponseWriter, r *http.Request, user users.User) {
	meta, ok := s.visibleImage(w, r, user)
	if !ok {
		return
	}
	if r.URL.Query().Get("download") == "1" {
		setAttachment(w, meta.Title, meta.FileName)
	}
	s.serveImageFile(w, r, meta)
}

func (s *Server) handleImageThumb(w http.ResponseWriter, r *http.Request, user users.User) {
	meta, ok := s.visibleImage(w, r, user)
	if !ok {
		return
	}
	s.serveImageThumb(w, r, meta)
}

func (s *Server) serveImageFile(w http.ResponseWriter, r *http.Request, meta media.Meta) {
	s.serveFile(w, r, s.imagesRoot, meta.FileName, media.ImageMimeType(meta.FileName))
}

// serveImageThumb falls back to the original if the thumbnail is missing.
func (s *Server) serveImageThumb(w http.ResponseWriter, r *http.Request, meta media.Meta) {
	path := s.layout.PosterPath(meta.VideoID)
	if path == "" {
		s.serveImageFile(w, r, meta)
		return
	}
	s.serveFile(w, r, s.postersRoot, filepath.Base(path), "image/jpeg")
}

// requireMediaUser is requireMedia for routes that check what this
// particular member may see, such as private images.
func (s *Server) requireMediaUser(next userHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.authenticate(r.URL.Query().Get("t"), auth.ScopeMedia)
		if err == nil && user.MustChangePassword {
			err = auth.ErrInvalidToken
		}
		if err != nil {
			writeError(w, http.StatusUnauthorized, "media token invalid or expired")
			return
		}
		next(w, r, user)
	}
}
