// Package store holds the one persistence primitive the server needs: a JSON
// document written atomically. There is no database — the data set is a
// handful of users and one small file per video.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// ReadJSON decodes path into v and returns the file's modification time.
// A missing file returns an error satisfying os.IsNotExist.
func ReadJSON(path string, v any) (time.Time, error) {
	f, err := os.Open(path)
	if err != nil {
		return time.Time{}, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return time.Time{}, err
	}
	return info.ModTime(), json.NewDecoder(f).Decode(v)
}

// WriteJSON replaces path with the encoding of v such that a reader — or a
// crash — can only ever observe the old document or the new one, never a
// truncated mix: write a sibling temp file, fsync it, then rename over.
func WriteJSON(path string, v any, perm os.FileMode) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(path, data, perm)
}

func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		cleanup()
		return err
	}
	return nil
}
