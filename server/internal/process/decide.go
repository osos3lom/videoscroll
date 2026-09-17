// Package process turns an uploaded or imported file into a published video.
//
// The guiding rule is "keep videos as-is": a stream the browser can already
// decode is never re-encoded. Only the container is fixed when needed, and a
// full transcode happens only when the video codec itself is unplayable.
package process

import (
	"errors"
	"strings"

	"github.com/osos3lom/videoscroll/server/internal/probe"
)

type Action string

const (
	// The file is already a streaming-ready MP4: rename it into place.
	ActionMove Action = "move"
	// Rewrite the container only (-c copy), e.g. to move the index to the
	// front or to get out of MKV/WebM.
	ActionRemux Action = "remux"
	// Keep the video stream bit-for-bit; convert only the audio to AAC.
	ActionAudio Action = "audio"
	// Re-encode the video at source resolution. The last resort.
	ActionTranscode Action = "transcode"
)

type Decision struct {
	Action Action
	// HEVC must carry the hvc1 sample entry tag for Safari to play it.
	TagHVC1 bool
	// Whether the audio stream can be copied.
	CopyAudio bool
	HasAudio  bool
	Reason    string
}

var ErrNoVideoStream = errors.New("file has no video stream")

// Browser-decodable video codecs. HEVC plays in Safari and in Chromium with
// hardware support; it is kept as-is by request rather than transcoded.
var compatibleVideo = map[string]bool{"h264": true, "hevc": true, "vp9": true, "av1": true}

// Browser-decodable audio codecs inside MP4.
var compatibleAudio = map[string]bool{"aac": true, "mp3": true, "opus": true}

// Decide chooses the cheapest action that yields a file browsers can play.
func Decide(p probe.Result, moovFirst bool) (Decision, error) {
	video, ok := p.Video()
	if !ok {
		return Decision{}, ErrNoVideoStream
	}
	audio, hasAudio := p.Audio()

	d := Decision{HasAudio: hasAudio, CopyAudio: !hasAudio || compatibleAudio[audio.CodecName]}

	if !videoPlayable(video) {
		d.Action = ActionTranscode
		d.Reason = "video codec " + describe(video) + " is not browser-playable"
		return d, nil
	}

	d.TagHVC1 = video.CodecName == "hevc" && video.CodecTag != "hvc1"

	switch {
	case !d.CopyAudio:
		d.Action = ActionAudio
		d.Reason = "audio codec " + audio.CodecName + " is not browser-playable"
	case !p.IsMP4Family():
		d.Action = ActionRemux
		d.Reason = "container " + p.Format.FormatName + " is not MP4"
	case !moovFirst:
		d.Action = ActionRemux
		d.Reason = "index is at the end of the file"
	case d.TagHVC1:
		d.Action = ActionRemux
		d.Reason = "HEVC needs the hvc1 tag for Safari"
	case hasExtraStreams(p):
		// Subtitle and data tracks confuse some players; dropping them does
		// not touch the audio or video.
		d.Action = ActionRemux
		d.Reason = "dropping non-audio/video tracks"
	default:
		d.Action = ActionMove
		d.Reason = "already streaming-ready"
	}
	return d, nil
}

func videoPlayable(s probe.Stream) bool {
	if !compatibleVideo[s.CodecName] {
		return false
	}
	if s.CodecName == "h264" {
		// Browsers decode 8-bit 4:2:0 H.264 only. High 10 / 4:2:2 / 4:4:4
		// files are common from cameras and play nowhere.
		if strings.Contains(s.PixFmt, "10") || strings.Contains(s.PixFmt, "12") ||
			strings.Contains(s.PixFmt, "422") || strings.Contains(s.PixFmt, "444") {
			return false
		}
	}
	return true
}

func hasExtraStreams(p probe.Result) bool {
	videos, audios := 0, 0
	for _, s := range p.Streams {
		switch s.CodecType {
		case "video":
			videos++
		case "audio":
			audios++
		default:
			return true
		}
	}
	return videos > 1 || audios > 1
}

func describe(s probe.Stream) string {
	if s.PixFmt != "" {
		return s.CodecName + " (" + s.PixFmt + ")"
	}
	return s.CodecName
}
