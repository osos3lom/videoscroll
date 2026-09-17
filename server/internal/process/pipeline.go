package process

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/probe"
)

type Pipeline struct {
	Layout media.Layout
	Index  *media.Index
	Runner *Runner

	posterOnce sync.Once
	posterWebP bool
}

type Input struct {
	// Source file, normally incoming/<id>.src. Consumed on success.
	SourcePath   string
	OriginalName string
	UploaderID   string
	UploadedAt   time.Time
	// Job id, recorded in the metadata so a crash between publishing and
	// updating the job record cannot publish the same upload twice.
	SourceID string
}

// Publish processes one source into a published video. The ordering is the
// point of this function:
//
//  1. write the output to videos/<name>.tmp (never listed, never served)
//  2. generate the poster from it
//  3. write meta/<id>.json
//  4. rename .tmp to the final name — the moment the video exists
//  5. add it to the in-memory index
//
// A crash at any step leaves either nothing visible or a complete video.
func (p *Pipeline) Publish(ctx context.Context, in Input) (media.Meta, error) {
	info, err := probe.Run(ctx, in.SourcePath)
	if err != nil {
		return media.Meta{}, err
	}

	ext := strings.ToLower(filepath.Ext(in.OriginalName))
	moovFirst := false
	if info.IsMP4Family() {
		moovFirst, _ = probe.MoovBeforeMdat(in.SourcePath)
	}
	// ffprobe reports every ISO-BMFF file as "mov,mp4,…", so a .mov with
	// perfect streams is still remuxed to get a genuine .mp4.
	if ext != ".mp4" && ext != ".m4v" {
		moovFirst = false
	}

	decision, err := Decide(info, moovFirst)
	if err != nil {
		return media.Meta{}, err
	}

	finalName := p.Layout.PublishedName(in.OriginalName, ".mp4")
	finalPath := filepath.Join(p.Layout.Videos, finalName)
	tmpPath := finalPath + ".tmp"
	videoID := media.VideoID(finalName)

	slog.Info("processing", "file", in.OriginalName, "action", decision.Action, "reason", decision.Reason)

	outputPath := tmpPath
	switch decision.Action {
	case ActionMove:
		// Nothing to write: the source is published as-is below.
		outputPath = in.SourcePath
	case ActionRemux, ActionAudio, ActionTranscode:
		if err := p.Runner.FFmpeg(ctx, p.buildArgs(ctx, decision, in.SourcePath, tmpPath)...); err != nil {
			removeQuietly(tmpPath)
			return media.Meta{}, err
		}
	}

	out := info
	if outputPath != in.SourcePath {
		if out, err = probe.Run(ctx, outputPath); err != nil {
			removeQuietly(tmpPath)
			return media.Meta{}, fmt.Errorf("output check: %w", err)
		}
	}

	if err := p.GeneratePoster(ctx, outputPath, videoID); err != nil {
		// A missing poster degrades the feed; it is not worth losing the video.
		slog.Warn("poster failed", "video", finalName, "err", err)
	}

	meta, err := buildMeta(out, outputPath, finalName, in, decision.Action)
	if err != nil {
		removeQuietly(tmpPath)
		return media.Meta{}, err
	}
	if err := p.Index.WriteMeta(meta); err != nil {
		removeQuietly(tmpPath)
		return media.Meta{}, err
	}

	if decision.Action == ActionMove {
		err = media.MoveFile(in.SourcePath, finalPath)
	} else {
		err = os.Rename(tmpPath, finalPath)
	}
	if err != nil {
		removeQuietly(tmpPath)
		removeQuietly(p.Index.MetaPath(videoID))
		return media.Meta{}, err
	}

	p.Index.Add(meta)
	if decision.Action != ActionMove {
		removeQuietly(in.SourcePath)
	}
	return meta, nil
}

