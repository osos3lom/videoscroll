// Command videoscroll is the whole backend in one binary: the HTTP server and
// the owner's maintenance commands.
//
//	videoscroll serve
//	videoscroll create-owner <username>
//	videoscroll invite [-role viewer|uploader|owner] [-days 7]
//	videoscroll reset-password <username>
//	videoscroll users
//	videoscroll import <file>...
//	videoscroll doctor
//
// Every command reads .env.server from the working directory if present
// (or the file named by -env-file), then the process environment.
package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/osos3lom/videoscroll/server/internal/config"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	cmd, args := os.Args[1], os.Args[2:]
	commands := map[string]func([]string) error{
		"serve":          cmdServe,
		"create-owner":   cmdCreateOwner,
		"invite":         cmdInvite,
		"reset-password": cmdResetPassword,
		"users":          cmdUsers,
		"import":         cmdImport,
		"doctor":         cmdDoctor,
		"version": func([]string) error {
			fmt.Println(version)
			return nil
		},
	}

	run, ok := commands[cmd]
	if !ok {
		usage()
		os.Exit(2)
	}
	if err := run(args); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, strings.TrimSpace(`
usage: videoscroll <command> [flags]

commands:
  serve                     run the API server
  create-owner <username>   create the first owner account (prompts for password)
  invite                    create an invite code  [-role viewer|uploader|owner] [-days 7]
  reset-password <username> set a new password and sign the user out everywhere
  users                     list accounts
  import <file>...          copy videos into inbox/ for processing
  doctor                    check ffmpeg, storage and configuration
  version                   print the build version

every command accepts -env-file (default .env.server)
`)+"\n")
}

// loadConfig parses the shared -env-file flag plus any command flags.
func loadConfig(name string, args []string, define func(*flag.FlagSet)) (config.Config, *flag.FlagSet, error) {
	fs := flag.NewFlagSet(name, flag.ExitOnError)
	defaultEnvFile := ".env.server"
	if v := os.Getenv("VIDEOSCROLL_ENV_FILE"); v != "" {
		defaultEnvFile = v
	}
	// Flags must precede positional arguments: `create-owner -env-file X alice`.
	envFile := fs.String("env-file", defaultEnvFile, "environment file to read (or $VIDEOSCROLL_ENV_FILE)")
	if define != nil {
		define(fs)
	}
	if err := fs.Parse(args); err != nil {
		return config.Config{}, fs, err
	}
	if err := config.LoadEnvFile(*envFile); err != nil {
		return config.Config{}, fs, fmt.Errorf("reading %s: %w", *envFile, err)
	}
	cfg, err := config.Load()
	return cfg, fs, err
}
