// Package config reads the server's runtime configuration from the
// environment. Every knob has a default that is safe on the target machine
// (4 GB RAM, one HDD, a residential uplink).
package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	// Loopback by default: Caddy terminates TLS and proxies here.
	Host string
	Port int

	// Root for videos/, posters/, meta/, incoming/, inbox/, failed/ and data/.
	MediaDir string

	// Exact origins allowed to call the API cross-origin, e.g. the GitHub
	// Pages origin and http://localhost:5173 for development.
	AllowedOrigins []string

	// Optional. When empty a random secret is generated once into
	// data/secret.key, so tokens survive restarts without manual setup.
	SessionSecret string

	// Public URL of the frontend, used only to print invite links.
	AppURL string

	// Uploads are refused when they would leave less than this free.
	MinFreeBytes int64
	// Per-upload ceiling.
	MaxUploadBytes int64

	// Thread cap for a software encode, so one core stays free for serving.
	FFmpegThreads int
	// How long a single ffmpeg run may take. Generous: a rare full transcode
	// at source resolution on an old CPU is slow.
	TranscodeTimeout time.Duration
	VAAPIDevice      string

	// Honour X-Forwarded-For only when the peer is loopback (i.e. Caddy).
	TrustLoopbackProxy bool
}

func Load() (Config, error) {
	c := Config{
		Host:               env("HOST", "127.0.0.1"),
		MediaDir:           env("MEDIA_DIR", "media"),
		SessionSecret:      os.Getenv("SESSION_SECRET"),
		AppURL:             strings.TrimRight(os.Getenv("APP_URL"), "/"),
		VAAPIDevice:        env("VAAPI_DEVICE", "/dev/dri/renderD128"),
		TrustLoopbackProxy: env("TRUST_PROXY", "loopback") == "loopback",
	}

	var err error
	if c.Port, err = envInt("PORT", 3000); err != nil {
		return c, err
	}
	if c.MinFreeBytes, err = envInt64("MIN_FREE_BYTES", 20<<30); err != nil {
		return c, err
	}
	if c.MaxUploadBytes, err = envInt64("MAX_UPLOAD_BYTES", 20<<30); err != nil {
		return c, err
	}
	if c.FFmpegThreads, err = envInt("FFMPEG_THREADS", 3); err != nil {
		return c, err
	}
	minutes, err := envInt("TRANSCODE_TIMEOUT_MINUTES", 360)
	if err != nil {
		return c, err
	}
	c.TranscodeTimeout = time.Duration(minutes) * time.Minute

	for _, origin := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		origin = strings.TrimRight(strings.TrimSpace(origin), "/")
		if origin != "" {
			c.AllowedOrigins = append(c.AllowedOrigins, origin)
		}
	}

	if c.MediaDir, err = filepath.Abs(c.MediaDir); err != nil {
		return c, err
	}
	return c, nil
}

// LoadEnvFile sets variables from a KEY=VALUE file, without overriding
// anything already present in the environment. A missing file is not an
// error: in production systemd's EnvironmentFile does this job instead.
func LoadEnvFile(path string) error {
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, value)
		}
	}
	return scanner.Err()
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	v, err := envInt64(key, int64(fallback))
	return int(v), err
}

func envInt64(key string, fallback int64) (int64, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %q is not an integer", key, raw)
	}
	return v, nil
}
