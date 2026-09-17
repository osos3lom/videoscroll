package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"
	"time"

	"golang.org/x/term"

	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/process"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// readPassword prompts twice with echo off on a terminal. When stdin is not
// a terminal (scripts, tests) it reads one line. Never from argv, which
// would leak into shell history and `ps`.
func readPassword(prompt string) (string, error) {
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", err
		}
		return strings.TrimRight(line, "\r\n"), nil
	}

	fmt.Fprint(os.Stderr, prompt)
	first, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	fmt.Fprint(os.Stderr, "Repeat: ")
	second, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	if string(first) != string(second) {
		return "", errors.New("passwords do not match")
	}
	return string(first), nil
}

func storeFromArgs(name string, args []string, define func(*flag.FlagSet)) (*users.Store, *flag.FlagSet, media.Layout, error) {
	cfg, fs, err := loadConfig(name, args, define)
	if err != nil {
		return nil, fs, media.Layout{}, err
	}
	layout := media.NewLayout(cfg.MediaDir)
	if err := layout.Ensure(); err != nil {
		return nil, fs, layout, err
	}
	s, err := openUsers(layout)
	return s, fs, layout, err
}

func cmdCreateOwner(args []string) error {
	s, fs, _, err := storeFromArgs("create-owner", args, nil)
	if err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New("usage: videoscroll create-owner <username>")
	}
	password, err := readPassword("Password (min 10 characters): ")
	if err != nil {
		return err
	}
	user, err := s.Create(fs.Arg(0), password, users.RoleOwner)
	if err != nil {
		return err
	}
	fmt.Printf("created owner %q\n", user.Username)
	return nil
}

func cmdInvite(args []string) error {
	var role *string
	var days *int
	s, _, _, err := storeFromArgs("invite", args, func(fs *flag.FlagSet) {
		role = fs.String("role", "viewer", "viewer, uploader or owner")
		days = fs.Int("days", 7, "days until the invite expires (max 30)")
	})
	if err != nil {
		return err
	}
	if *days <= 0 || *days > 30 {
		return errors.New("-days must be between 1 and 30")
	}

	code, invite, err := s.CreateInvite(users.Role(*role), "cli", time.Duration(*days)*24*time.Hour)
	if err != nil {
		return err
	}
	fmt.Printf("invite code (%s, expires %s):\n  %s\n", invite.Role, invite.ExpiresAt.Local().Format(time.DateTime), code)
	if appURL := strings.TrimRight(os.Getenv("APP_URL"), "/"); appURL != "" {
		fmt.Printf("link:\n  %s/join#%s\n", appURL, code)
	}
	return nil
}

func cmdResetPassword(args []string) error {
	s, fs, _, err := storeFromArgs("reset-password", args, nil)
	if err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New("usage: videoscroll reset-password <username>")
	}
	user, ok := s.ByUsername(fs.Arg(0))
	if !ok {
		return fmt.Errorf("no user %q", fs.Arg(0))
	}
	password, err := readPassword("New password (min 10 characters): ")
	if err != nil {
		return err
	}
	if _, err := s.SetPassword(user.ID, password); err != nil {
		return err
	}
	fmt.Printf("password changed for %q; all their sessions are signed out\n", user.Username)
	return nil
}