func (p *Pipeline) buildArgs(ctx context.Context, d Decision, src, dst string) []string {
	var args []string
	var encoder Encoder
	if d.Action == ActionTranscode {
		encoder = p.Runner.DetectEncoder(ctx)
		args = append(args, encoder.InputArgs...)
	}

	args = append(args, "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "0")

	switch d.Action {
	case ActionTranscode:
		args = append(args, "-vf", encoder.Filter)
		args = append(args, encoder.OutputArgs...)
	default:
		args = append(args, "-c:v", "copy")
		if d.TagHVC1 {
			args = append(args, "-tag:v", "hvc1")
		}
	}

	if d.CopyAudio {
		args = append(args, "-c:a", "copy")
	} else {
		args = append(args, "-c:a", "aac", "-b:a", "192k")
	}

	return append(args, "-movflags", "+faststart", "-f", "mp4", dst)
}

// GeneratePoster writes posters/<id>.webp (or .jpg when this ffmpeg lacks
// libwebp) via a temp file and rename, so a poster path only ever holds a
// complete image. Posters are thumbnails, so unlike the video they are scaled.
func (p *Pipeline) GeneratePoster(ctx context.Context, videoPath, videoID string) error {
	p.posterOnce.Do(func() {
		probeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		p.posterWebP = HasEncoder(probeCtx, "libwebp")
	})

	ext, codecArgs := ".jpg", []string{"-c:v", "mjpeg", "-q:v", "4"}
	if p.posterWebP {
		ext, codecArgs = ".webp", []string{"-c:v", "libwebp", "-quality", "80"}
	}

	final := filepath.Join(p.Layout.Posters, filepath.Base(videoID)+ext)
	tmp := final + ".tmp"

	attempt := func(seek []string) error {
		ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
		defer cancel()
		args := append([]string{}, seek...)
		args = append(args, "-i", videoPath, "-frames:v", "1", "-vf", "scale='min(720,iw)':-2")
		args = append(args, codecArgs...)
		args = append(args, "-f", "image2", tmp)
		return p.Runner.FFmpeg(ctx, args...)
	}

	// Half a second in skips the black frame many clips open on; very short
	// clips need a retry from the first frame.
	err := attempt([]string{"-ss", "0.5"})
	if err != nil || fileEmpty(tmp) {
		err = attempt(nil)
	}
	if err != nil {
		removeQuietly(tmp)
		return err
	}
	if fileEmpty(tmp) {
		removeQuietly(tmp)
		return errors.New("ffmpeg produced an empty poster")
	}
	return os.Rename(tmp, final)
}

var timestampPrefix = regexp.MustCompile(`^\d{13}-`)

// Backfill registers a file that was placed in videos/ directly. It is never
// rewritten: its name is already its id.
func (p *Pipeline) Backfill(ctx context.Context, fileName string) error {
	path := filepath.Join(p.Layout.Videos, fileName)
	stat, err := os.Stat(path)
	if err != nil {
		return err
	}
	info, err := probe.Run(ctx, path)
	if err != nil {
		return err
	}
	if _, ok := info.Video(); !ok {
		return ErrNoVideoStream
	}

	videoID := media.VideoID(fileName)
	if p.Layout.PosterPath(videoID) == "" {
		if err := p.GeneratePoster(ctx, path, videoID); err != nil {
			slog.Warn("poster failed", "video", fileName, "err", err)
		}
	}

	in := Input{
		OriginalName: timestampPrefix.ReplaceAllString(fileName, ""),
		UploadedAt:   stat.ModTime(),
	}
	meta, err := buildMeta(info, path, fileName, in, "existing")
	if err != nil {
		return err
	}
	if err := p.Index.WriteMeta(meta); err != nil {
		return err
	}
	p.Index.Add(meta)
	return nil
}

// EnsurePoster regenerates a missing poster for a listed video.
func (p *Pipeline) EnsurePoster(ctx context.Context, meta media.Meta) error {
	if p.Layout.PosterPath(meta.VideoID) != "" {
		return nil
	}
	return p.GeneratePoster(ctx, filepath.Join(p.Layout.Videos, meta.FileName), meta.VideoID)
}

func buildMeta(info probe.Result, path, fileName string, in Input, action Action) (media.Meta, error) {
	stat, err := os.Stat(path)
	if err != nil {
		return media.Meta{}, err
	}
	video, _ := info.Video()
	width, height := video.DisplaySize()
	meta := media.Meta{
		VideoID:    media.VideoID(fileName),
		FileName:   fileName,
		Title:      media.TitleFrom(in.OriginalName),
		Size:       stat.Size(),
		UploadedAt: in.UploadedAt.UTC(),
		UploaderID: in.UploaderID,
		Duration:   info.Duration(),
		Width:      width,
		Height:     height,
		Bitrate:    info.Bitrate(),
		VideoCodec: video.CodecName,
		Processing: string(action),
		SourceID:   in.SourceID,
	}
	if audio, ok := info.Audio(); ok {
		meta.AudioCodec = audio.CodecName
	}
	if meta.Bitrate == 0 && meta.Duration > 0 {
		meta.Bitrate = int64(float64(meta.Size*8) / meta.Duration)
	}
	if meta.UploadedAt.IsZero() {
		meta.UploadedAt = time.Now().UTC()
	}
	return meta, nil
}

func fileEmpty(path string) bool {
	info, err := os.Stat(path)
	return err != nil || info.Size() == 0
}
