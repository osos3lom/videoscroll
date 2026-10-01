// Package media owns everything on the big disk: where files live, how videos
// are named and identified, their metadata, and their posters.
package media

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
)

// Layout is the directory structure under MEDIA_DIR.
type Layout struct {
	Root string
	// Published, playable files. A file appears here only once it is final.
	Videos string
	// Published photos, kept as uploaded. Private to their uploader.
	Images string
	// One poster image per video id, and one thumbnail per image id.
	Posters string
	// One JSON document per video id. Written before the video is published.
	Meta string
	// In-flight uploads (.part), finished uploads awaiting processing (.src)
	// and their job records (.json).
	Incoming string
	// Drop files here (scp, rsync) to import them through the same pipeline.
	Inbox string
	// Sources that could not be processed, with an error record.
	Failed string
	// users.json, secret.key, social.json.
	Data string
}

func NewLayout(root string) Layout {
	return Layout{
		Root:     root,
		Videos:   filepath.Join(root, "videos"),
		Images:   filepath.Join(root, "images"),
		Posters:  filepath.Join(root, "posters"),
		Meta:     filepath.Join(root, "meta"),
		Incoming: filepath.Join(root, "incoming"),
		Inbox:    filepath.Join(root, "inbox"),
		Failed:   filepath.Join(root, "failed"),
		Data:     filepath.Join(root, "data"),
	}
}

func (l Layout) Ensure() error {
	for _, dir := range []string{l.Videos, l.Images, l.Posters, l.Meta, l.Incoming, l.Inbox, l.Failed} {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
	}
	// Holds the session secret and password hashes.
	return os.MkdirAll(l.Data, 0o700)
}

// Extensions the pipeline accepts as input.
var inputExtensions = map[string]bool{
	".mp4": true, ".m4v": true, ".mov": true, ".webm": true, ".mkv": true,
	".avi": true, ".wmv": true, ".mpg": true, ".mpeg": true, ".3gp": true,
	".ts": true, ".m2ts": true, ".mts": true, ".ogv": true, ".flv": true,
}

// Extensions that may be served from videos/ as-is.
var servableExtensions = map[string]string{
	".mp4":  "video/mp4",
	".m4v":  "video/mp4",
	".mov":  "video/quicktime",
	".webm": "video/webm",
	".ogv":  "video/ogg",
}

func isTransient(lower string) bool {
	return strings.HasPrefix(lower, ".") ||
		strings.HasSuffix(lower, ".part") ||
		strings.HasSuffix(lower, ".tmp") ||
		strings.HasSuffix(lower, ".crdownload") ||
		strings.Contains(lower, ".tmp.")
}

// IsVideoFile reports whether name is a published, servable video. Anything
// still being written (.part, .tmp) is rejected, which is what keeps an
// unfinished file out of the listing and off the wire.
func IsVideoFile(name string) bool {
	lower := strings.ToLower(name)
	if name == "" || isTransient(lower) {
		return false
	}
	_, ok := servableExtensions[filepath.Ext(lower)]
	return ok
}

// IsInputFile reports whether name looks like a video worth importing.
func IsInputFile(name string) bool {
	lower := strings.ToLower(name)
	if name == "" || isTransient(lower) {
		return false
	}
	return inputExtensions[filepath.Ext(lower)]
}

func MimeType(name string) string {
	if t, ok := servableExtensions[strings.ToLower(filepath.Ext(name))]; ok {
		return t
	}
	return "application/octet-stream"
}

// VideoID is `v-` + base64url(fileName), unpadded. Stable and reversible, and
// identical to the id the previous server produced — posters and the
// browser's localStorage social data are keyed by it. Because the id is the
// filename, a published video must never be renamed.
func VideoID(fileName string) string {
	return "v-" + base64.RawURLEncoding.EncodeToString([]byte(fileName))
}

// FileNameFromID reverses VideoID, returning "" for anything malformed or
// anything that is not a plain file name.
func FileNameFromID(id string) string {
	if !strings.HasPrefix(id, "v-") {
		return ""
	}
	raw, err := base64.RawURLEncoding.DecodeString(id[2:])
	if err != nil {
		return ""
	}
	name := string(raw)
	if name != filepath.Base(name) || strings.ContainsAny(name, `/\`) || !IsVideoFile(name) {
		return ""
	}
	return name
}

// Image files, by extension, and their content types. HEIC is deliberately
// absent: browsers outside Safari cannot show it, and iOS converts to JPEG
// when a web page picks a photo.
var imageExtensions = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".gif":  "image/gif",
}

// IsImageFile reports whether name is a published, servable image.
func IsImageFile(name string) bool {
	lower := strings.ToLower(name)
	if name == "" || isTransient(lower) {
		return false
	}
	_, ok := imageExtensions[filepath.Ext(lower)]
	return ok
}

// IsHEIC is for a clearer refusal than "unsupported format".
func IsHEIC(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".heic" || ext == ".heif"
}

func ImageMimeType(name string) string {
	if t, ok := imageExtensions[strings.ToLower(filepath.Ext(name))]; ok {
		return t
	}
	return "application/octet-stream"
}

// ImageID is `i-` + base64url(fileName): the image counterpart of VideoID,
// with the same rule that a published file is never renamed. The prefixes
// keep the two kinds apart in meta/ and posters/.
func ImageID(fileName string) string {
	return "i-" + base64.RawURLEncoding.EncodeToString([]byte(fileName))
}

// ImageFileNameFromID reverses ImageID, returning "" for anything malformed.
func ImageFileNameFromID(id string) string {
	if !strings.HasPrefix(id, "i-") {
		return ""
	}
	raw, err := base64.RawURLEncoding.DecodeString(id[2:])
	if err != nil {
		return ""
	}
	name := string(raw)
	if name != filepath.Base(name) || strings.ContainsAny(name, `/\`) || !IsImageFile(name) {
		return ""
	}
	return name
}
