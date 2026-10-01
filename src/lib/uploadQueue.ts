import { IMAGES_CHANGED_EVENT } from '../hooks/useImages'
import { VIDEOS_CHANGED_EVENT } from '../hooks/useVideos'
import type { MediaKind } from '../types/api'
import { ApiError } from './session'
import { cancelUpload, getUploadStatus, uploadFile } from './uploader'

/**
 * The upload queue: batches of up to 5 videos or 20 images, each file sent
 * with the existing resumable uploader (lib/uploader.ts). There is no second
 * upload path; this only decides what to send when, and keeps the state the
 * panel shows.
 *
 * A module-level store read through useSyncExternalStore, so the queue
 * survives moving between pages while files upload.
 */

export const BATCH_LIMIT: Record<MediaKind, number> = { video: 5, image: 20 }

/**
 * Dispatch with `detail: 'video' | 'image'`, inside a tap, to open the file
 * picker of the navbar's upload button from anywhere.
 */
export const PICK_UPLOAD_EVENT = 'videoscroll_pick_upload'

/** Files sent at once. The server writes them to one disk; more is not faster. */
const PARALLEL: Record<MediaKind, number> = { video: 2, image: 3 }

/** How often to ask whether the server has finished processing. */
const POLL_MS: Record<MediaKind, number> = { video: 4000, image: 1500 }

export const ACCEPT: Record<MediaKind, string> = {
    video: 'video/*',
    image: 'image/jpeg,image/png,image/webp,image/gif',
}

export type QueueState = 'waiting' | 'uploading' | 'processing' | 'done' | 'error'

export interface QueueItem {
    id: string
    kind: MediaKind
    name: string
    size: number
    state: QueueState
    percent: number
    resumed: boolean
    /** Object URL (image) or captured frame (video); absent until ready. */
    thumb?: string
    error?: string
    /** The published video or image id, once done. */
    mediaId?: string
}

interface Entry extends QueueItem {
    file: File
    controller?: AbortController
    uploadId?: string
    /** Object URLs to revoke when the item leaves the queue. */
    urls: string[]
}

export interface AddResult {
    added: number
    /** Why some files were left out, ready to show. */
    notice?: string
}

let entries: Entry[] = []
let snapshot: QueueItem[] = []
const listeners = new Set<() => void>()
let nextId = 1

function emit() {
    snapshot = entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        name: e.name,
        size: e.size,
        state: e.state,
        percent: e.percent,
        resumed: e.resumed,
        thumb: e.thumb,
        error: e.error,
        mediaId: e.mediaId,
    }))
    for (const listener of listeners) listener()
}

function update(id: string, patch: Partial<Entry>) {
    entries = entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    emit()
}

const find = (id: string) => entries.find((entry) => entry.id === id)

export function subscribeQueue(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getQueue(): QueueItem[] {
    return snapshot
}

const active = (entry: Entry) => entry.state === 'waiting' || entry.state === 'uploading' || entry.state === 'processing'

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif)$/i
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|mpe?g|3gp|m2?ts|mts|ogv|flv)$/i

function fits(kind: MediaKind, file: File): boolean {
    if (kind === 'image') return IMAGE_TYPES.has(file.type) || IMAGE_EXTENSIONS.test(file.name)
    return file.type.startsWith('video/') || VIDEO_EXTENSIONS.test(file.name)
}

const NOUN: Record<MediaKind, { one: string; many: string }> = {
    video: { one: 'فيديو', many: 'فيديوهات' },
    image: { one: 'صورة', many: 'صور' },
}

/**
 * Queues files picked together. A batch holds at most BATCH_LIMIT files of
 * its kind, counting the ones of that kind still in flight; extra files are
 * left out, and the notice says so.
 */
export function addFiles(kind: MediaKind, files: File[]): AddResult {
    const notices: string[] = []
    const wrong = files.filter((file) => !fits(kind, file))
    const heic = wrong.filter((file) => /\.hei[cf]$/i.test(file.name))
    let usable = files.filter((file) => fits(kind, file))

    if (heic.length > 0) notices.push('صور HEIC غير مدعومة. اخترها من معرض الصور ليحوّلها الهاتف إلى JPEG.')
    if (wrong.length > heic.length) {
        notices.push(`تم تجاهل ${wrong.length - heic.length} ملف ليس ${kind === 'video' ? 'فيديو' : 'صورة'}.`)
    }

    const limit = BATCH_LIMIT[kind]
    const inFlight = entries.filter((entry) => entry.kind === kind && active(entry)).length
    const room = Math.max(0, limit - inFlight)
    if (usable.length > room) {
        const noun = NOUN[kind]
        notices.push(
            room === 0
                ? `الحد ${limit} ${noun.many} في الدفعة الواحدة، والدفعة الحالية ممتلئة. انتظر حتى تنتهي.`
                : `الحد ${limit} ${noun.many} في الدفعة الواحدة. أُضيف أول ${room} وتُرك ${usable.length - room}.`
        )
        usable = usable.slice(0, room)
    }

    const added: Entry[] = usable.map((file) => {
        const urls: string[] = []
        let thumb: string | undefined
        if (kind === 'image') {
            thumb = URL.createObjectURL(file)
            urls.push(thumb)
        }
        return {
            id: `q${nextId++}`,
            kind,
            name: file.name,
            size: file.size,
            state: 'waiting',
            percent: 0,
            resumed: false,
            thumb,
            file,
            urls,
        }
    })
    entries = [...entries, ...added]
    emit()
    for (const entry of added) if (entry.kind === 'video') void captureFrame(entry.id)
    pump()
    return { added: added.length, notice: notices.join(' ') || undefined }
}

