import { useEffect } from 'react'
import { IS_DEMO } from '../lib/apiUrl'
import { prefetchCount } from '../lib/mediaCache/network'
import { markWatched, prefetcher } from '../lib/mediaCache/prefetcher'
import { hasActiveServiceWorker } from '../lib/serviceWorker'
import type { LocalVideo } from '../types/video'

/**
 * Keeps the opening seconds of the next videos in the on-device cache.
 *
 * Does nothing without an active service worker: the IndexedDB chunks only
 * help if the service worker can hand them to the <video> element. The HTTP
 * cache is not relied on — media is served `Cache-Control: private` with a
 * 6-hour lifetime, and Safari barely caches media at all.
 */
export function usePrefetch(videos: LocalVideo[], activeIndex: number): void {
    useEffect(() => {
        if (IS_DEMO || !hasActiveServiceWorker()) return

        const active = videos[activeIndex]
        if (active) markWatched(active.videoId)

        const upcoming = videos.slice(activeIndex + 1, activeIndex + 1 + prefetchCount())
        prefetcher.schedule(
            upcoming.map((video) => ({
                videoId: video.videoId,
                src: video.src,
                size: video.size,
                bitrate: video.bitrate,
            }))
        )
    }, [videos, activeIndex])

    // A hidden tab should not keep spending the uplink.
    useEffect(() => {
        const onVisibility = () => prefetcher.setPaused(document.hidden)
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
    }, [])
}
