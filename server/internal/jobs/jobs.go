// Package jobs owns uploads and the processing queue.
//
// Every job is a pair of files in incoming/: <id>.json (the record) and the
// bytes — <id>.part while arriving, <id>.src once complete. Because the state
// lives on disk, a restart resumes exactly where it stopped: half-sent uploads
// can continue, and finished ones are processed.
//
// Processing is strictly one job at a time. The target machine has 4 GB of
// RAM and an old CPU; two concurrent ffmpeg runs thrash rather than finish
// twice as fast.
package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/process"
	"github.com/osos3lom/videoscroll/server/internal/store"
)

type State string

const (
	StateUploading  State = "uploading"
	StateQueued     State = "queued"
	StateProcessing State = "processing"
	StateReady      State = "ready"
	StateFailed     State = "failed"
)

// ChunkSize is what clients should send per PUT. Small enough to retry
// cheaply on a flaky phone connection and to pass proxies with body caps
// (Cloudflare's is 100 MB).
const ChunkSize = 8 << 20

const (
	staleUploadAge = 48 * time.Hour
	readyRecordAge = 24 * time.Hour
	// Files in inbox/ must be unmodified this long, so a copy that is still
	// in progress over scp is not imported half-written.
	inboxSettleTime = 30 * time.Second
)

// Kinds of upload. Inferred from the file name when the upload is created.
const (
	KindVideo = "video"
	KindImage = "image"
)