/** Starts waiting items while their kind has a free slot. */
function pump() {
    for (const kind of ['image', 'video'] as MediaKind[]) {
        let running = entries.filter((entry) => entry.kind === kind && entry.state === 'uploading').length
        for (const entry of entries) {
            if (running >= PARALLEL[kind]) break
            if (entry.kind !== kind || entry.state !== 'waiting') continue
            running++
            void run(entry.id)
        }
    }
}

const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
        })
    })

function published(entry: Entry, mediaId?: string) {
    window.dispatchEvent(new Event(entry.kind === 'image' ? IMAGES_CHANGED_EVENT : VIDEOS_CHANGED_EVENT))
    update(entry.id, { state: 'done', percent: 100, mediaId, error: undefined })
}

async function run(id: string) {
    const entry = find(id)
    if (!entry) return
    const controller = new AbortController()
    update(id, { state: 'uploading', controller, error: undefined })

    try {
        let status = await uploadFile(
            entry.file,
            ({ sent, total, resumedFrom }) =>
                update(id, { percent: Math.floor((sent / total) * 100), resumed: resumedFrom > 0 }),
            controller.signal,
            (created) => update(id, { uploadId: created.uploadId })
        )
        if (controller.signal.aborted) return
        if (status.state !== 'ready' && status.state !== 'failed') {
            update(id, { state: 'processing', percent: 100 })
            pump()
            for (;;) {
                await sleep(POLL_MS[entry.kind], controller.signal)
                if (controller.signal.aborted) return
                try {
                    status = await getUploadStatus(status.uploadId, controller.signal)
                } catch (error) {
                    if (controller.signal.aborted) return
                    // The record is swept a day after completion.
                    if (error instanceof ApiError && error.status === 404) break
                    continue
                }
                if (status.state === 'ready' || status.state === 'failed') break
            }
        }
        if (status.state === 'failed') {
            update(id, { state: 'error', error: status.error ?? 'فشلت المعالجة على الخادم' })
        } else {
            published(entry, status.videoId)
        }
    } catch (error) {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : 'فشل الرفع'
        update(id, { state: 'error', error: message })
    } finally {
        pump()
    }
}

/** Tries a failed item again. Bytes already on the server are kept. */
export function retry(id: string) {
    const entry = find(id)
    if (!entry || entry.state !== 'error') return
    update(id, { state: 'waiting', error: undefined })
    pump()
}

/**
 * Stops an item that has not reached the server's processing yet, and drops
 * its partial upload there. Processing cannot be stopped from the app.
 */
export function cancel(id: string) {
    const entry = find(id)
    if (!entry || entry.state === 'processing' || entry.state === 'done') return
    entry.controller?.abort()
    if (entry.uploadId && entry.state === 'uploading') void cancelUpload(entry.uploadId)
    remove(id, true)
}

/** Takes a finished, failed or cancelled item off the list. */
export function remove(id: string, force = false) {
    const entry = find(id)
    if (!entry || (!force && active(entry))) return
    for (const url of entry.urls) URL.revokeObjectURL(url)
    entries = entries.filter((e) => e.id !== id)
    emit()
    pump()
}

/** Clears every item that is no longer moving. */
export function clearFinished() {
    for (const entry of entries) if (!active(entry)) remove(entry.id)
}

/** On sign-out: stop everything and forget it. */
export function resetQueue() {
    for (const entry of entries) {
        entry.controller?.abort()
        for (const url of entry.urls) URL.revokeObjectURL(url)
    }
    entries = []
    emit()
}

/**
 * A small still from the start of a video, for its row. Best effort: a
 * format this browser cannot decode simply keeps the icon.
 */
async function captureFrame(id: string) {
    const entry = find(id)
    if (!entry) return
    const url = URL.createObjectURL(entry.file)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    try {
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('timeout')), 8000)
            video.addEventListener(
                'loadeddata',
                () => {
                    video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
                },
                { once: true }
            )
            video.addEventListener(
                'seeked',
                () => {
                    clearTimeout(timeout)
                    resolve()
                },
                { once: true }
            )
            video.addEventListener(
                'error',
                () => {
                    clearTimeout(timeout)
                    reject(new Error('decode'))
                },
                { once: true }
            )
        })
        const scale = 120 / Math.max(video.videoWidth, video.videoHeight, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        const thumb = canvas.toDataURL('image/jpeg', 0.7)
        if (find(id)) update(id, { thumb })
    } catch {
        // Keep the icon.
    } finally {
        video.removeAttribute('src')
        video.load()
        URL.revokeObjectURL(url)
    }
}
