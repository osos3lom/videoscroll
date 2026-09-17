package process

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/probe"
)

// These tests run the real ffmpeg against the committed demo clip. They are
// skipped where ffmpeg or the clip is unavailable.

func demoClip(t *testing.T) string {
	t.Helper()
	if !Available("ffmpeg") || !Available("ffprobe") {
		t.Skip("ffmpeg/ffprobe not on PATH")
	}
	_, here, _, _ := runtime.Caller(0)
	clip := filepath.Join(filepath.Dir(here), "..", "..", "..", "videos", "clip1.mp4")
	if _, err := os.Stat(clip); err != nil {
		t.Skip("demo clip not present")
	}
	return clip
}

func newPipeline(t *testing.T) *Pipeline {
	t.Helper()
	layout := media.NewLayout(t.TempDir())
	if err := layout.Ensure(); err != nil {
		t.Fatal(err)
	}
	return &Pipeline{
		Layout: layout,
		Index:  media.NewIndex(layout),
		Runner: &Runner{Threads: 2, Timeout: 2 * time.Minute},
	}
}

func ffmpeg(t *testing.T, args ...string) {
	t.Helper()
	cmd := exec.Command("ffmpeg", append([]string{"-hide_banner", "-loglevel", "error", "-y"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg %v: %v\n%s", args, err, out)
	}
}

func publish(t *testing.T, p *Pipeline, src, original string) media.Meta {
	t.Helper()
	meta, err := p.Publish(context.Background(), Input{
		SourcePath: src, OriginalName: original, UploaderID: "u1",
		UploadedAt: time.Now(), SourceID: "job-" + original,
	})
	if err != nil {
		t.Fatalf("publish %s: %v", original, err)
	}

	final := filepath.Join(p.Layout.Videos, meta.FileName)
	if _, err := os.Stat(final); err != nil {
		t.Fatalf("published file missing: %v", err)
	}
	if _, err := os.Stat(p.Index.MetaPath(meta.VideoID)); err != nil {
		t.Errorf("metadata missing: %v", err)
	}
	if p.Layout.PosterPath(meta.VideoID) == "" {
		t.Error("poster missing")
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("source was not consumed")
	}
	if ok, err := probe.MoovBeforeMdat(final); err != nil || !ok {
		t.Errorf("published file is not faststart (ok=%v err=%v)", ok, err)
	}
	if got, ok := p.Index.Get(meta.VideoID); !ok || got.Width == 0 || got.Duration == 0 {
		t.Errorf("index entry incomplete: %+v", got)
	}
	return meta
}

func TestPublishFaststartMP4IsMovedByteForByte(t *testing.T) {
	clip := demoClip(t)
	p := newPipeline(t)

	// Make a guaranteed-faststart copy first, since the demo clip's layout
	// is whatever it was committed with.
	src := filepath.Join(p.Layout.Incoming, "a.src")
	ffmpeg(t, "-i", clip, "-c", "copy", "-movflags", "+faststart", "-f", "mp4", src)
	original, _ := os.ReadFile(src)

	meta := publish(t, p, src, "Beach Day.mp4")
	if meta.Processing != string(ActionMove) {
		t.Errorf("processing = %s, want move", meta.Processing)
	}
	published, _ := os.ReadFile(filepath.Join(p.Layout.Videos, meta.FileName))
	if !bytes.Equal(original, published) {
		t.Error("a streaming-ready MP4 was modified")
	}
	if meta.Title != "Beach Day" {
		t.Errorf("title = %q", meta.Title)
	}
}

func TestPublishRemuxesWithoutReencoding(t *testing.T) {
	clip := demoClip(t)
	p := newPipeline(t)

	// A .mov container with the index at the end.
	src := filepath.Join(p.Layout.Incoming, "b.src")
	ffmpeg(t, "-i", clip, "-c", "copy", "-f", "mov", src)
	before, err := probe.Run(context.Background(), src)
	if err != nil {
		t.Fatal(err)
	}

	meta := publish(t, p, src, "phone.mov")
	if meta.Processing != string(ActionRemux) {
		t.Errorf("processing = %s, want remux", meta.Processing)
	}

	after, err := probe.Run(context.Background(), filepath.Join(p.Layout.Videos, meta.FileName))
	if err != nil {
		t.Fatal(err)
	}
	bv, _ := before.Video()
	av, _ := after.Video()
	if bv.CodecName != av.CodecName || bv.Width != av.Width || bv.Height != av.Height || bv.BitRate != av.BitRate {
		t.Errorf("video stream changed: before %+v after %+v", bv, av)
	}
}

func TestPublishTranscodesUnplayableCodecAtSourceResolution(t *testing.T) {
	clip := demoClip(t)
	p := newPipeline(t)

	src := filepath.Join(p.Layout.Incoming, "d.src")
	ffmpeg(t, "-i", clip, "-t", "2", "-c:v", "mpeg4", "-q:v", "4", "-c:a", "mp3", "-f", "avi", src)
	before, _ := probe.Run(context.Background(), src)
	bv, _ := before.Video()

	meta := publish(t, p, src, "camcorder.avi")
	if meta.Processing != string(ActionTranscode) || meta.VideoCodec != "h264" {
		t.Errorf("processing = %s codec = %s", meta.Processing, meta.VideoCodec)
	}
	w, h := bv.DisplaySize()
	if meta.Width != w || meta.Height != h {
		t.Errorf("resolution changed: %dx%d -> %dx%d", w, h, meta.Width, meta.Height)
	}
	if meta.AudioCodec != "mp3" {
		t.Errorf("compatible audio was re-encoded to %s", meta.AudioCodec)
	}
}

func TestPublishRejectsAudioOnly(t *testing.T) {
	demoClip(t)
	p := newPipeline(t)
	src := filepath.Join(p.Layout.Incoming, "c.src")
	ffmpeg(t, "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac", "-f", "mp4", src)

	if _, err := p.Publish(context.Background(), Input{SourcePath: src, OriginalName: "song.mp4"}); err != ErrNoVideoStream {
		t.Fatalf("err = %v, want ErrNoVideoStream", err)
	}
	entries, _ := os.ReadDir(p.Layout.Videos)
	if len(entries) != 0 {
		t.Errorf("something was published: %v", entries)
	}
}