func cmdUsers(args []string) error {
	s, _, _, err := storeFromArgs("users", args, nil)
	if err != nil {
		return err
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "USERNAME\tROLE\tSTATUS\tCREATED")
	for _, u := range s.List() {
		status := "active"
		if u.Disabled {
			status = "disabled"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", u.Username, u.Role, status, u.CreatedAt.Local().Format(time.DateOnly))
	}
	return w.Flush()
}

// cmdImport copies files into inbox/. The copy goes to a dot-file first, and
// the running server ignores dot-files and anything modified in the last 30
// seconds, so it never picks up a half-copied video.
func cmdImport(args []string) error {
	cfg, fs, err := loadConfig("import", args, nil)
	if err != nil {
		return err
	}
	if fs.NArg() == 0 {
		return errors.New("usage: videoscroll import <file>...")
	}
	layout := media.NewLayout(cfg.MediaDir)
	if err := layout.Ensure(); err != nil {
		return err
	}

	for _, src := range fs.Args() {
		name := filepath.Base(src)
		if !media.IsInputFile(name) {
			fmt.Fprintf(os.Stderr, "skipping %s: not a supported video file\n", src)
			continue
		}
		dst := filepath.Join(layout.Inbox, name)
		if _, err := os.Stat(dst); err == nil {
			dst = filepath.Join(layout.Inbox, fmt.Sprintf("%d-%s", time.Now().UnixMilli(), name))
		}
		if err := copyFile(src, filepath.Join(layout.Inbox, "."+filepath.Base(dst)+".importing"), dst); err != nil {
			return fmt.Errorf("%s: %w", src, err)
		}
		// The rename above was atomic, so this file is complete. Backdate it
		// past the inbox settle window meant for slow scp/rsync copies.
		past := time.Now().Add(-time.Minute)
		_ = os.Chtimes(dst, past, past)
		fmt.Printf("queued %s\n", name)
	}
	fmt.Println("the server imports inbox/ files within about a minute (or at next start)")
	return nil
}

func copyFile(src, tmp, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

func cmdDoctor(args []string) error {
	cfg, _, err := loadConfig("doctor", args, nil)
	if err != nil {
		return err
	}

	failures := 0
	check := func(ok bool, label, detail string) {
		mark := "ok  "
		if !ok {
			mark = "FAIL"
			failures++
		}
		fmt.Printf("[%s] %s", mark, label)
		if detail != "" {
			fmt.Printf(" — %s", detail)
		}
		fmt.Println()
	}
	warn := func(label, detail string) {
		fmt.Printf("[warn] %s — %s\n", label, detail)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	check(process.Available("ffmpeg"), "ffmpeg on PATH", "")
	check(process.Available("ffprobe"), "ffprobe on PATH", "")
	if process.Available("ffmpeg") {
		runner := &process.Runner{Threads: cfg.FFmpegThreads, Timeout: time.Minute, VAAPIDevice: cfg.VAAPIDevice}
		fmt.Printf("[info] transcode encoder (only used for unplayable codecs): %s\n", runner.DetectEncoder(ctx).Name)
		if !process.HasEncoder(ctx, "libwebp") {
			warn("libwebp", "not in this ffmpeg build; posters will be JPEG")
		}
	}

	layout := media.NewLayout(cfg.MediaDir)
	check(layout.Ensure() == nil, "media directory writable", layout.Root)
	probeFile := filepath.Join(layout.Incoming, ".doctor-write-test")
	writeErr := os.WriteFile(probeFile, []byte("ok"), 0o600)
	_ = os.Remove(probeFile)
	check(writeErr == nil, "can write incoming/", "")

	if free, err := media.FreeBytes(layout.Root); err == nil {
		check(free > cfg.MinFreeBytes, "free disk space",
			fmt.Sprintf("%.1f GiB free, uploads need more than %.1f GiB", float64(free)/(1<<30), float64(cfg.MinFreeBytes)/(1<<30)))
	}

	if s, err := openUsers(layout); err == nil {
		hint := ""
		if !s.HasOwner() {
			hint = "create one with `videoscroll create-owner <username>`"
		}
		check(s.HasOwner(), "owner account exists", hint)
	} else {
		check(false, "users.json readable", err.Error())
	}

	check(len(cfg.AllowedOrigins) > 0, "ALLOWED_ORIGINS set", strings.Join(cfg.AllowedOrigins, ", "))
	for _, origin := range cfg.AllowedOrigins {
		if strings.HasPrefix(origin, "http://") && !strings.Contains(origin, "localhost") && !strings.Contains(origin, "127.0.0.1") {
			warn("ALLOWED_ORIGINS", origin+" is plain HTTP")
		}
	}
	if cfg.Host != "127.0.0.1" && cfg.Host != "localhost" && cfg.Host != "::1" {
		warn("HOST", cfg.Host+" is not loopback; the API is reachable without Caddy's TLS")
	}

	if failures > 0 {
		return fmt.Errorf("%d check(s) failed", failures)
	}
	fmt.Println("all checks passed")
	return nil
}
