package media

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/store"
)

// Meta is everything the feed needs to know about a video without touching
// the video file: the listing is built from these, and the client uses
// width/height to lay out before the first byte of video arrives, and bitrate
// to size its prefetch.
type Meta struct {
	VideoID    string    `json:"videoId"`
	FileName   string    `json:"fileName"`
	Title      string    `json:"title"`
	Size       int64     `json:"size"`
	UploadedAt time.Time `json:"uploadedAt"`
	UploaderID string    `json:"uploaderId,omitempty"`
	Duration   float64   `json:"duration"`
	// Display dimensions, i.e. already swapped for rotated phone video.
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Bitrate    int64  `json:"bitrate"`
	VideoCodec string `json:"videoCodec"`
	AudioCodec string `json:"audioCodec,omitempty"`
	// How the file got here: move, remux, audio, transcode, or existing.
	Processing string `json:"processing"`
	// Upload job that produced this video, if any. Lets job recovery detect
	// that a video was already published before a crash.
	SourceID string `json:"sourceId,omitempty"`
}

// Index is the in-memory listing. Reads never touch the disk, which matters
// on an HDD where a directory scan with a stat per file can take seconds.
type Index struct {
	layout Layout

	mu     sync.RWMutex
	byID   map[string]Meta
	sorted []Meta
}

func NewIndex(layout Layout) *Index {
	return &Index{layout: layout, byID: make(map[string]Meta)}
}

func (ix *Index) MetaPath(videoID string) string {
	return filepath.Join(ix.layout.Meta, filepath.Base(videoID)+".json")
}

// Scan reconciles the index with the disk and returns the published files
// that have no metadata yet, for the caller to backfill.
func (ix *Index) Scan() (missing []string, err error) {
	entries, err := os.ReadDir(ix.layout.Videos)
	if err != nil {
		return nil, err
	}

	next := make(map[string]Meta, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !IsVideoFile(name) {
			continue
		}
		id := VideoID(name)

		ix.mu.RLock()
		known, ok := ix.byID[id]
		ix.mu.RUnlock()
		if ok {
			next[id] = known
			continue
		}

		var meta Meta
		if _, err := store.ReadJSON(ix.MetaPath(id), &meta); err == nil && meta.VideoID == id {
			next[id] = meta
			continue
		}
		missing = append(missing, name)
	}

	ix.mu.Lock()
	// A video published between ReadDir and here would otherwise vanish from
	// the listing until the next scan.
	for id, meta := range ix.byID {
		if _, seen := next[id]; !seen {
			if _, err := os.Stat(filepath.Join(ix.layout.Videos, meta.FileName)); err == nil {
				next[id] = meta
			}
		}
	}
	ix.byID = next
	ix.rebuildLocked()
	ix.mu.Unlock()
	return missing, nil
}

// WriteMeta persists the metadata document. Callers publish the video file
// only after this returns, so a listed video always has metadata.
func (ix *Index) WriteMeta(meta Meta) error {
	return store.WriteJSON(ix.MetaPath(meta.VideoID), meta, 0o640)
}

func (ix *Index) Add(meta Meta) {
	ix.mu.Lock()
	ix.byID[meta.VideoID] = meta
	ix.rebuildLocked()
	ix.mu.Unlock()
}

func (ix *Index) Get(id string) (Meta, bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	m, ok := ix.byID[id]
	return m, ok
}

// List is newest first.
func (ix *Index) List() []Meta {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return append([]Meta(nil), ix.sorted...)
}

// BySourceID finds the video published from a given upload job.
func (ix *Index) BySourceID(sourceID string) (Meta, bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	for _, m := range ix.byID {
		if m.SourceID == sourceID && sourceID != "" {
			return m, true
		}
	}
	return Meta{}, false
}

func (ix *Index) Count() int {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return len(ix.sorted)
}

// Delete removes a video, its poster and its metadata. The file goes first,
// so a crash midway leaves orphaned metadata (cleaned by the next scan)
// rather than a listed video with no file.
func (ix *Index) Delete(id string) error {
	ix.mu.Lock()
	meta, ok := ix.byID[id]
	if ok {
		delete(ix.byID, id)
		ix.rebuildLocked()
	}
	ix.mu.Unlock()
	if !ok {
		return os.ErrNotExist
	}

	err := os.Remove(filepath.Join(ix.layout.Videos, meta.FileName))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, ext := range posterExtensions {
		_ = os.Remove(filepath.Join(ix.layout.Posters, id+ext))
	}
	_ = os.Remove(ix.MetaPath(id))
	return nil
}

func (ix *Index) rebuildLocked() {
	ix.sorted = ix.sorted[:0]
	for _, m := range ix.byID {
		ix.sorted = append(ix.sorted, m)
	}
	sort.Slice(ix.sorted, func(i, j int) bool {
		a, b := ix.sorted[i], ix.sorted[j]
		if !a.UploadedAt.Equal(b.UploadedAt) {
			return a.UploadedAt.After(b.UploadedAt)
		}
		return strings.Compare(a.FileName, b.FileName) < 0
	})
}

// PruneOrphanMeta removes metadata whose video no longer exists.
func (ix *Index) PruneOrphanMeta() {
	entries, err := os.ReadDir(ix.layout.Meta)
	if err != nil {
		return
	}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if id == entry.Name() {
			continue
		}
		if _, ok := ix.Get(id); ok {
			continue
		}
		name := FileNameFromID(id)
		if name == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(ix.layout.Videos, name)); errors.Is(err, os.ErrNotExist) {
			_ = os.Remove(filepath.Join(ix.layout.Meta, entry.Name()))
		}
	}
}
