package media

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var posterExtensions = []string{".webp", ".jpg"}

// PosterPath returns the existing poster for id, or "" if there is none.
func (l Layout) PosterPath(videoID string) string {
	base := filepath.Base(videoID)
	for _, ext := range posterExtensions {
		p := filepath.Join(l.Posters, base+ext)
		if info, err := os.Stat(p); err == nil && info.Size() > 0 {
			return p
		}
	}
	return ""
}

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

// PublishedName builds a collision-free file name for a new video. The
// millisecond prefix is what guarantees a name — and therefore a video id —
// is never reused, even after a delete.
func (l Layout) PublishedName(original string, ext string) string {
	base := strings.TrimSuffix(filepath.Base(original), filepath.Ext(original))
	slug := strings.Trim(slugPattern.ReplaceAllString(strings.ToLower(base), "-"), "-")
	if len(slug) > 60 {
		slug = strings.Trim(slug[:60], "-")
	}
	if slug == "" {
		slug = "video"
	}

	for attempt := 0; ; attempt++ {
		name := fmt.Sprintf("%d-%s%s", time.Now().UnixMilli(), slug, ext)
		if attempt > 0 {
			name = fmt.Sprintf("%d-%s-%d%s", time.Now().UnixMilli(), slug, attempt, ext)
		}
		if _, err := os.Stat(filepath.Join(l.Videos, name)); errors.Is(err, os.ErrNotExist) {
			return name
		}
	}
}

// TitleFrom turns an original upload name into a display title.
func TitleFrom(original string) string {
	base := strings.TrimSuffix(filepath.Base(original), filepath.Ext(original))
	base = strings.TrimSpace(strings.NewReplacer("_", " ").Replace(base))
	if base == "" {
		return "Untitled"
	}
	if len(base) > 120 {
		base = base[:120]
	}
	return base
}

// MoveFile renames src to dst, falling back to copy-and-rename when the two
// are on different filesystems. dst appears atomically either way.
func MoveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}

	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return err
	}
	in.Close()
	return os.Remove(src)
}

// RemoveStaleTemp deletes leftovers of interrupted writes in dir. Only safe
// before the worker starts, since the worker is the only writer of these.
func RemoveStaleTemp(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		lower := strings.ToLower(entry.Name())
		if strings.HasSuffix(lower, ".tmp") || strings.Contains(lower, ".tmp.") {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}
