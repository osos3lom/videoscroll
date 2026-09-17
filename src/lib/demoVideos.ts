import type { LocalVideo } from '../types/video'
import { staticUrl } from './apiUrl'

/**
 * Fallback reels shown when no backend is reachable — which is the normal state
 * of the GitHub Pages build whenever the self-hosted PC is off.
 *
 * These three clips and their posters are committed to the repo, so they are
 * served as plain static files out of this build's own `public/` directory. They
 * deliberately do NOT go through `/api/...`: in demo mode there is no API.
 *
 * The ids must be exactly `toVideoId(fileName)` — `v-${base64url(fileName)}` —
 * because that is what names the committed poster files.
 */
export const DEMO_VIDEOS: LocalVideo[] = [
    {
        videoId: 'v-Y2xpcDEubXA0',
        fileName: 'clip1.mp4',
        title: 'Reel 1 - Ocean Views',
        size: 6919876,
        src: staticUrl('videos/clip1.mp4'),
        poster: staticUrl('posters/v-Y2xpcDEubXA0.webp'),
    },
    {
        videoId: 'v-Y2xpcDIubXA0',
        fileName: 'clip2.mp4',
        title: 'Reel 2 - Coastal Breeze',
        size: 4106582,
        src: staticUrl('videos/clip2.mp4'),
        poster: staticUrl('posters/v-Y2xpcDIubXA0.webp'),
    },
    {
        videoId: 'v-Y2xpcDMubXA0',
        fileName: 'clip3.mp4',
        title: 'Reel 3 - Scenic Waves',
        size: 8203368,
        src: staticUrl('videos/clip3.mp4'),
        poster: staticUrl('posters/v-Y2xpcDMubXA0.webp'),
    },
]
