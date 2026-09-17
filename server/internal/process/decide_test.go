package process

import (
	"testing"

	"github.com/osos3lom/videoscroll/server/internal/probe"
)

func result(format string, streams ...probe.Stream) probe.Result {
	return probe.Result{Streams: streams, Format: probe.Format{FormatName: format}}
}

func video(codec, pixFmt, tag string) probe.Stream {
	return probe.Stream{CodecType: "video", CodecName: codec, PixFmt: pixFmt, CodecTag: tag}
}

func audio(codec string) probe.Stream {
	return probe.Stream{CodecType: "audio", CodecName: codec}
}

const mp4 = "mov,mp4,m4a,3gp,3g2,mj2"

func TestDecideKeepsCompatibleStreams(t *testing.T) {
	cases := []struct {
		name      string
		in        probe.Result
		moovFirst bool
		want      Action
	}{
		{"faststart h264/aac", result(mp4, video("h264", "yuv420p", "avc1"), audio("aac")), true, ActionMove},
		{"moov at end", result(mp4, video("h264", "yuv420p", "avc1"), audio("aac")), false, ActionRemux},
		{"mkv vp9/opus", result("matroska,webm", video("vp9", "yuv420p", ""), audio("opus")), false, ActionRemux},
		{"hevc hev1 tag", result(mp4, video("hevc", "yuv420p10le", "hev1"), audio("aac")), true, ActionRemux},
		{"hevc hvc1", result(mp4, video("hevc", "yuv420p10le", "hvc1")), true, ActionMove},
		{"ac3 audio", result(mp4, video("h264", "yuv420p", "avc1"), audio("ac3")), true, ActionAudio},
		{"prores", result(mp4, video("prores", "yuv422p10le", "apcn"), audio("pcm_s16le")), true, ActionTranscode},
		{"h264 high 10", result(mp4, video("h264", "yuv420p10le", "avc1"), audio("aac")), true, ActionTranscode},
		{"subtitle track", result(mp4, video("h264", "yuv420p", "avc1"), audio("aac"), probe.Stream{CodecType: "subtitle"}), true, ActionRemux},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d, err := Decide(tc.in, tc.moovFirst)
			if err != nil {
				t.Fatal(err)
			}
			if d.Action != tc.want {
				t.Errorf("action = %s (%s), want %s", d.Action, d.Reason, tc.want)
			}
		})
	}
}

func TestDecideRejectsAudioOnly(t *testing.T) {
	if _, err := Decide(result(mp4, audio("aac")), true); err != ErrNoVideoStream {
		t.Errorf("err = %v", err)
	}
}

func TestTranscodeCopiesCompatibleAudio(t *testing.T) {
	d, _ := Decide(result(mp4, video("mpeg2video", "yuv420p", ""), audio("aac")), true)
	if d.Action != ActionTranscode || !d.CopyAudio {
		t.Errorf("decision = %+v", d)
	}
}
