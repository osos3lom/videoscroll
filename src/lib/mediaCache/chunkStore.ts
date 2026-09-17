/**
 * Temporary on-device cache of video bytes, in fixed 1 MiB chunks.
 *
 * Shared by the page (which fills it) and the service worker (which serves
 * from it), so this module must stay DOM-free: IndexedDB, Blob and
 * navigator.storage only — all of which exist in both contexts.
 *
 * IndexedDB rather than OPFS: Blob values in IndexedDB work from a service
 * worker in every browser this targets, including iOS Safari, while OPFS
 * write access from a service worker does not.
 *
 * Everything here is disposable. Entries expire after 48 hours, the total is
 * capped, no persistent-storage grant is requested, and the whole database is
 * wiped on sign-out.
 */

export const CHUNK_SIZE = 1 << 20
const MAX_BUDGET_BYTES = 512 << 20
const QUOTA_FRACTION = 0.05
const ENTRY_TTL_MS = 48 * 60 * 60 * 1000

const DB_NAME = 'videoscroll-media'
const DB_VERSION = 1
const CHUNKS = 'chunks'
const ENTRIES = 'entries'

interface ChunkRecord {
    key: string
    index: number
    blob: Blob
}

export interface CacheEntry {
    /** The video id. Tokens rotate, ids do not, so this is the cache key. */
    key: string
    total: number
    etag: string
    contentType: string
    /** Bytes held, for the budget. */
    bytes: number
    /** Number of chunks cached contiguously from the start of the file. */
    headChunks: number
    createdAt: number
    lastAccess: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB unavailable'))
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)
            request.onupgradeneeded = () => {
                const db = request.result
                if (!db.objectStoreNames.contains(CHUNKS)) {
                    db.createObjectStore(CHUNKS, { keyPath: ['key', 'index'] })
                }
                if (!db.objectStoreNames.contains(ENTRIES)) {
                    db.createObjectStore(ENTRIES, { keyPath: 'key' })
                }
            }
            request.onsuccess = () => {
                const db = request.result
                // Another context upgrading or deleting the database.
                db.onversionchange = () => {
                    db.close()
                    dbPromise = null
                }
                resolve(db)
            }
            request.onerror = () => {
                dbPromise = null
                reject(request.error ?? new Error('Failed to open media cache'))
            }
        })
    }
    return dbPromise
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    })
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
}

function chunkRange(key: string): IDBKeyRange {
    return IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER])
}

export async function getEntry(key: string): Promise<CacheEntry | undefined> {
    const db = await openDb()
    return promisify<CacheEntry | undefined>(db.transaction(ENTRIES).objectStore(ENTRIES).get(key))
}

export async function listEntries(): Promise<CacheEntry[]> {
    const db = await openDb()
    return promisify<CacheEntry[]>(db.transaction(ENTRIES).objectStore(ENTRIES).getAll())
}

export async function hasChunk(key: string, index: number): Promise<boolean> {
    const db = await openDb()
    const count = await promisify(db.transaction(CHUNKS).objectStore(CHUNKS).count([key, index]))
    return count > 0
}

/**
 * Stores one chunk. Chunk `index` covers bytes [index·CHUNK_SIZE, …) and must
 * be exactly CHUNK_SIZE long unless it is the file's last chunk. A changed
 * ETag means the file is not the one cached, so the old entry is dropped.
 */
export async function putChunk(
    key: string,
    index: number,
    blob: Blob,
    meta: { total: number; etag: string; contentType: string }
): Promise<CacheEntry> {
    const db = await openDb()
    const existing = await getEntry(key)
    if (existing && existing.etag !== meta.etag) {
        await deleteEntry(key)
    }
    const base = existing && existing.etag === meta.etag ? existing : undefined

    const tx = db.transaction([CHUNKS, ENTRIES], 'readwrite')
    const chunks = tx.objectStore(CHUNKS)
    const entries = tx.objectStore(ENTRIES)

    const alreadyHad = base ? (await promisify(chunks.count([key, index]))) > 0 : false
    chunks.put({ key, index, blob } satisfies ChunkRecord)

    // Recount the contiguous head: chunk 0, 1, 2… with no gaps.
    let headChunks = base?.headChunks ?? 0
    if (index === headChunks) {
        headChunks++
        while ((await promisify(chunks.count([key, headChunks]))) > 0) headChunks++
    }

    const now = Date.now()
    const entry: CacheEntry = {
        key,
        total: meta.total,
        etag: meta.etag,
        contentType: meta.contentType,
        bytes: (base?.bytes ?? 0) + (alreadyHad ? 0 : blob.size),
        headChunks,
        createdAt: base?.createdAt ?? now,
        lastAccess: now,
    }
    entries.put(entry)
    await done(tx)
    return entry
}