type Record struct {
	ID     string `json:"id"`
	UserID string `json:"userId,omitempty"`
	// Empty in records written before images existed: a video.
	Kind         string    `json:"kind,omitempty"`
	FileName     string    `json:"fileName"`
	Size         int64     `json:"size"`
	LastModified int64     `json:"lastModified,omitempty"`
	Source       string    `json:"source"`
	State        State     `json:"state"`
	Error        string    `json:"error,omitempty"`
	VideoID      string    `json:"videoId,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

var (
	ErrNotFound            = errors.New("upload not found")
	ErrUnsupported         = errors.New("unsupported video format")
	ErrTooLarge            = errors.New("video exceeds the upload size limit")
	ErrInsufficientStorage = errors.New("the server does not have enough free disk space for this video")
	ErrBusy                = errors.New("another request is already writing this upload")
	ErrWrongState          = errors.New("upload is not accepting data")
	ErrExceedsDeclaredSize = errors.New("chunk goes past the declared file size")
	ErrHEIC                = errors.New("HEIC photos are not supported; choose JPEG")
	ErrImageTooLarge       = errors.New("image exceeds the upload size limit")
	ErrTooManyUploads      = errors.New("too many unfinished uploads; finish or cancel some first")
)

// maxOpenUploads bounds one member's unfinished uploads: enough for a batch
// of 20 images plus a few abandoned ones.
const maxOpenUploads = 40

// IsImage reports whether a record is an image upload.
func (r Record) IsImage() bool { return r.Kind == KindImage }

// OffsetMismatchError carries the server's actual offset so the client can
// resume from it.
type OffsetMismatchError struct{ Received int64 }

func (e OffsetMismatchError) Error() string {
	return fmt.Sprintf("offset mismatch: server has %d bytes", e.Received)
}

type Options struct {
	MinFreeBytes   int64
	MaxUploadBytes int64
	// MaxImageBytes caps one image; 0 means 50 MB.
	MaxImageBytes int64
	// Images is the image index. Nil refuses image uploads.
	Images *media.Index
}

type task struct {
	kind string // "record", "image", "backfill", "backfill-image" or "poster"
	id   string // record id or file name
}

// light tasks are quick, so they go ahead of waiting video work instead of
// sitting behind an hour-long transcode.
func (t task) light() bool { return t.kind == "image" || t.kind == "backfill-image" }

type Manager struct {
	layout   media.Layout
	index    *media.Index
	images   *media.Index
	pipeline *process.Pipeline
	opts     Options

	mu      sync.Mutex
	records map[string]*Record
	writing map[string]bool
	pending []task
	queued  map[string]bool
	current string
	wake    chan struct{}
}

func NewManager(layout media.Layout, index *media.Index, pipeline *process.Pipeline, opts Options) *Manager {
	if opts.MaxImageBytes <= 0 {
		opts.MaxImageBytes = 50 << 20
	}
	return &Manager{
		layout:   layout,
		index:    index,
		images:   opts.Images,
		pipeline: pipeline,
		opts:     opts,
		records:  make(map[string]*Record),
		writing:  make(map[string]bool),
		queued:   make(map[string]bool),
		wake:     make(chan struct{}, 1),
	}
}

func (m *Manager) recordPath(id string) string { return filepath.Join(m.layout.Incoming, id+".json") }
func (m *Manager) partPath(id string) string   { return filepath.Join(m.layout.Incoming, id+".part") }
func (m *Manager) srcPath(id string) string    { return filepath.Join(m.layout.Incoming, id+".src") }

func (m *Manager) saveLocked(r *Record) error {
	r.UpdatedAt = time.Now().UTC()
	dir := m.layout.Incoming
	if r.State == StateFailed {
		dir = m.layout.Failed
	}
	return store.WriteJSON(filepath.Join(dir, r.ID+".json"), r, 0o640)
}

// Recover rebuilds state from disk. Call once, after the index has been
// scanned and before Run.
func (m *Manager) Recover() {
	for _, dir := range []string{m.layout.Videos, m.layout.Posters, m.layout.Meta} {
		media.RemoveStaleTemp(dir)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	for _, r := range readRecords(m.layout.Failed) {
		m.records[r.ID] = r
	}

	for _, r := range readRecords(m.layout.Incoming) {
		m.records[r.ID] = r
		age := time.Since(r.UpdatedAt)

		switch r.State {
		case StateUploading:
			if age > staleUploadAge {
				m.discardLocked(r.ID)
			}
		case StateQueued, StateProcessing:
			published := m.index
			if r.IsImage() {
				published = m.images
			}
			if published == nil {
				m.failLocked(r, "images are not enabled")
				continue
			}
			// Published already, but the crash hit before the record said so.
			if meta, ok := published.BySourceID(r.ID); ok {
				r.State, r.VideoID = StateReady, meta.VideoID
				_ = m.saveLocked(r)
				_ = os.Remove(m.srcPath(r.ID))
				continue
			}
			if _, err := os.Stat(m.srcPath(r.ID)); err != nil {
				m.failLocked(r, "source file is missing")
				continue
			}
			r.State = StateQueued
			_ = m.saveLocked(r)
			m.enqueueLocked(recordTask(r))
		case StateReady:
			if age > readyRecordAge {
				m.discardLocked(r.ID)
			}
		}
	}

	// .part or .src files without a record are unrecoverable leftovers.
	entries, _ := os.ReadDir(m.layout.Incoming)
	for _, entry := range entries {
		name := entry.Name()
		id := strings.TrimSuffix(strings.TrimSuffix(name, ".part"), ".src")
		if id == name {
			continue
		}
		if _, known := m.records[id]; known {
			continue
		}
		if info, err := entry.Info(); err == nil && time.Since(info.ModTime()) > staleUploadAge {
			_ = os.Remove(filepath.Join(m.layout.Incoming, name))
		}
	}
}

func readRecords(dir string) []*Record {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var records []*Record
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		var r Record
		if _, err := store.ReadJSON(filepath.Join(dir, entry.Name()), &r); err == nil && r.ID != "" {
			records = append(records, &r)
		}
	}
	return records
}

// uploadID is deterministic, so picking the same file again after a closed
// tab or a crash resumes the existing upload instead of starting over.
func uploadID(userID, fileName string, size, lastModified int64) string {
	h := sha256.New()
	for _, part := range []string{userID, fileName, strconv.FormatInt(size, 10), strconv.FormatInt(lastModified, 10)} {
		h.Write([]byte(part))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil)[:12])
}

func recordTask(r *Record) task {
	if r.IsImage() {
		return task{kind: "image", id: r.ID}
	}
	return task{kind: "record", id: r.ID}
}

// Create starts an upload or returns the existing one for the same file.
// Whether it is a video or an image follows from the file name.
func (m *Manager) Create(userID, fileName string, size, lastModified int64) (Record, int64, error) {
	fileName = filepath.Base(strings.TrimSpace(fileName))
	kind := ""
	switch {
	case media.IsInputFile(fileName):
		kind = KindVideo
		if size <= 0 || size > m.opts.MaxUploadBytes {
			return Record{}, 0, ErrTooLarge
		}
	case media.IsImageFile(fileName) && m.images != nil:
		kind = KindImage
		if size <= 0 || size > m.opts.MaxImageBytes {
			return Record{}, 0, ErrImageTooLarge
		}
	case media.IsHEIC(fileName):
		return Record{}, 0, ErrHEIC
	default:
		return Record{}, 0, ErrUnsupported
	}

	id := uploadID(userID, fileName, size, lastModified)

	m.mu.Lock()
	defer m.mu.Unlock()

	if r, ok := m.records[id]; !ok || r.State == StateFailed {
		open := 0
		for _, other := range m.records {
			if other.UserID == userID && other.State == StateUploading {
				open++
			}
		}
		if open >= maxOpenUploads {
			return Record{}, 0, ErrTooManyUploads
		}
	}

	if r, ok := m.records[id]; ok {
		if r.State != StateFailed {
			return *r, m.receivedLocked(r), nil
		}
		// A failed attempt at the same file: start clean.
		_ = os.Remove(filepath.Join(m.layout.Failed, id+".json"))
		_ = os.Remove(filepath.Join(m.layout.Failed, id+".src"))
		delete(m.records, id)
	}

	if free, err := media.FreeBytes(m.layout.Incoming); err == nil && free-size < m.opts.MinFreeBytes {
		return Record{}, 0, ErrInsufficientStorage
	}

	now := time.Now().UTC()
	r := &Record{
		ID: id, UserID: userID, Kind: kind, FileName: fileName, Size: size, LastModified: lastModified,
		Source: "upload", State: StateUploading, CreatedAt: now,
	}
	f, err := os.OpenFile(m.partPath(id), os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		return Record{}, 0, err
	}
	f.Close()
	if err := m.saveLocked(r); err != nil {
		return Record{}, 0, err
	}
	m.records[id] = r
	return *r, 0, nil
}

func (m *Manager) receivedLocked(r *Record) int64 {
	if r.State != StateUploading {
		return r.Size
	}
	if info, err := os.Stat(m.partPath(r.ID)); err == nil {
		return info.Size()
	}
	return 0
}

// Get returns a record visible to userID (owners see all).
func (m *Manager) Get(id, userID string, isOwner bool) (Record, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[id]
	if !ok || (!isOwner && r.UserID != userID) {
		return Record{}, 0, ErrNotFound
	}
	return *r, m.receivedLocked(r), nil
}

// Append writes one chunk at offset. The offset must equal the bytes already
// on disk: that single rule makes retries idempotent and resumption trivial.
func (m *Manager) Append(id, userID string, offset int64, body io.Reader) (Record, int64, error) {
	m.mu.Lock()
	r, ok := m.records[id]
	switch {
	case !ok || r.UserID != userID:
		m.mu.Unlock()
		return Record{}, 0, ErrNotFound
	case r.State != StateUploading:
		rec := *r
		m.mu.Unlock()
		return rec, rec.Size, ErrWrongState
	case m.writing[id]:
		m.mu.Unlock()
		return Record{}, 0, ErrBusy
	}
	m.writing[id] = true
	size := r.Size
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		delete(m.writing, id)
		m.mu.Unlock()
	}()

	f, err := os.OpenFile(m.partPath(id), os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		return Record{}, 0, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return Record{}, 0, err
	}
	have := info.Size()
	if offset != have {
		return Record{}, have, OffsetMismatchError{Received: have}
	}
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return Record{}, have, err
	}

	remaining := size - have
	written, copyErr := io.Copy(f, io.LimitReader(body, remaining+1))
	if written > remaining {
		_ = f.Truncate(have)
		return Record{}, have, ErrExceedsDeclaredSize
	}
	// Flush before acknowledging, so an acknowledged offset survives a power
	// cut. Once per 8 MiB chunk is cheap even on an HDD.
	_ = f.Sync()
	received := have + written

	m.mu.Lock()
	defer m.mu.Unlock()

	if copyErr != nil {
		_ = m.saveLocked(r)
		return *r, received, copyErr
	}

	if received == size {
		f.Close()
		if err := os.Rename(m.partPath(id), m.srcPath(id)); err != nil {
			return *r, received, err
		}
		r.State = StateQueued
		if err := m.saveLocked(r); err != nil {
			return *r, received, err
		}
		m.enqueueLocked(recordTask(r))
		return *r, received, nil
	}

	_ = m.saveLocked(r)
	return *r, received, nil
}

// Cancel abandons an upload that is still receiving data.
func (m *Manager) Cancel(id, userID string, isOwner bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[id]
	if !ok || (!isOwner && r.UserID != userID) {
		return ErrNotFound
	}
	if r.State != StateUploading && r.State != StateFailed && r.State != StateReady {
		return ErrWrongState
	}
	if m.writing[id] {
		return ErrBusy
	}
	m.discardLocked(id)
	return nil
}

func (m *Manager) discardLocked(id string) {
	for _, p := range []string{m.partPath(id), m.srcPath(id), m.recordPath(id),
		filepath.Join(m.layout.Failed, id+".json"), filepath.Join(m.layout.Failed, id+".src")} {
		_ = os.Remove(p)
	}
	delete(m.records, id)
}

func (m *Manager) failLocked(r *Record, message string) {
	if len(message) > 500 {
		message = message[:500]
	}
	r.State, r.Error = StateFailed, message
	if err := media.MoveFile(m.srcPath(r.ID), filepath.Join(m.layout.Failed, r.ID+".src")); err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.Error("could not move failed source", "id", r.ID, "err", err)
	}
	_ = m.saveLocked(r)
	_ = os.Remove(m.recordPath(r.ID))
}

// ScanInbox moves settled files from inbox/ into the queue.
func (m *Manager) ScanInbox() {
	entries, err := os.ReadDir(m.layout.Inbox)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !media.IsInputFile(name) {
			continue
		}
		info, err := entry.Info()
		if err != nil || time.Since(info.ModTime()) < inboxSettleTime || info.Size() == 0 {
			continue
		}

		now := time.Now().UTC()
		id := uploadID("inbox", name, info.Size(), now.UnixNano())
		if err := media.MoveFile(filepath.Join(m.layout.Inbox, name), m.srcPath(id)); err != nil {
			slog.Error("inbox import failed", "file", name, "err", err)
			continue
		}

		r := &Record{
			ID: id, FileName: name, Size: info.Size(), Source: "inbox",
			State: StateQueued, CreatedAt: now,
		}
		m.mu.Lock()
		if err := m.saveLocked(r); err != nil {
			slog.Error("inbox record failed", "file", name, "err", err)
		}
		m.records[id] = r
		m.enqueueLocked(task{kind: "record", id: id})
		m.mu.Unlock()
		slog.Info("imported from inbox", "file", name)
	}
}

// Backfill queues metadata and poster generation for files that were placed
// directly in videos/.
func (m *Manager) Backfill(fileNames []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, name := range fileNames {
		m.enqueueLocked(task{kind: "backfill", id: name})
	}
}

// BackfillImages registers photos placed in images/ by hand.
func (m *Manager) BackfillImages(fileNames []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, name := range fileNames {
		m.enqueueLocked(task{kind: "backfill-image", id: name})
	}
}

// QueueMissingPosters regenerates posters that are absent for listed videos.
func (m *Manager) QueueMissingPosters() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, meta := range m.index.List() {
		if m.layout.PosterPath(meta.VideoID) == "" {
			m.enqueueLocked(task{kind: "poster", id: meta.VideoID})
		}
	}
}

func (m *Manager) enqueueLocked(t task) {
	key := t.kind + ":" + t.id
	if m.queued[key] {
		return
	}
	m.queued[key] = true
	if t.light() {
		// After other light tasks, before the first heavy one.
		at := 0
		for at < len(m.pending) && m.pending[at].light() {
			at++
		}
		m.pending = append(m.pending[:at], append([]task{t}, m.pending[at:]...)...)
	} else {
		m.pending = append(m.pending, t)
	}
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

type Status struct {
	Current string `json:"current,omitempty"`
	Waiting int    `json:"waiting"`
	Failed  int    `json:"failed"`
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	failed := 0
	for _, r := range m.records {
		if r.State == StateFailed {
			failed++
		}
	}
	return Status{Current: m.current, Waiting: len(m.pending), Failed: failed}
}

// Run processes the queue until ctx is cancelled.
func (m *Manager) Run(ctx context.Context) {
	for {
		m.mu.Lock()
		if len(m.pending) == 0 {
			m.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-m.wake:
				continue
			}
		}
		t := m.pending[0]
		m.pending = m.pending[1:]
		delete(m.queued, t.kind+":"+t.id)
		m.current = t.kind + " " + t.id
		m.mu.Unlock()

		started := time.Now()
		m.runTask(ctx, t)
		slog.Info("job finished", "task", t.kind, "id", t.id, "seconds", int(time.Since(started).Seconds()))

		m.mu.Lock()
		m.current = ""
		m.mu.Unlock()

		if ctx.Err() != nil {
			return
		}
	}
}

func (m *Manager) runTask(ctx context.Context, t task) {
	switch t.kind {
	case "backfill":
		if err := m.pipeline.Backfill(ctx, t.id); err != nil && ctx.Err() == nil {
			slog.Error("backfill failed", "file", t.id, "err", err)
		}
	case "poster":
		if meta, ok := m.index.Get(t.id); ok {
			if err := m.pipeline.EnsurePoster(ctx, meta); err != nil && ctx.Err() == nil {
				slog.Error("poster failed", "video", meta.FileName, "err", err)
			}
		}
	case "backfill-image":
		if err := m.pipeline.BackfillImage(t.id); err != nil && ctx.Err() == nil {
			slog.Error("image backfill failed", "file", t.id, "err", err)
		}
	case "record", "image":
		m.processRecord(ctx, t.id)
	}
}

func (m *Manager) processRecord(ctx context.Context, id string) {
	m.mu.Lock()
	r, ok := m.records[id]
	if !ok || r.State != StateQueued {
		m.mu.Unlock()
		return
	}
	r.State = StateProcessing
	_ = m.saveLocked(r)
	input := process.Input{
		SourcePath:   m.srcPath(id),
		OriginalName: r.FileName,
		UploaderID:   r.UserID,
		UploadedAt:   time.Now(),
		SourceID:     id,
	}
	isImage := r.IsImage()
	m.mu.Unlock()

	var meta media.Meta
	var err error
	if isImage {
		meta, err = m.pipeline.PublishImage(input)
	} else {
		meta, err = m.pipeline.Publish(ctx, input)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	switch {
	case ctx.Err() != nil:
		// Shutting down: leave it queued for the next start.
		r.State = StateQueued
		_ = m.saveLocked(r)
	case err != nil:
		slog.Error("processing failed", "file", r.FileName, "err", err)
		m.failLocked(r, err.Error())
	default:
		r.State, r.VideoID, r.Error = StateReady, meta.VideoID, ""
		_ = m.saveLocked(r)
	}
}

// Sweep removes abandoned uploads and old completed records.
func (m *Manager) Sweep() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, r := range m.records {
		age := time.Since(r.UpdatedAt)
		if (r.State == StateUploading && age > staleUploadAge && !m.writing[id]) ||
			(r.State == StateReady && age > readyRecordAge) {
			m.discardLocked(id)
		}
	}
}
