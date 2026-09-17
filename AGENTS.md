# videoscroll

A private, invite-only, TikTok-style video community. **Two deployables from one repo**:

| | Frontend | Backend |
| --- | --- | --- |
| What | Vite + React SPA | one Go binary (`server/`) |
| Where | GitHub Pages (`/videoscroll/`) | old amd64 Linux PC, behind Caddy |
| Build | `npm run build:pages` → `dist/` | `npm run build:server:linux` → `dist-server/videoscroll` |
| Talks to | the API cross-origin, via `VITE_API_ORIGIN` | disk + ffmpeg |

With `VITE_API_ORIGIN` unset, the Pages build is a no-login demo of the three
bundled clips. Setup and operations are covered in `docs/self-hosting.md`.

History: this was Next.js, then Vite + Express, now Vite + Go. References to
`next`, `serwist`, `express`, `IS_ADMIN_BUILD`, `dist-local`, cookies or
`ADMIN_PASSWORD_HASH` are stale; delete them.

## Layout

```
index.html              app shell (static meta)
vite.config.mts         webmanifest, CSP meta, demo clips, sw.js build
src/                    browser only
  App.tsx               auth gate + routes (login, join, feed, likes, saved, profile, admin)
  types/api.ts          hand-mirrored Go wire types
  lib/apiUrl.ts         the single source of URL composition
  lib/session.ts        bearer token + apiFetch (401 → sign out + wipe cache)
  lib/uploader.ts       resumable chunked upload
  lib/mediaCache/       chunkStore (IndexedDB, DOM-free), prefetcher, network hints
  sw/sw.ts              service worker: serves cached video ranges
  hooks/useVideos.ts    the single source of video data
server/                 Go module
  cmd/videoscroll/      serve | create-owner | invite | reset-password | users | import | doctor
  internal/auth         tokens, argon2id, rate limiter
  internal/users        users + invites (data/users.json)
  internal/media        layout, ids, metadata index, disk free
  internal/probe        ffprobe + MP4 box walker
  internal/process      move/remux/audio/transcode decision, ffmpeg runner, publish
  internal/jobs         uploads + persistent single-worker queue
  internal/httpapi      routes, CORS, handlers
deploy/                 Caddyfile, systemd units, install.sh (+ --rollback), backup.sh + timer, DuckDNS timer
docs/self-hosting.md    setup and operations guide
```

## Rules that are load-bearing

- **Every API route and media byte is authorized server-side.** The SPA's
  login gate is only a convenience. `/api/health` is the only unauthenticated
  endpoint, and it returns nothing but `{"ok":true}`.
- **No cookies.** The frontend and API are on different sites, so a cookie
  would be third-party and Safari drops it. Sessions are `Authorization:
  Bearer`. `<video>` and poster loads can't send headers, so they carry a
  **media-scoped** token as `?t=`. A media token must never be accepted as a
  session token (`auth.Scope`).
- **Tokens embed the user's `ver`.** Revocation is `ver++`: password change,
  role change, disable, and "sign out everywhere" all do it. Any new
  privilege-affecting mutation must bump it too.
- **Media tokens are bucketed into 6 h windows** (`IssueMedia`), so repeated
  `/api/videos` calls return identical URLs and caches keep hitting. Don't add
  anything per-request to media URLs.
- **The API returns no URLs.** It sends `videoId` and `mediaToken`; the client
  builds every URL in `src/lib/apiUrl.ts`.
- **CORS is exact-origin (`ALLOWED_ORIGINS`), and every response has
  `Vary: Origin`.**
- **`<video>` elements must keep `crossOrigin="anonymous"`.** The service
  worker answers some range requests itself. For a non-CORS video, Chrome
  requires every range response to come from the same origin and aborts
  playback ("data source error") when network and service-worker responses
  mix. CORS mode also lets the prefetcher and the player share HTTP cache
  entries. `e2e/feed.spec.ts` catches a regression.
- **Keep videos as-is.** `process.Decide` picks the cheapest browser-playable
  path. Never re-encode a compatible stream, and never downscale. Full
  transcode is only for codecs no browser plays, at source resolution.
- **Publish order is fixed:** output to `videos/<name>.tmp` → poster →
  `meta/<id>.json` → rename to the final name → `index.Add`. `IsVideoFile`
  rejects `.tmp`/`.part`, so nothing unfinished is ever listed or served.
- **Never rename a published video.** `VideoID` is `v-` + base64url(fileName);
  it keys the poster, the metadata, the service worker cache and localStorage
  social data. Names are made unique with a millisecond prefix, so an id is
  never reused.
- **ffmpeg work is serialized** through `jobs.Manager.Run` (one goroutine),
  at `nice 19` / idle IO. The target has 4 GB of RAM; parallel encodes thrash.
- **Job state lives on disk** (`incoming/<id>.json` + `.part`/`.src`), so
  restarts resume. Upload chunks are accepted only at `offset == bytes on
  disk`; that one rule makes retries idempotent. The offset travels in the
  `Upload-Offset` header, not the query string, because browsers cache CORS
  preflights per URL.
- **No global `WriteTimeout`/`ReadTimeout` on the HTTP server.** They would cut
  off long streams. Per-request deadlines go through `http.ResponseController`.
- **Media is opened through `os.Root`** (`videosRoot`, `postersRoot`), never
  by joining user input onto a path.
- **The service worker must fall through to the network** on any miss, unknown
  video, non-range request, or doubt. It only calls `respondWith` when the
  first requested byte is known to be cached (the in-memory `heads` map), and
  it must return exactly the requested range: Safari rejects short 206s.
- **`chunkStore.ts` stays DOM-free.** The service worker imports it, and
  `tsconfig.sw.json` typechecks it against the WebWorker lib.
- **Sign-out wipes the media cache** (`clearSession`). Nothing from the
  community stays on a shared device.
- **Wire types are mirrored by hand.** Each interface in `src/types/api.ts`
  names its Go struct; change both together.
- **Overlays need `createPortal`.** `.navbar` has both a `transform` and a
  `backdrop-filter`, either of which makes it the containing block for
  `position: fixed` descendants.

## Commands

```bash
npm run dev                  # SPA on :5173, /api proxied to :3000
npm run dev:server           # build + run the Go API on :3000 (reads .env.server)
npm run cli -- <command>     # videoscroll CLI, e.g. create-owner, invite, doctor
npm run simulate             # production topology locally: Pages build :4174 + Go API :3100
npm run test:server          # go vet + go test (pipeline tests need ffmpeg)
npm run test:e2e             # Playwright against a fresh simulation (installed Chrome)
npm run typecheck            # app + service worker tsconfig projects
npm run lint
npm run build:pages          # -> dist/
npm run build:server         # -> dist-server/videoscroll(.exe), this OS
npm run build:server:linux   # -> dist-server/videoscroll, static linux/amd64
```

`scripts/server.mjs` wraps the Go toolchain so these work from any shell.
ffmpeg and ffprobe must be on `PATH`: they are hard runtime requirements.
