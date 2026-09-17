package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/config"
	"github.com/osos3lom/videoscroll/server/internal/httpapi"
	"github.com/osos3lom/videoscroll/server/internal/jobs"
	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/process"
	"github.com/osos3lom/videoscroll/server/internal/store"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

func cmdServe(args []string) error {
	cfg, _, err := loadConfig("serve", args, nil)
	if err != nil {
		return err
	}

	layout := media.NewLayout(cfg.MediaDir)
	if err := layout.Ensure(); err != nil {
		return fmt.Errorf("media directory: %w", err)
	}

	secret, err := loadSecret(cfg, layout)
	if err != nil {
		return err
	}
	userStore, err := openUsers(layout)
	if err != nil {
		return err
	}

	index := media.NewIndex(layout)
	missing, err := index.Scan()
	if err != nil {
		return fmt.Errorf("scanning videos: %w", err)
	}

	runner := &process.Runner{Threads: cfg.FFmpegThreads, Timeout: cfg.TranscodeTimeout, VAAPIDevice: cfg.VAAPIDevice}
	pipeline := &process.Pipeline{Layout: layout, Index: index, Runner: runner}
	manager := jobs.NewManager(layout, index, pipeline, jobs.Options{
		MinFreeBytes: cfg.MinFreeBytes, MaxUploadBytes: cfg.MaxUploadBytes,
	})
	manager.Recover()
	manager.Backfill(missing)
	manager.QueueMissingPosters()
	manager.ScanInbox()

	api, err := httpapi.New(httpapi.Deps{
		Config: cfg, Layout: layout, Index: index, Users: userStore,
		Signer: auth.NewSigner(secret), Jobs: manager,
	})
	if err != nil {
		return err
	}
	defer api.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
		manager.Run(ctx)
	}()
	go func() {
		defer workers.Done()
		maintenance(ctx, index, manager, api)
	}()

	srv := &http.Server{
		Addr:    net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		Handler: api.Handler(),
		// Deliberately no WriteTimeout or ReadTimeout: either would cut off a
		// long video stream or a slow chunk upload. Uploads set their own
		// per-request deadline instead.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}

	logStartup(cfg, layout, index, userStore)

	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ListenAndServe() }()

	select {
	case err := <-serveErr:
		stop()
		workers.Wait()
		return err
	case <-ctx.Done():
	}

	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// In-flight video streams are dropped after the grace period; players
	// simply re-request the range once the server is back.
	if err := srv.Shutdown(shutdownCtx); err != nil {
		_ = srv.Close()
	}
	workers.Wait()
	return nil
}

func maintenance(ctx context.Context, index *media.Index, manager *jobs.Manager, api *httpapi.Server) {
	rescan := time.NewTicker(60 * time.Second)
	hourly := time.NewTicker(time.Hour)
	defer rescan.Stop()
	defer hourly.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-rescan.C:
			// Catches files added or removed by hand, and new inbox drops.
			if missing, err := index.Scan(); err == nil {
				manager.Backfill(missing)
			}
			manager.ScanInbox()
			api.SweepLimiters()
		case <-hourly.C:
			manager.Sweep()
			index.PruneOrphanMeta()
		}
	}
}

func logStartup(cfg config.Config, layout media.Layout, index *media.Index, userStore *users.Store) {
	slog.Info("listening", "addr", net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)))
	slog.Info("media", "dir", layout.Root, "videos", index.Count())
	if len(cfg.AllowedOrigins) == 0 {
		slog.Warn("ALLOWED_ORIGINS is empty: browsers on other origins (GitHub Pages) cannot use the API")
	} else {
		slog.Info("cors", "origins", strings.Join(cfg.AllowedOrigins, ","))
	}
	if !userStore.HasOwner() {
		slog.Warn("no owner account yet: run `videoscroll create-owner <username>`")
	}
	if !process.Available("ffmpeg") || !process.Available("ffprobe") {
		slog.Error("ffmpeg/ffprobe not found on PATH: uploads cannot be processed")
	}
}

// loadSecret returns SESSION_SECRET, or a random secret persisted once in
// data/secret.key so that tokens survive restarts with zero setup.
func loadSecret(cfg config.Config, layout media.Layout) ([]byte, error) {
	if cfg.SessionSecret != "" {
		if len(cfg.SessionSecret) < 32 {
			return nil, errors.New("SESSION_SECRET must be at least 32 characters")
		}
		return []byte(cfg.SessionSecret), nil
	}

	path := filepath.Join(layout.Data, "secret.key")
	if data, err := os.ReadFile(path); err == nil {
		secret := strings.TrimSpace(string(data))
		if len(secret) >= 32 {
			return []byte(secret), nil
		}
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	secret := hex.EncodeToString(raw)
	if err := store.WriteFileAtomic(path, []byte(secret+"\n"), 0o600); err != nil {
		return nil, fmt.Errorf("writing %s: %w", path, err)
	}
	slog.Info("generated session secret", "path", path)
	return []byte(secret), nil
}

func openUsers(layout media.Layout) (*users.Store, error) {
	if err := os.MkdirAll(layout.Data, 0o700); err != nil {
		return nil, err
	}
	s, err := users.Open(filepath.Join(layout.Data, "users.json"))
	if err != nil {
		return nil, fmt.Errorf("reading users: %w", err)
	}
	return s, nil
}
