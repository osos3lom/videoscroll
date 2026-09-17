// Package probe inspects video files: ffprobe for streams, and a tiny MP4 box
// walker to tell whether a file is already laid out for streaming.
package probe

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type Stream struct {
	Index       int    `json:"index"`
	CodecType   string `json:"codec_type"`
	CodecName   string `json:"codec_name"`
	CodecTag    string `json:"codec_tag_string"`
	Profile     string `json:"profile"`
	PixFmt      string `json:"pix_fmt"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	BitRate     string `json:"bit_rate"`
	Disposition struct {
		AttachedPic int `json:"attached_pic"`
	} `json:"disposition"`
	Tags struct {
		Rotate string `json:"rotate"`
	} `json:"tags"`
	SideData []struct {
		Rotation float64 `json:"rotation"`
	} `json:"side_data_list"`
}

type Format struct {
	FormatName string `json:"format_name"`
	Duration   string `json:"duration"`
	BitRate    string `json:"bit_rate"`
	Size       string `json:"size"`
}

type Result struct {
	Streams []Stream `json:"streams"`
	Format  Format   `json:"format"`
}

// Video returns the first real video stream, skipping embedded cover art.
func (r Result) Video() (Stream, bool) {
	for _, s := range r.Streams {
		if s.CodecType == "video" && s.Disposition.AttachedPic == 0 {
			return s, true
		}
	}
	return Stream{}, false
}

func (r Result) Audio() (Stream, bool) {
	for _, s := range r.Streams {
		if s.CodecType == "audio" {
			return s, true
		}
	}
	return Stream{}, false
}

func (r Result) Duration() float64 {
	d, _ := strconv.ParseFloat(r.Format.Duration, 64)
	return d
}

func (r Result) Bitrate() int64 {
	b, _ := strconv.ParseInt(r.Format.BitRate, 10, 64)
	return b
}

// IsMP4Family is true for the ISO-BMFF containers (mp4, mov, m4v, 3gp).
func (r Result) IsMP4Family() bool {
	return strings.Contains(r.Format.FormatName, "mp4") || strings.Contains(r.Format.FormatName, "mov")
}

// Rotation in degrees from either the display matrix or the legacy tag.
func (s Stream) Rotation() int {
	for _, sd := range s.SideData {
		if sd.Rotation != 0 {
			return int(math.Round(sd.Rotation))
		}
	}
	r, _ := strconv.Atoi(s.Tags.Rotate)
	return r
}

// DisplaySize swaps width and height for video shot sideways.
func (s Stream) DisplaySize() (int, int) {
	rot := ((s.Rotation() % 360) + 360) % 360
	if rot == 90 || rot == 270 {
		return s.Height, s.Width
	}
	return s.Width, s.Height
}

// Run executes ffprobe on path.
func Run(ctx context.Context, path string) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-print_format", "json",
		"-show_format", "-show_streams",
		path)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 400 {
			msg = msg[:400]
		}
		return Result{}, fmt.Errorf("ffprobe failed: %w: %s", err, msg)
	}

	var result Result
	if err := json.Unmarshal(out, &result); err != nil {
		return Result{}, fmt.Errorf("ffprobe output: %w", err)
	}
	return result, nil
}

// MoovBeforeMdat walks the top-level boxes of an MP4 and reports whether the
// index (moov) precedes the media data (mdat). When it does, a browser can
// start playing from the first few hundred kilobytes; when it does not, the
// player must seek to the end of the file first, costing an extra round trip
// and, on some browsers, a stall.
func MoovBeforeMdat(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	return moovBeforeMdat(f)
}

func moovBeforeMdat(r io.ReadSeeker) (bool, error) {
	header := make([]byte, 16)
	var offset int64

	for range 1024 {
		if _, err := r.Seek(offset, io.SeekStart); err != nil {
			return false, err
		}
		if _, err := io.ReadFull(r, header[:8]); err != nil {
			return false, errors.New("no moov or mdat box found")
		}

		size := int64(binary.BigEndian.Uint32(header[:4]))
		boxType := string(header[4:8])
		headerLen := int64(8)

		switch size {
		case 1:
			if _, err := io.ReadFull(r, header[8:16]); err != nil {
				return false, err
			}
			size = int64(binary.BigEndian.Uint64(header[8:16]))
			headerLen = 16
		case 0:
			// Box extends to end of file; nothing can follow it.
			return boxType == "moov", nil
		}

		switch boxType {
		case "moov":
			return true, nil
		case "mdat":
			return false, nil
		}

		if size < headerLen {
			return false, errors.New("corrupt box header")
		}
		offset += size
	}
	return false, errors.New("too many boxes")
}
