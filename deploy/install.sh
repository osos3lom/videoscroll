#!/usr/bin/env bash
# Installs or upgrades videoscroll on a Debian/Ubuntu amd64 machine.
#
#   sudo ./deploy/install.sh path/to/videoscroll
#
# The binary comes from `npm run build:server:linux` (dist-server/videoscroll)
# or from the "server" GitHub Actions workflow artifact.
#
# Safe to re-run: it never overwrites /etc/videoscroll.env or anything under
# /srv/videoscroll, and it prints what it did. It does NOT install or reload
# Caddy, open ports, or create accounts — those steps are listed at the end.
set -euo pipefail

BINARY="${1:-dist-server/videoscroll}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEDIA_DIR=/srv/videoscroll
APP_DIR=/opt/videoscroll
ENV_FILE=/etc/videoscroll.env

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ "$(uname -m)" == "x86_64" ]] || die "this binary targets x86_64; this machine is $(uname -m)"
[[ -f "$BINARY" ]] || die "binary not found: $BINARY (build it with: npm run build:server:linux)"
head -c 4 "$BINARY" | grep -q "ELF" || die "$BINARY is not a Linux executable"

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
    say "installing ffmpeg"
    apt-get update -qq
    apt-get install -y -qq ffmpeg
fi

if ! id videoscroll >/dev/null 2>&1; then
    say "creating system user videoscroll"
    useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin videoscroll
fi
# Hardware encoding needs the GPU device groups, where they exist.
for group in render video; do
    getent group "$group" >/dev/null && usermod -aG "$group" videoscroll
done

say "media directories in $MEDIA_DIR"
install -d -o videoscroll -g videoscroll -m 750 "$MEDIA_DIR"
for dir in videos posters meta incoming inbox failed; do
    install -d -o videoscroll -g videoscroll -m 750 "$MEDIA_DIR/$dir"
done
install -d -o videoscroll -g videoscroll -m 700 "$MEDIA_DIR/data"

say "binary -> $APP_DIR/videoscroll"
install -d -m 755 "$APP_DIR"
install -m 755 "$BINARY" "$APP_DIR/videoscroll.new"
mv -f "$APP_DIR/videoscroll.new" "$APP_DIR/videoscroll"

if [[ ! -f "$ENV_FILE" ]]; then
    say "creating $ENV_FILE from .env.example — edit ALLOWED_ORIGINS"
    install -m 640 -o root -g videoscroll "$REPO_DIR/.env.example" "$ENV_FILE"
else
    say "keeping existing $ENV_FILE"
fi

say "systemd unit"
install -m 644 "$REPO_DIR/deploy/videoscroll.service" /etc/systemd/system/videoscroll.service
systemctl daemon-reload
systemctl enable videoscroll >/dev/null
systemctl restart videoscroll

say "running doctor"
sudo -u videoscroll "$APP_DIR/videoscroll" doctor -env-file "$ENV_FILE" || true

cat <<EOF

Installed. Remaining one-time steps (see docs/self-hosting.md):

  1. Edit $ENV_FILE: set ALLOWED_ORIGINS to your GitHub Pages origin, then
       sudo systemctl restart videoscroll
  2. Create the owner account:
       sudo -u videoscroll $APP_DIR/videoscroll create-owner -env-file $ENV_FILE <username>
  3. Put your hostname in deploy/Caddyfile, then
       sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
  4. Set the GitHub repository variable VITE_API_ORIGIN to https://<your hostname>
     and re-run the Pages workflow.

Logs:    journalctl -u videoscroll -f
Status:  sudo -u videoscroll $APP_DIR/videoscroll doctor -env-file $ENV_FILE
EOF
