package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// VideosResponse is mirrored by `VideosResponse` in src/types/api.ts.
type VideosResponse struct {
	Data                []media.Meta               `json:"data"`
	Social              map[string]json.RawMessage `json:"social"`
	MediaToken          string                     `json:"mediaToken"`
	MediaTokenExpiresAt time.Time                  `json:"mediaTokenExpiresAt"`
	User                users.Public               `json:"user"`
}

func (s *Server) handleListVideos(w http.ResponseWriter, _ *http.Request, user users.User) {
	token, claims := s.signer.IssueMedia(user.ID, user.Ver)
	writeJSON(w, http.StatusOK, VideosResponse{
		Data:                s.index.List(),
		Social:              s.social,
		MediaToken:          token,
		MediaTokenExpiresAt: claims.ExpiresAt(),
		User:                user.Public(),
	})
}

func (s *Server) handleDeleteVideo(w http.ResponseWriter, r *http.Request, user users.User) {
	meta, ok := s.index.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "video not found")
		return
	}
	if user.Role != users.RoleOwner && (meta.UploaderID == "" || meta.UploaderID != user.ID) {
		writeError(w, http.StatusForbidden, "only the owner or the uploader can delete this video")
		return
	}
	if err := s.index.Delete(meta.VideoID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete video")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleVideo streams a published file. http.ServeContent implements the
// whole of single- and multi-range serving — suffix ranges, If-Range,
// If-None-Match, HEAD, 416 — and hands an *os.File to sendfile on Linux, so
// bytes go from page cache to socket without passing through this process.
func (s *Server) handleVideo(w http.ResponseWriter, r *http.Request) {
	name := media.FileNameFromID(r.PathValue("id"))
	if name == "" {
		writeError(w, http.StatusNotFound, "video not found")
		return
	}
	s.serveFile(w, r, s.videosRoot, name, media.MimeType(name))
}

func (s *Server) handlePoster(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if media.FileNameFromID(id) == "" {
		writeError(w, http.StatusNotFound, "poster not found")
		return
	}
	path := s.layout.PosterPath(id)
	if path == "" {
		writeError(w, http.StatusNotFound, "poster not found")
		return
	}
	contentType := "image/webp"
	if filepath.Ext(path) == ".jpg" {
		contentType = "image/jpeg"
	}
	s.serveFile(w, r, s.postersRoot, filepath.Base(path), contentType)
}

func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, root *os.Root, name, contentType string) {
	f, err := root.Open(name)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	h := w.Header()
	h.Set("Content-Type", contentType)
	// A strong validator lets If-Range work, so a resumed range request can
	// never splice bytes from two different files.
	h.Set("ETag", fmt.Sprintf(`"%x-%x"`, info.Size(), info.ModTime().UnixNano()))
	// private: no shared cache may keep community videos. The URL carries a
	// token that rotates every 6 hours, so a longer lifetime would not help.
	h.Set("Cache-Control", "private, max-age=21600")
	// The JSON-oriented CSP from securityHeaders is meaningless here.
	h.Del("Content-Security-Policy")

	http.ServeContent(w, r, name, info.ModTime(), f)
}

// ------------------------------------------------------------------ status --

type statusResponse struct {
	Videos        int    `json:"videos"`
	Users         int    `json:"users"`
	Queue         any    `json:"queue"`
	DiskFreeBytes int64  `json:"diskFreeBytes"`
	MinFreeBytes  int64  `json:"minFreeBytes"`
	Uptime        string `json:"uptime"`
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request, _ users.User) {
	free, err := media.FreeBytes(s.layout.Root)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		free = -1
	}
	writeJSON(w, http.StatusOK, statusResponse{
		Videos:        s.index.Count(),
		Users:         len(s.users.List()),
		Queue:         s.jobs.Status(),
		DiskFreeBytes: free,
		MinFreeBytes:  s.cfg.MinFreeBytes,
		Uptime:        time.Since(s.startedAt).Round(time.Second).String(),
	})
}
