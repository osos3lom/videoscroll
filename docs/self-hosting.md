# Self-hosting VideoScroll

A private, invite-only video community. The frontend is on GitHub Pages; the
videos and the API run on an old Linux PC at home.

- [Architecture](#architecture)
- [Step 0: the network gate](#step-0-the-network-gate) ← do this first
- [Step 1: prepare the machine](#step-1-prepare-the-machine)
- [Step 2: install the server](#step-2-install-the-server)
- [Step 3: expose it over HTTPS](#step-3-expose-it-over-https)
- [Step 4: point the frontend at it](#step-4-point-the-frontend-at-it)
- [Step 5: invite people](#step-5-invite-people)
- [Adding videos](#adding-videos)
- [Operating it](#operating-it)
- [Security model](#security-model)
- [Local development](#local-development)

---

## Architecture

```
 phone / laptop                                          home PC (amd64 Linux, 4 GB, HDD)
┌──────────────────────────────────────┐              ┌──────────────────────────────────────────┐
│ https://<you>.github.io/videoscroll  │    HTTPS     │ Caddy :443  TLS, HSTS, token-free logs   │
│                                      │  ─────────▶  │   └▶ videoscroll :3000 (one Go binary)   │
│ React SPA                            │    CORS      │        auth · invites · users.json       │
│  • bearer token (localStorage)       │              │        range streaming (sendfile)        │
│  • prefetcher → IndexedDB chunks     │              │        chunked uploads → job queue       │
│  • sw.js serves cached video bytes   │              │        ffprobe / ffmpeg (nice, 1 job)    │
└──────────────────────────────────────┘              │ /srv/videoscroll                         │
                                                      │   videos/ posters/ meta/ data/           │
                                                      │   incoming/ inbox/ failed/               │
                                                      └──────────────────────────────────────────┘
```

There is no database, no Redis, no Node.js and no Docker on the PC. What runs
there is one ~8 MB static binary, ffmpeg, and Caddy.

### How a video gets from upload to your thumb

1. **Upload.** The browser sends the file in 8 MiB chunks, each at an explicit
   offset. If the connection drops or the tab closes, picking the same file again
   resumes from the last byte the server has. The bytes go to
   `incoming/<id>.part`, which is never listed or served.
2. **Queue.** Once complete, the file becomes `incoming/<id>.src`, and a job
   record is written next to it. Jobs run **one at a time** and survive
   restarts.
3. **Process.** Videos are **kept as-is**. `ffprobe` inspects the file, then the
   cheapest action that yields a browser-playable file is chosen:

   | Situation | Action | CPU cost |
   | --- | --- | --- |
   | MP4, H.264/HEVC/VP9/AV1, index at the front | **move** — byte-for-byte rename | none |
   | Index at the end, `.mov`/`.mkv`/`.webm` container, HEVC tagged `hev1` | **remux** — `-c copy -movflags +faststart` | seconds of disk IO |
   | Compatible video, incompatible audio (AC-3, PCM, FLAC…) | **audio** — video copied, audio → AAC | small |
   | Video codec no browser plays (ProRes, MPEG-2/4, WMV, 10-bit H.264…) | **transcode** — H.264 at *source resolution*, hardware encoder if present | high; rare |

   Resolution and quality are never reduced. ffmpeg runs at `nice 19` with
   the idle IO class, so it cannot starve streaming.
4. **Publish.** The output is written to `videos/<name>.tmp`, then the poster
   and `meta/<id>.json` are written, and only then is it renamed to its final
   name. A crash at any point leaves either nothing visible or a complete
   video. A file that cannot be processed goes to `failed/` with the error.
5. **Stream.** `GET /api/video/<id>?t=<media token>` is served by Go's
   `http.ServeContent`, with full range support and `sendfile`.
6. **Prefetch.** As you scroll, the app downloads the first ~6 seconds (1–8
   MiB) of the next two videos into IndexedDB. It fetches one video on a
   cellular connection and none with Data Saver. The service worker hands those
   bytes to the player when you swipe. Cached bytes expire after 48 hours, the
   cache is capped at 512 MB (or 5% of browser quota, if smaller), and it is
   wiped on sign-out.

---

## Step 0: the network gate

Everything else depends on the internet being able to reach your PC. **Check
these before installing anything.**

1. **Are you behind CGNAT?** Compare the WAN address shown in your router's
   status page with:

   ```bash
   curl -4 ifconfig.me
   ```

   If they differ, or the router shows `100.64.x.x`–`100.127.x.x` or a
   private range, you are behind CGNAT. Port forwarding will not work. Use
   [option B or C](#step-3-expose-it-over-https), or ask your ISP for a public
   IPv4 address (many fibre ISPs provide one on request).
2. **Does the ISP allow inbound 80/443?** After forwarding TCP 443 (and 80)
   to the PC, test from a phone *on mobile data*, not Wi-Fi:
   `https://<your-public-ip>` should at least reach something. Some ISPs block
   residential inbound ports.
3. **How fast is your upload?** Run a speed test from the PC. Upload speed,
   not the disk, decides how many people can watch at once:

   > concurrent smooth streams ≈ upload Mbps ÷ typical video bitrate

   Phone footage kept as-is is often 10–20 Mbps (1080p) or 40–50 Mbps (4K).
   A 100 Mbps uplink therefore serves about 5 people watching 1080p phone
   video at once, fewer while an upload is in progress. The HDD reads
   sequentially at ~800 Mbps, so it is not the bottleneck.

---

## Step 1: prepare the machine

Debian 12 / Ubuntu 22.04+ on amd64 (`uname -m` → `x86_64`).

```bash
sudo apt update && sudo apt install -y ffmpeg caddy curl
```

**Mount the big disk at `/srv/videoscroll`** with `noatime`, so every read
doesn't cost a metadata write on the HDD. In `/etc/fstab`:

```
UUID=<disk-uuid>  /srv/videoscroll  ext4  defaults,noatime  0  2
```

**Add swap** (or zram). With 4 GB of RAM, a rare full transcode of a large
file can spike memory. Swap turns a would-be OOM kill into slowness:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Mount the USB backup disk at `/mnt/videoscroll-backup`**. The old HDD is
otherwise the only copy of every video. Use `nofail`, so the PC still boots
when the disk is unplugged. The backup script refuses to run if nothing is
mounted there.

```
UUID=<usb-uuid>  /mnt/videoscroll-backup  ext4  defaults,noatime,nofail  0  2
```

**Check the HDD's health** before trusting it with a community's videos:

```bash
sudo apt install -y smartmontools
sudo smartctl -H -A /dev/sdX     # look at Reallocated_Sector_Ct and Current_Pending_Sector
sudo systemctl enable --now smartd
```

Non-zero reallocated or pending sectors on an old disk mean: replace it
before launch.

**Hardware encoding (optional).** If the PC has an Intel or AMD iGPU,
`videoscroll doctor` reports `h264_vaapi` and full transcodes use it. It is
only needed for unplayable codecs, so this is a nice-to-have.

---

## Step 2: install the server

Build the Linux binary on your dev machine (any OS with Go installed):

```bash
npm run build:server:linux     # → dist-server/videoscroll
```

Or download the `videoscroll-linux-amd64` artifact from the **Server (Go) and
end-to-end** GitHub Actions run.

On the PC, clone the repo (the install script needs `deploy/` and
`.env.example` from it), put the binary next to it, and run:

```bash
git clone https://github.com/osos3lom/videoscroll.git && cd videoscroll
sudo ./deploy/install.sh ~/videoscroll        # path to the downloaded binary
```

The script is idempotent. It:

- installs ffmpeg and rsync if missing
- creates the `videoscroll` system user
- creates the media directories
- installs the binary to `/opt/videoscroll`, keeping the previous one for
  rollback
- creates `/etc/videoscroll.env`, only if it doesn't exist yet
- installs and starts the server, and enables the nightly backup timer
- runs `doctor`

Then:

```bash
sudoedit /etc/videoscroll.env        # set ALLOWED_ORIGINS=https://<you>.github.io
sudo systemctl restart videoscroll
sudo -u videoscroll /opt/videoscroll/videoscroll create-owner -env-file /etc/videoscroll.env <username>
```

`create-owner` prompts for the password with echo off. It is never passed on
the command line, where it would land in shell history and `ps`.

---

## Step 3: expose it over HTTPS

Pick **one**.

### Option A: port forward + Caddy + DuckDNS (default)

Requires passing Step 0 (no CGNAT, inbound 443 open).

1. Create a DuckDNS name and keep it updated:

   ```bash
   printf 'DUCKDNS_DOMAIN=myname\nDUCKDNS_TOKEN=<token>\n' | sudo tee /etc/duckdns.env
   sudo chmod 600 /etc/duckdns.env
   sudo cp deploy/duckdns-update.* /etc/systemd/system/
   sudo systemctl enable --now duckdns-update.timer
   ```

2. Forward TCP 443 and 80 on the router to the PC.
3. Put your hostname in `deploy/Caddyfile`, then:

   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
   ```

Caddy fetches and renews the certificate itself. The API is now at
`https://myname.duckdns.org`.

### Option B: Tailscale (most private)

The server is not on the public internet at all: only devices in your tailnet
can reach it. It works behind CGNAT. The trade-off is that every member
installs the Tailscale app and you invite them to the tailnet.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
```

The API is at `https://<machine>.<tailnet>.ts.net`, and Tailscale provides the
certificate. Skip Caddy. The GitHub Pages site stays public but is useless
without tailnet access. The server already answers Chrome's local-network
permission preflight (`Access-Control-Allow-Private-Network`).

### Option C: Cloudflare Tunnel

Works behind CGNAT with no open ports, and hides your home IP. Uploads work
because every request is at most 8 MiB, under Cloudflare's 100 MB body limit.

Trade-offs:

- Cloudflare terminates TLS, so it can see the traffic.
- Their terms discourage using the free plan to serve large amounts of video.
  A small private community may be fine; decide deliberately.

```bash
cloudflared tunnel create videoscroll
cloudflared tunnel route dns videoscroll api.example.com
# config: ingress → service: http://127.0.0.1:3000
```

---

## Step 4: point the frontend at it

In the GitHub repo: **Settings → Secrets and variables → Actions → Variables
→ New repository variable**:

| Name | Value |
| --- | --- |
| `VITE_API_ORIGIN` | `https://myname.duckdns.org` (no trailing slash) |

Re-run the **Deploy static site to GitHub Pages** workflow. The published site
now requires sign-in and includes the service worker. Without the variable it
is a demo that plays three bundled clips.

`ALLOWED_ORIGINS` on the server must contain the Pages origin exactly, e.g.
`https://osos3lom.github.io` (origin only, no `/videoscroll` path).

> **Recommended: a custom domain for Pages.** `*.github.io` is a single browser
> origin shared by *every* Pages site on your account, and the session token
> lives in that origin's localStorage. A custom domain (e.g.
> `videos.example.com`, set in the repo's Pages settings) gives the app an
> origin of its own. Update `ALLOWED_ORIGINS` to match.

---

## Step 5: invite people

Sign in on the site as the owner → **Profile → Manage community → Create
link**. Pick a role and an expiry, then send the link privately. Each link
creates exactly one account.

| Role | Watch | Upload / delete own videos | Manage members, invites, any video |
| --- | --- | --- | --- |
| viewer | ✓ | | |
| uploader | ✓ | ✓ | |
| owner | ✓ | ✓ | ✓ |

The code is in the URL fragment (`/join#code`). Browsers never send fragments
to servers, so it does not appear in any access log.

From the command line:

```bash
sudo -u videoscroll /opt/videoscroll/videoscroll invite -env-file /etc/videoscroll.env -role uploader -days 3
```

Changing someone's role, disabling them, or pressing **Sign out** next to
their name ends all of their sessions immediately, on every device, including
video links already loaded in their browser.

---

## Adding videos

- **From the app:** the **+** button (uploaders and owners). Large files are
  fine: uploads resume, and the server refuses (HTTP 507) any upload that would
  leave less than `MIN_FREE_BYTES` free.
- **In bulk:** copy files into `/srv/videoscroll/inbox/` with scp, rsync or a
  USB disk. The server picks up files that have been unchanged for 30 seconds,
  within a minute, and runs them through the same pipeline.

  ```bash
  rsync -av --progress ~/Videos/trip/ pc:/srv/videoscroll/inbox/
  ```

  Or, on the PC itself: `videoscroll import <files…>`.
- **Directly into `videos/`:** files placed there by hand are probed and
  postered but never rewritten. That only works if they are already
  browser-playable; prefer `inbox/`.

---

## Operating it

| Task | Command |
| --- | --- |
| Health check | `sudo -u videoscroll /opt/videoscroll/videoscroll doctor -env-file /etc/videoscroll.env` |
| Logs | `journalctl -u videoscroll -f` |
| List members | `… videoscroll users -env-file /etc/videoscroll.env` |
| Reset a password | `… videoscroll reset-password -env-file /etc/videoscroll.env <username>` |
| Queue, disk, failures | Profile → Manage community |
| Why did a video fail? | `cat /srv/videoscroll/failed/*.json` |

### Updating and rolling back

```bash
cd ~/videoscroll && git pull
sudo ./deploy/install.sh ~/videoscroll-new    # the new binary
```

The binary is swapped atomically and the service restarts. Queued jobs
resume, and in-progress uploads continue from their offset. The previous
binary is kept, so if the new one misbehaves:

```bash
sudo ./deploy/install.sh --rollback
```

Running `--rollback` again swaps forward. Frontend problems roll back
separately: revert the commit, or delete the `VITE_API_ORIGIN` variable and
re-run the Pages workflow to fall back to the demo.

### Backups

`videoscroll-backup.timer` runs `/opt/videoscroll/backup.sh` nightly at about
03:30, at idle CPU and IO priority. Settings live in
`/etc/videoscroll-backup.env`. Each run:

- **mirrors** `videos/`, `posters/` and `meta/` to
  `/mnt/videoscroll-backup/videoscroll/`. Deletions reach the backup only on
  Sundays, so a video deleted by mistake stays recoverable for up to a week.
- **snapshots** `data/` (accounts, invites, session secret) as dated tarballs,
  keeping 30. They are mode 600 because they contain password hashes and the
  signing key.
- **records** `last-success`. `doctor` warns when it is older than 48 hours.

```bash
sudo systemctl start videoscroll-backup      # run now
journalctl -u videoscroll-backup             # what happened
systemctl list-timers videoscroll-backup     # when it runs next
```

### Restoring

Practice this once before launch, then quarterly. A restore drill that
touches nothing live:

```bash
B=/mnt/videoscroll-backup/videoscroll
T=$(mktemp -d)
sudo cp -r "$B"/videos "$B"/posters "$B"/meta "$T"/
sudo tar -xzf "$(ls -1t "$B"/data-snapshots/*.tar.gz | head -1)" -C "$T"
sudo chown -R videoscroll: "$T"
sudo -u videoscroll env MEDIA_DIR="$T" PORT=3999 ALLOWED_ORIGINS=http://localhost \
  /opt/videoscroll/videoscroll serve -env-file /dev/null &
curl -s localhost:3999/api/health        # {"ok":true}; the log lists the video count
kill %1 && sudo rm -rf "$T"
```

**For a real restore** onto a new disk: stop `videoscroll`, copy the same
folders plus the extracted `data/` into `/srv/videoscroll`, run
`chown -R videoscroll:`, and start it again. Accounts and sign-ins carry
over, because the snapshot includes the session secret.

**If the machine is off:** members see "Can't reach the server". Nothing is
lost, and the app retries on its own.

---

## Security model

- **Every API route and every media byte requires authentication**, enforced
  by the server. The login screen in the SPA is only a convenience.
- **Session tokens** are HMAC-signed, last 30 days, and are sent as
  `Authorization: Bearer`. No cookies are used, so there is no CSRF and no
  third-party-cookie problem.
- **Media tokens** are separate, scoped to media only, and valid 6–12 hours.
  They are needed because `<video>` cannot send headers. A media token cannot be
  used to act on the account. Caddy's log format strips them.
- **Revocation:** each token embeds the user's session version. Changing a
  password, role or disabled state, or using "sign out everywhere", bumps the
  version and kills every outstanding token at once.
- **Passwords** are hashed with argon2id (19 MiB, t=2). At most two hashes run
  concurrently, so login floods cannot exhaust RAM.
- **Login limits count failures only:**
  - 10 per address and account
  - 20 per address
  - 200 per account, a backstop against guessing spread over many addresses

  All three reset every 15 minutes. Someone guessing at your username
  exhausts their own budget but cannot lock you out from your own
  connection.
- **Invite codes** have 128 bits of entropy, are single-use, expire, and are
  stored only as SHA-256 hashes.
- **Media files** are opened through Go's `os.Root`, so no id can escape
  `videos/`. Responses are `Cache-Control: private`.
- **The published bundle** reveals the API hostname, but nothing behind it
  works without an account. The page sets a Content-Security-Policy and
  `Referrer-Policy: no-referrer`.
- **On-device cache** is temporary (48 h), capped, never marked persistent, and
  cleared on sign-out.

---

## Local development

Requirements: Node 20.19+, Go (see `server/go.mod`), ffmpeg on `PATH`.

```bash
npm install
cp .env.example .env.server      # then set MEDIA_DIR=media and
                                 # ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173
npm run cli -- create-owner <username>
npm run cli -- import videos/clip1.mp4 videos/clip2.mp4 videos/clip3.mp4
npm run dev:server               # API on :3000 (builds the Go binary first)
npm run dev                      # UI on :5173, /api proxied to :3000
```

### Simulate production locally

```bash
npm run simulate                 # add -- --fresh to start from scratch
```

This runs the same topology as the live site on one machine:

- the Pages bundle at `http://localhost:4174/videoscroll/`
- the Go API at `http://localhost:3100`, a different origin

So CORS, the Content-Security-Policy, the base path, tokens and the service
worker all behave as in production. The first run creates an owner account
(the password is printed and saved in `.sim/credentials.json`) and imports the
demo clips. All state lives in `.sim/`. It needs no `.env.server`.

### Checks

```bash
npm run test:server              # go vet + go test (includes real-ffmpeg pipeline tests)
npm run typecheck && npm run lint
npm run test:e2e                 # Playwright against a fresh simulation (installed Chrome)
```

The end-to-end suite starts its own simulation on ports 3101/4175 with state
in `.sim-e2e/`. It covers:

- the sign-in gate and login
- feed playback on desktop and phone viewports
- service-worker prefetch and the cache wipe on sign-out
- a resumable upload interrupted by closing the tab
- invite, join and role limits
- disabling a member

It uses the installed Google Chrome, because bundled Chromium lacks H.264. Set
`E2E_CHANNEL=msedge` to use Edge instead.

If a browser ever misbehaves with service-worker-served video, run
`localStorage.videoscroll_sw = 'off'` in its console and reload. That
unregisters the service worker, and playback goes straight to the network.