/** Bytes cached contiguously from offset 0. */
export function headBytes(entry: CacheEntry): number {
    return Math.min(entry.headChunks * CHUNK_SIZE, entry.total)
}

/**
 * Returns cached bytes [start, end] (inclusive), or as much of that range as
 * is cached contiguously from `start`. Null when `start` itself is not cached.
 * Blob slicing and concatenation are lazy, so no bytes are copied here.
 */
export async function readRange(
    key: string,
    start: number,
    end: number
): Promise<{ blob: Blob; end: number } | null> {
    const db = await openDb()
    const store = db.transaction(CHUNKS).objectStore(CHUNKS)

    const parts: Blob[] = []
    let position = start
    let index = Math.floor(start / CHUNK_SIZE)

    while (position <= end) {
        const record = await promisify<ChunkRecord | undefined>(store.get([key, index]))
        if (!record) break
        const chunkStart = index * CHUNK_SIZE
        const from = position - chunkStart
        const to = Math.min(record.blob.size, end - chunkStart + 1)
        if (from >= to) break
        parts.push(record.blob.slice(from, to))
        position = chunkStart + to
        index++
        if (to < CHUNK_SIZE) break
    }

    if (parts.length === 0) return null
    return { blob: new Blob(parts), end: position - 1 }
}

export async function touch(key: string): Promise<void> {
    const db = await openDb()
    const tx = db.transaction(ENTRIES, 'readwrite')
    const store = tx.objectStore(ENTRIES)
    const entry = await promisify<CacheEntry | undefined>(store.get(key))
    if (entry) {
        entry.lastAccess = Date.now()
        store.put(entry)
    }
    await done(tx)
}

export async function deleteEntry(key: string): Promise<void> {
    const db = await openDb()
    const tx = db.transaction([CHUNKS, ENTRIES], 'readwrite')
    tx.objectStore(CHUNKS).delete(chunkRange(key))
    tx.objectStore(ENTRIES).delete(key)
    await done(tx)
}

async function budgetBytes(): Promise<number> {
    try {
        const { quota } = await navigator.storage.estimate()
        if (quota) return Math.min(MAX_BUDGET_BYTES, quota * QUOTA_FRACTION)
    } catch {
        // estimate() unsupported
    }
    return 128 << 20
}

/** Drops expired entries, then least-recently-used ones until under budget. */
export async function evict(keep: string[] = []): Promise<void> {
    const entries = await listEntries()
    const now = Date.now()
    const budget = await budgetBytes()

    let total = 0
    const live: CacheEntry[] = []
    for (const entry of entries) {
        if (now - entry.createdAt > ENTRY_TTL_MS) {
            await deleteEntry(entry.key)
        } else {
            live.push(entry)
            total += entry.bytes
        }
    }

    live.sort((a, b) => a.lastAccess - b.lastAccess)
    for (const entry of live) {
        if (total <= budget) break
        if (keep.includes(entry.key)) continue
        await deleteEntry(entry.key)
        total -= entry.bytes
    }
}

/** Deletes every cached byte. Used on sign-out. */
export async function clearMediaCache(): Promise<void> {
    try {
        const db = await openDb()
        const tx = db.transaction([CHUNKS, ENTRIES], 'readwrite')
        tx.objectStore(CHUNKS).clear()
        tx.objectStore(ENTRIES).clear()
        await done(tx)
    } catch {
        // No IndexedDB: nothing was cached.
    }
}
