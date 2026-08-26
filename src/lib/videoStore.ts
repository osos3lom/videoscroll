import type { LocalVideo } from '../types/video'

/**
 * Persists uploaded video files in IndexedDB so they survive a page reload.
 * GitHub Pages serves this app as a static export (`output: 'export'`) —
 * there is no server to upload to, so storage has to live entirely in the
 * browser. IndexedDB (not localStorage) because it can hold Blobs directly
 * without the ~33% base64 bloat and the ~5-10MB localStorage quota.
 */

const DB_NAME = 'videoscroll'
const DB_VERSION = 1
const STORE_NAME = 'videos'
export const LOCAL_VIDEO_UPDATE_EVENT = 'videoscroll_local_video_update'

interface StoredVideoRecord {
    videoId: string
    fileName: string
    title: string
    size: number
    blob: Blob
    createdAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is not available in this browser'))
    }

    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)
            request.onupgradeneeded = () => {
                const db = request.result
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'videoId' })
                }
            }
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error ?? new Error('Failed to open video database'))
        })
    }

    return dbPromise
}

function toLocalVideo(record: StoredVideoRecord): LocalVideo {
    return {
        videoId: record.videoId,
        fileName: record.fileName,
        title: record.title,
        size: record.size,
        src: URL.createObjectURL(record.blob),
    }
}

/** Writes a picked file to IndexedDB and returns it as a ready-to-render LocalVideo. */
export async function addLocalVideo(file: File): Promise<LocalVideo> {
    const db = await openDb()
    const record: StoredVideoRecord = {
        videoId: `v-local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fileName: file.name,
        title: file.name.replace(/\.[^/.]+$/, ''),
        size: file.size,
        blob: file,
        createdAt: Date.now(),
    }

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).add(record)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('Failed to save video'))
        tx.onabort = () => reject(tx.error ?? new Error('Failed to save video'))
    })

    const video = toLocalVideo(record)
    window.dispatchEvent(new Event(LOCAL_VIDEO_UPDATE_EVENT))
    return video
}

/** Reads every stored video back out, newest first. */
export async function listLocalVideos(): Promise<LocalVideo[]> {
    const db = await openDb()
    const records = await new Promise<StoredVideoRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const request = tx.objectStore(STORE_NAME).getAll()
        request.onsuccess = () => resolve(request.result as StoredVideoRecord[])
        request.onerror = () => reject(request.error ?? new Error('Failed to read stored videos'))
    })

    return records.sort((a, b) => b.createdAt - a.createdAt).map(toLocalVideo)
}
