package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/jobs"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// uploadResponse is mirrored by `UploadStatus` in src/types/api.ts.
type uploadResponse struct {
	UploadID  string     `json:"uploadId"`
	FileName  string     `json:"fileName"`
	Size      int64      `json:"size"`
	Received  int64      `json:"received"`
	ChunkSize int        `json:"chunkSize"`
	State     jobs.State `json:"state"`
	VideoID   string     `json:"videoId,omitempty"`
	Error     string     `json:"error,omitempty"`
}

func toUploadResponse(r jobs.Record, received int64) uploadResponse {
	return uploadResponse{
		UploadID: r.ID, FileName: r.FileName, Size: r.Size, Received: received,
		ChunkSize: jobs.ChunkSize, State: r.State, VideoID: r.VideoID, Error: r.Error,
	}
}

func (s *Server) handleCreateUpload(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		FileName     string `json:"fileName"`
		Size         int64  `json:"size"`
		LastModified int64  `json:"lastModified"`
	}
	if !readJSON(w, r, &body) {
		return
	}

	record, received, err := s.jobs.Create(user.ID, body.FileName, body.Size, body.LastModified)
	if err != nil {
		s.writeUploadError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toUploadResponse(record, received))
}

func (s *Server) handleAppendUpload(w http.ResponseWriter, r *http.Request, user users.User) {
	// A header rather than a query parameter: browsers cache CORS preflights
	// per URL, so a changing ?offset= would cost a preflight on every chunk.
	raw := r.Header.Get("Upload-Offset")
	if raw == "" {
		raw = r.URL.Query().Get("offset")
	}
	offset, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || offset < 0 {
		writeError(w, http.StatusBadRequest, "Upload-Offset header is required")
		return
	}

	// The server has no global write/read timeout (it would cut off long
	// video streams), so bound this request explicitly: a stalled phone
	// connection must not pin the upload lock forever.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(15 * time.Minute))

	// Twice the advertised chunk size leaves slack for clients that pick
	// their own size, while still bounding a single request.
	body := http.MaxBytesReader(w, r.Body, 2*jobs.ChunkSize)

	record, received, err := s.jobs.Append(r.PathValue("id"), user.ID, offset, body)
	if err != nil {
		var mismatch jobs.OffsetMismatchError
		var maxBytes *http.MaxBytesError
		switch {
		case errors.As(err, &mismatch):
			writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "received": mismatch.Received})
		case errors.As(err, &maxBytes):
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "chunk too large", "received": received})
		case errors.Is(err, jobs.ErrWrongState):
			writeJSON(w, http.StatusConflict, toUploadResponse(record, received))
		default:
			if !errors.Is(err, jobs.ErrNotFound) && !errors.Is(err, jobs.ErrBusy) && !errors.Is(err, jobs.ErrExceedsDeclaredSize) {
				slog.Warn("upload chunk failed", "upload", r.PathValue("id"), "err", err)
			}
			s.writeUploadError(w, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, toUploadResponse(record, received))
}

func (s *Server) handleGetUpload(w http.ResponseWriter, r *http.Request, user users.User) {
	record, received, err := s.jobs.Get(r.PathValue("id"), user.ID, user.Role == users.RoleOwner)
	if err != nil {
		s.writeUploadError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toUploadResponse(record, received))
}

func (s *Server) handleCancelUpload(w http.ResponseWriter, r *http.Request, user users.User) {
	if err := s.jobs.Cancel(r.PathValue("id"), user.ID, user.Role == users.RoleOwner); err != nil {
		s.writeUploadError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writeUploadError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, jobs.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, jobs.ErrUnsupported):
		writeError(w, http.StatusUnsupportedMediaType, err.Error())
	case errors.Is(err, jobs.ErrTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, err.Error())
	case errors.Is(err, jobs.ErrInsufficientStorage):
		writeError(w, http.StatusInsufficientStorage, err.Error())
	case errors.Is(err, jobs.ErrBusy), errors.Is(err, jobs.ErrWrongState):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, jobs.ErrExceedsDeclaredSize):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "upload failed")
	}
}
