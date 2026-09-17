package jobs

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/store"
)

func newManager(t *testing.T) (*Manager, media.Layout) {
	t.Helper()
	layout := media.NewLayout(t.TempDir())
	if err := layout.Ensure(); err != nil {
		t.Fatal(err)
	}
	m := NewManager(layout, media.NewIndex(layout), nil, Options{MinFreeBytes: 0, MaxUploadBytes: 1 << 30})
	return m, layout
}

func TestChunkedUploadResumesAndQueues(t *testing.T) {
	m, layout := newManager(t)
	data := bytes.Repeat([]byte("abcdefgh"), 1000) // 8000 bytes

	rec, received, err := m.Create("u1", "holiday.mp4", int64(len(data)), 42)
	if err != nil || received != 0 || rec.State != StateUploading {
		t.Fatalf("create: rec=%+v received=%d err=%v", rec, received, err)
	}

	if _, got, err := m.Append(rec.ID, "u1", 0, bytes.NewReader(data[:3000])); err != nil || got != 3000 {
		t.Fatalf("first chunk: got=%d err=%v", got, err)
	}

	// A retry of an already-applied chunk, or a skipped chunk, is refused
	// with the true offset.
	var mismatch OffsetMismatchError
	if _, _, err := m.Append(rec.ID, "u1", 0, bytes.NewReader(data[:3000])); !errors.As(err, &mismatch) || mismatch.Received != 3000 {
		t.Fatalf("stale offset: err=%v", err)
	}
	if _, _, err := m.Append(rec.ID, "u1", 6000, bytes.NewReader(data[6000:])); !errors.As(err, &mismatch) {
		t.Fatalf("skipped chunk: err=%v", err)
	}

	// Another user cannot see or write it.
	if _, _, err := m.Append(rec.ID, "u2", 3000, bytes.NewReader(data[3000:])); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign user: err=%v", err)
	}

	// Re-creating the same file resumes rather than restarting.
	again, resumeAt, err := m.Create("u1", "holiday.mp4", int64(len(data)), 42)
	if err != nil || again.ID != rec.ID || resumeAt != 3000 {
		t.Fatalf("resume: id=%s at=%d err=%v", again.ID, resumeAt, err)
	}

	done, got, err := m.Append(rec.ID, "u1", 3000, bytes.NewReader(data[3000:]))
	if err != nil || got != int64(len(data)) || done.State != StateQueued {
		t.Fatalf("final chunk: rec=%+v got=%d err=%v", done, got, err)
	}

	src, err := os.ReadFile(filepath.Join(layout.Incoming, rec.ID+".src"))
	if err != nil || !bytes.Equal(src, data) {
		t.Fatalf("assembled file differs (err=%v)", err)
	}
	if m.Status().Waiting != 1 {
		t.Errorf("queue waiting = %d, want 1", m.Status().Waiting)
	}
}

func TestAppendRejectsBytesPastDeclaredSize(t *testing.T) {
	m, _ := newManager(t)
	rec, _, _ := m.Create("u1", "a.mp4", 10, 1)
	if _, _, err := m.Append(rec.ID, "u1", 0, bytes.NewReader(make([]byte, 11))); !errors.Is(err, ErrExceedsDeclaredSize) {
		t.Fatalf("err = %v", err)
	}
	if _, received, _ := m.Get(rec.ID, "u1", false); received != 0 {
		t.Errorf("oversized chunk left %d bytes behind", received)
	}
}

func TestCreateValidates(t *testing.T) {
	m, _ := newManager(t)
	if _, _, err := m.Create("u1", "notes.txt", 10, 1); !errors.Is(err, ErrUnsupported) {
		t.Errorf("txt: err = %v", err)
	}
	if _, _, err := m.Create("u1", "big.mp4", 2<<30, 1); !errors.Is(err, ErrTooLarge) {
		t.Errorf("too large: err = %v", err)
	}

	m.opts.MinFreeBytes = 1 << 62
	if _, _, err := m.Create("u1", "ok.mp4", 10, 1); !errors.Is(err, ErrInsufficientStorage) {
		t.Errorf("disk full: err = %v", err)
	}
}

func TestRecoverRequeuesAndCleansUp(t *testing.T) {
	layout := media.NewLayout(t.TempDir())
	_ = layout.Ensure()

	// A completed upload that was processing when the server died.
	queued := &Record{ID: "aaa", FileName: "x.mp4", Size: 3, State: StateProcessing, UpdatedAt: time.Now()}
	_ = store.WriteJSON(filepath.Join(layout.Incoming, "aaa.json"), queued, 0o640)
	_ = os.WriteFile(filepath.Join(layout.Incoming, "aaa.src"), []byte("abc"), 0o640)

	// A queued record whose source vanished.
	lost := &Record{ID: "bbb", FileName: "y.mp4", Size: 3, State: StateQueued, UpdatedAt: time.Now()}
	_ = store.WriteJSON(filepath.Join(layout.Incoming, "bbb.json"), lost, 0o640)

	// Leftover temp output from an interrupted encode.
	tmp := filepath.Join(layout.Videos, "123-x.mp4.tmp")
	_ = os.WriteFile(tmp, []byte("partial"), 0o640)

	m := NewManager(layout, media.NewIndex(layout), nil, Options{MaxUploadBytes: 1 << 30})
	m.Recover()

	if got, _, _ := m.Get("aaa", "", true); got.State != StateQueued {
		t.Errorf("interrupted job state = %s, want queued", got.State)
	}
	if m.Status().Waiting != 1 {
		t.Errorf("waiting = %d, want 1", m.Status().Waiting)
	}
	if got, _, _ := m.Get("bbb", "", true); got.State != StateFailed {
		t.Errorf("lost job state = %s, want failed", got.State)
	}
	if _, err := os.Stat(filepath.Join(layout.Failed, "bbb.json")); err != nil {
		t.Errorf("failed record not moved to failed/: %v", err)
	}
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Error("stale .tmp output survived recovery")
	}
}
