package process

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Runner executes ffmpeg with the machine's constraints applied: lowest CPU
// and IO priority, a thread cap, a timeout, and a hard kill on cancellation.
type Runner struct {
	Threads     int
	Timeout     time.Duration
	VAAPIDevice string

	niceOnce sync.Once
	prefix   []string

	encoderOnce sync.Once
	encoder     Encoder
}

// command wraps ffmpeg in `nice -n 19 ionice -c3` on Linux, so an encode
// cannot starve the goroutines streaming video to viewers. Done per process
// rather than with systemd's Nice=, which would slow the server too.
func (r *Runner) command(ctx context.Context, name string, args ...string) *exec.Cmd {
	r.niceOnce.Do(func() {
		if runtime.GOOS != "linux" {
			return
		}
		if _, err := exec.LookPath("nice"); err == nil {
			r.prefix = append(r.prefix, "nice", "-n", "19")
		}
		if _, err := exec.LookPath("ionice"); err == nil {
			r.prefix = append(r.prefix, "ionice", "-c3")
		}
	})

	full := append(append([]string{}, r.prefix...), name)
	full = append(full, args...)
	cmd := exec.CommandContext(ctx, full[0], full[1:]...)
	configureProcess(cmd)
	return cmd
}

// tailBuffer keeps the last few KB of stderr for error messages.
type tailBuffer struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > 4096 {
		t.buf = t.buf[len(t.buf)-4096:]
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.buf))
}

// FFmpeg runs one ffmpeg invocation to completion.
func (r *Runner) FFmpeg(ctx context.Context, args ...string) error {
	ctx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()

	base := []string{"-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y"}
	cmd := r.command(ctx, "ffmpeg", append(base, args...)...)
	stderr := &tailBuffer{}
	cmd.Stderr = stderr

	err := cmd.Run()
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("ffmpeg timed out after %s", r.Timeout)
		}
		return ctx.Err()
	}
	msg := stderr.String()
	if len(msg) > 600 {
		msg = msg[len(msg)-600:]
	}
	return fmt.Errorf("ffmpeg: %w: %s", err, msg)
}

func (r *Runner) threadArgs() []string {
	if r.Threads <= 0 {
		return nil
	}
	return []string{"-threads", strconv.Itoa(r.Threads)}
}

// Encoder is an H.264 encoder profile used only for the rare full transcode.
type Encoder struct {
	Name       string
	InputArgs  []string
	OutputArgs []string
	Filter     string
}

// Quality-based rate control at source resolution: the old pipeline's 1280px
// cap and fixed 2 Mbps are gone, because videos are kept at full quality.
func (r *Runner) profiles() []Encoder {
	return []Encoder{
		{
			Name:       "h264_vaapi",
			InputArgs:  []string{"-vaapi_device", r.VAAPIDevice},
			OutputArgs: []string{"-c:v", "h264_vaapi", "-rc_mode", "CQP", "-qp", "20"},
			Filter:     "format=nv12,hwupload",
		},
		{
			Name:       "h264_nvenc",
			OutputArgs: []string{"-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "20", "-b:v", "0"},
			Filter:     "format=yuv420p",
		},
		{
			Name:       "h264_qsv",
			OutputArgs: []string{"-c:v", "h264_qsv", "-global_quality", "20"},
			Filter:     "format=nv12",
		},
		{
			Name:       "libx264",
			OutputArgs: append([]string{"-c:v", "libx264", "-preset", "veryfast", "-crf", "20"}, r.threadArgs()...),
			Filter:     "format=yuv420p",
		},
	}
}

// DetectEncoder probes encoders once, in order, with a one-second synthetic
// clip. VAAPI cannot be tested with a bare codec flag: it needs its device
// opened and frames uploaded, which the probe arguments include.
func (r *Runner) DetectEncoder(ctx context.Context) Encoder {
	r.encoderOnce.Do(func() {
		profiles := r.profiles()
		for _, p := range profiles {
			if p.Name == "h264_vaapi" && runtime.GOOS != "linux" {
				continue
			}
			args := []string{"-hide_banner", "-loglevel", "error"}
			args = append(args, p.InputArgs...)
			args = append(args, "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=5", "-vf", p.Filter)
			args = append(args, p.OutputArgs...)
			args = append(args, "-f", "null", "-")

			probeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := exec.CommandContext(probeCtx, "ffmpeg", args...).Run()
			cancel()
			if err == nil {
				r.encoder = p
				return
			}
		}
		r.encoder = profiles[len(profiles)-1]
	})
	return r.encoder
}

// Available reports whether a binary is on PATH.
func Available(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// HasEncoder reports whether this ffmpeg build lists an encoder by name.
func HasEncoder(ctx context.Context, name string) bool {
	out, err := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-encoders").Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), " "+name+" ")
}

func removeQuietly(path string) { _ = os.Remove(path) }
