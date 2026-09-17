import { CHUNK_SIZE, evict, getEntry, hasChunk, putChunk, touch } from './chunkStore'

/**
 * Downloads the opening seconds of upcoming videos into the chunk store, so
 * the next swipe starts instantly instead of waiting on the home uplink.
 *
 * - One request at a time: the server is a single HDD, and the viewer's own
 *   playback must win the bandwidth.
 * - Only the head of each file: with `+faststart` that is the index plus the
 *   first seconds of media, which is all a player needs to begin.
 * - Cancelled the moment the target list changes.
 */

const SECONDS_TO_PREFETCH = 6
const MIN_BYTES = 1 << 20
const MAX_BYTES = 8 << 20
/** Used when a video's bitrate is unknown (demo reels, old metadata). */
const FALLBACK_BYTES = 2 << 20

export interface PrefetchTarget {
    videoId: string
    src: string
    size: number
    bitrate?: number
}

function bytesWanted(target: PrefetchTarget): number {
    const estimate = target.bitrate
        ? (target.bitrate / 8) * SECONDS_TO_PREFETCH
        : FALLBACK_BYTES
    return Math.min(target.size, Math.max(MIN_BYTES, Math.min(MAX_BYTES, estimate)))
}

function parseTotal(contentRange: string | null): number | null {
    const match = contentRange ? /\/(\d+)$/.exec(contentRange) : null
    return match ? Number(match[1]) : null
}

/** Tells the active service worker what it can now serve from cache. */
function announce(key: string) {
    navigator.serviceWorker?.controller?.postMessage({ type: 'cache-updated', key })
}

class Prefetcher {
    private queue: PrefetchTarget[] = []
    private current: { videoId: string; controller: AbortController } | null = null
    private running = false
    private paused = false

    schedule(targets: PrefetchTarget[]) {
        const wanted = new Set(targets.map((t) => t.videoId))
        if (this.current && !wanted.has(this.current.videoId)) {
            this.current.controller.abort()
        }
        this.queue = targets.filter((t) => t.videoId !== this.current?.videoId)
        void this.run()
    }

    setPaused(paused: boolean) {
        this.paused = paused
        if (paused) this.current?.controller.abort()
        else void this.run()
    }

    private async run() {
        if (this.running) return
        this.running = true
        const kept: string[] = []
        try {
            while (!this.paused && this.queue.length > 0) {
                const target = this.queue.shift()!
                kept.push(target.videoId)
                const controller = new AbortController()
                this.current = { videoId: target.videoId, controller }
                try {
                    await this.fetchHead(target, controller.signal)
                } catch {
                    // Aborted or failed: a prefetch only ever buys a head start,
                    // so losing one is not worth surfacing.
                } finally {
                    this.current = null
                }
            }
        } finally {
            this.running = false
        }
        await evict(kept).catch(() => undefined)
    }

    private async fetchHead(target: PrefetchTarget, signal: AbortSignal) {
        const want = bytesWanted(target)
        const chunkCount = Math.ceil(want / CHUNK_SIZE)

        for (let index = 0; index < chunkCount; index++) {
            if (signal.aborted) return
            if (await hasChunk(target.videoId, index)) continue

            const start = index * CHUNK_SIZE
            const end = Math.min(start + CHUNK_SIZE, target.size) - 1
            if (start > end) return

            const response = await fetch(target.src, {
                headers: { Range: `bytes=${start}-${end}` },
                signal,
                mode: 'cors',
                credentials: 'omit',
            })
            // A 200 means the range was ignored and the whole file is coming:
            // exactly what prefetching must never do.
            if (response.status !== 206) {
                await response.body?.cancel()
                return
            }

            const total = parseTotal(response.headers.get('Content-Range')) ?? target.size
            const blob = await response.blob()
            if (blob.size !== end - start + 1) return

            await putChunk(target.videoId, index, blob, {
                total,
                etag: response.headers.get('ETag') ?? '',
                contentType: response.headers.get('Content-Type') ?? 'video/mp4',
            })
            announce(target.videoId)
        }
    }
}

export const prefetcher = new Prefetcher()

/** Marks a video as recently watched, protecting it from LRU eviction. */
export function markWatched(videoId: string) {
    void getEntry(videoId)
        .then((entry) => (entry ? touch(videoId) : undefined))
        .catch(() => undefined)
}
