#!/usr/bin/env bash
# Nightly copy of the videoscroll media disk to a USB drive.
#
# Run by videoscroll-backup.timer; install.sh puts it at
# /opt/videoscroll/backup.sh. Settings come from /etc/videoscroll-backup.env:
#   MEDIA_DIR=/srv/videoscroll
#   BACKUP_DIR=/mnt/videoscroll-backup     (the USB disk's mount point)
#
# Layout on the backup disk:
#   videoscroll/videos/ posters/ meta/     mirror of the media disk
#   videoscroll/data-snapshots/            dated tarballs of accounts + secret
#   videoscroll/last-success               read by `videoscroll doctor`
set -euo pipefail

MEDIA_DIR="${MEDIA_DIR:-/srv/videoscroll}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/videoscroll-backup}"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-30}"

# Never write into an empty mount point: with the disk unplugged, that would
# silently fill the root filesystem instead of backing anything up.
if ! mountpoint -q "$BACKUP_DIR"; then
    echo "backup disk is not mounted at $BACKUP_DIR; nothing backed up" >&2
    exit 1
fi

dest="$BACKUP_DIR/videoscroll"
install -d -m 755 "$dest"
install -d -m 700 "$dest/data-snapshots"

# Additions are copied nightly. Deletions reach the backup only on Sundays, so
# a video deleted by mistake stays recoverable for up to a week.
delete_flag=()
if [[ "$(date +%u)" == 7 ]]; then
    delete_flag=(--delete)
fi

for dir in videos posters meta; do
    rsync -a "${delete_flag[@]}" \
        --exclude '*.tmp' --exclude '*.part' --exclude '.*' \
        "$MEDIA_DIR/$dir/" "$dest/$dir/"
done

# Accounts, invites and the session secret: small, so keep dated copies.
# Mode 600 — these contain password hashes and the token signing key.
snapshot="$dest/data-snapshots/data-$(date +%F).tar.gz"
( umask 077 && tar -czf "$snapshot.tmp" -C "$MEDIA_DIR" data )
mv -f "$snapshot.tmp" "$snapshot"

# Prune old snapshots.
mapfile -t old < <(ls -1t "$dest"/data-snapshots/data-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_SNAPSHOTS + 1))")
if ((${#old[@]})); then
    rm -f -- "${old[@]}"
fi

date -Iseconds > "$dest/last-success"
chmod 644 "$dest/last-success"
echo "backup complete: $(du -sh "$dest" | cut -f1) at $dest"
