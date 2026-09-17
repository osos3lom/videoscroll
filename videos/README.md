# Demo clips

`clip1.mp4`–`clip3.mp4` are the reels the GitHub Pages build plays when no
server is configured (`VITE_API_ORIGIN` unset). The build copies them into the
bundle.

This is **not** where community videos live. The server keeps those under
`MEDIA_DIR` (e.g. `/srv/videoscroll/videos/`). To add videos, either:

- use the **+** button in the app, or
- copy files into `MEDIA_DIR/inbox/`, or run `videoscroll import <files…>`.

Both routes go through the same pipeline: kept as-is when browser-playable,
remuxed for fast start when needed. See `docs/self-hosting.md`.
