/// <reference lib="webworker" />

/**
 * Serves the start of videos from the on-device chunk cache.
 *
 * The one rule this file must never break: **when in doubt, stay out of the
 * way.** A request is only intercepted if its first byte is already known to
 * be cached. Everything else — misses, unknown videos, non-range requests,
 * any error while deciding — goes straight to the network untouched, so the
 * service worker can make playback faster but never worse.
 *
 * Built separately into a single classic script (`sw.js`) by vite.config.mts.
 */

import { getEntry, headBytes, listEntries, readRange, type CacheEntry } from '../lib/mediaCache/chunkStore'

declare const self: ServiceWorkerGlobalScope

/**
 * respondWith() must be called synchronously, before any IndexedDB lookup
 * could finish, so the decision uses this in-memory mirror of what is cached.
 * It is filled at startup and kept current by messages from the page.
 */
const heads = new Map<string, CacheEntry>()
let loaded: Promise<void> | null = null

function loadHeads(): Promise<void> {
    if (!loaded) {
        loaded = listEntries()
            .then((entries) => {
                heads.clear()
                for (const entry of entries) heads.set(entry.key, entry)
            })
            .catch(() => {
                loaded = null
            })
    }
    return loaded
}

self.addEventListener('install', () => {
    void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
    event.waitUntil(Promise.all([self.clients.claim(), loadHeads()]))
})

self.addEventListener('message', (event) => {
    const data = event.data as { type?: string; key?: string } | undefined
    if (data?.type === 'cache-updated' && data.key) {
        const key = data.key
        event.waitUntil(
            getEntry(key).then((entry) => {
                if (entry) heads.set(key, entry)
                else heads.delete(key)
            })
        )
    } else if (data?.type === 'cache-cleared') {
        heads.clear()
    }
})

const VIDEO_PATH = /\/api\/video\/(v-[A-Za-z0-9_-]+)$/

function parseRange(header: string | null): { start: number; end: number | null } | null {
    const match = header ? /^bytes=(\d+)-(\d*)$/.exec(header.trim()) : null
    if (!match) return null
    return { start: Number(match[1]), end: match[2] === '' ? null : Number(match[2]) }
}

self.addEventListener('fetch', (event) => {
    const request = event.request
    if (request.method !== 'GET') return

    const url = new URL(request.url)
    const match = VIDEO_PATH.exec(url.pathname)
    if (!match) return

    if (!loaded) void loadHeads()

    const entry = heads.get(match[1])
    const range = parseRange(request.headers.get('Range'))
    if (!entry || !range) return
    if (range.start >= headBytes(entry)) return

    event.respondWith(respondFromCache(request, entry, range.start, range.end))
})

async function respondFromCache(
    request: Request,
    entry: CacheEntry,
    start: number,
    requestedEnd: number | null
): Promise<Response> {
    const total = entry.total
    const end = Math.min(requestedEnd ?? total - 1, total - 1)

    try {
        const cached = await readRange(entry.key, start, end)
        if (!cached || start > end) return fetch(request)

        const headers = new Headers({
            'Content-Type': entry.contentType,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
        })
        if (entry.etag) headers.set('ETag', entry.etag)

        // Fully cached: done.
        if (cached.end >= end) {
            return new Response(cached.blob, { status: 206, headers })
        }

        // Partly cached. The response must still be exactly the range asked
        // for — Safari rejects a short 206 — so the cached prefix is spliced
        // onto a network fetch of the remainder.
        const remainderStart = cached.end + 1
        const controller = new AbortController()
        const body = new ReadableStream<Uint8Array>({
            async start(stream) {
                try {
                    const reader = cached.blob.stream().getReader()
                    for (;;) {
                        const { done, value } = await reader.read()
                        if (done) break
                        stream.enqueue(value)
                    }

                    const network = await fetch(request.url, {
                        headers: { Range: `bytes=${remainderStart}-${end}` },
                        mode: 'cors',
                        credentials: 'omit',
                        signal: controller.signal,
                    })
                    const etag = network.headers.get('ETag')
                    if (network.status !== 206 || (entry.etag && etag && etag !== entry.etag)) {
                        throw new Error(`remainder fetch returned ${network.status}`)
                    }

                    const networkReader = network.body!.getReader()
                    for (;;) {
                        const { done, value } = await networkReader.read()
                        if (done) break
                        stream.enqueue(value)
                    }
                    stream.close()
                } catch (error) {
                    stream.error(error)
                }
            },
            cancel() {
                // The player moved on: stop pulling bytes over the uplink.
                controller.abort()
            },
        })
        return new Response(body, { status: 206, headers })
    } catch {
        return fetch(request)
    }
}
