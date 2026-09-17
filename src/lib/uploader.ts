import type { UploadStatus } from '../types/api'
import { ApiError, apiFetch } from './session'

/**
 * Resumable, chunked upload.
 *
 * The server identifies an upload by (user, file name, size, lastModified),
 * so picking the same file again — after a dropped connection, a closed tab,
 * or a phone going to sleep — resumes from the bytes already on disk.
 *
 * Every chunk is sent at an explicit offset, and the server accepts it only
 * if that offset equals what it already holds. A retry after an ambiguous
 * failure therefore can never duplicate or skip data: at worst the server
 * answers 409 with its real offset and the loop continues from there.
 */

const MAX_CONSECUTIVE_FAILURES = 8

/** Errors that retrying cannot fix. */
const FATAL_STATUSES = new Set([400, 401, 403, 404, 413, 415, 507])

export interface UploadProgress {
    sent: number
    total: number
    resumedFrom: number
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer)
                reject(new DOMException('Upload cancelled', 'AbortError'))
            },
            { once: true }
        )
    })
}

/** Sends `file` and resolves once every byte is on the server. */
export async function uploadFile(
    file: File,
    onProgress: (progress: UploadProgress) => void,
    signal: AbortSignal
): Promise<UploadStatus> {
    let status = await apiFetch<UploadStatus>('/api/uploads', {
        method: 'POST',
        json: { fileName: file.name, size: file.size, lastModified: file.lastModified },
        signal,
    })

    const resumedFrom = status.received
    let offset = status.received
    onProgress({ sent: offset, total: file.size, resumedFrom })

    let failures = 0
    while (status.state === 'uploading' && offset < file.size) {
        const end = Math.min(offset + status.chunkSize, file.size)
        try {
            status = await apiFetch<UploadStatus>(`/api/uploads/${status.uploadId}`, {
                method: 'PUT',
                // A type-less Blob sends no Content-Type header.
                body: new Blob([file.slice(offset, end)]),
                headers: { 'Upload-Offset': String(offset) },
                signal,
            })
            offset = status.received
            failures = 0
            onProgress({ sent: offset, total: file.size, resumedFrom })
        } catch (error) {
            if (signal.aborted) throw error
            if (error instanceof ApiError) {
                if (error.status === 409 && typeof error.body.received === 'number') {
                    offset = error.body.received
                    if (typeof error.body.state === 'string') {
                        status = { ...status, state: error.body.state as UploadStatus['state'] }
                    }
                    continue
                }
                if (FATAL_STATUSES.has(error.status)) throw error
            }

            failures++
            if (failures > MAX_CONSECUTIVE_FAILURES) throw error
            await sleep(Math.min(30_000, 1000 * 2 ** failures), signal)

            // Resync: the failed request may have partly landed.
            try {
                status = await getUploadStatus(status.uploadId, signal)
                offset = status.received
            } catch (resyncError) {
                if (signal.aborted) throw resyncError
            }
        }
    }
    return status
}

export function getUploadStatus(uploadId: string, signal?: AbortSignal): Promise<UploadStatus> {
    return apiFetch<UploadStatus>(`/api/uploads/${uploadId}`, { signal })
}

export async function cancelUpload(uploadId: string): Promise<void> {
    await apiFetch(`/api/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => undefined)
}
