# Drop your videos here

Copy any video files into this folder and they show up in the feed.

    videos/
      my-clip.mp4
      another.webm

Supported: `.mp4` `.webm` `.ogg` `.ogv` `.mov` `.m4v`

Notes:

- **`.mp4` (H.264 + AAC) is the safest bet.** `.mov` and some `.mp4` files use codecs
  browsers can't decode — if a video shows a black frame, re-encode it:
  `ffmpeg -i input.mov -c:v libx264 -c:a aac -movflags +faststart output.mp4`
- Vertical (9:16) footage looks best, but anything works — video is `object-fit: cover`.
- The feed sorts by filename. Prefix with numbers (`01-`, `02-`) to control order.
- Files are served by the app itself with HTTP range support, so seeking works.
- Nothing here is committed to git, and nothing leaves your machine.
