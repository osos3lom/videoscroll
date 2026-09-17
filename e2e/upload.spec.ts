import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { UploadStatus, VideosResponse } from '../src/types/api'
import { E2E_DIR, OWNER_STATE, apiFetch, ownerToken } from './helpers'

test.use({ storageState: OWNER_STATE })

const CHUNK = 8 << 20
const file = path.join(E2E_DIR, 'sim-upload.mov')

test.beforeAll(() => {
    // A QuickTime file, five times the demo clip: large enough for several
    // 8 MiB chunks, and in a container the server has to remux.
    execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-stream_loop', '4', '-i', 'videos/clip2.mp4',
        '-c', 'copy', '-f', 'mov', file,
    ])
    expect(fs.statSync(file).size).toBeGreaterThan(2 * CHUNK)
})

test('an interrupted upload resumes after the tab is closed, then publishes', async ({ context }) => {
    // --- First attempt: the tab dies after one chunk. -----------------------
    const first = await context.newPage()
    let puts = 0
    let interrupted!: () => void
    const interruptedSignal = new Promise<void>((resolve) => (interrupted = resolve))
    await first.route('**/api/uploads/*', async (route) => {
        if (route.request().method() === 'PUT' && ++puts === 2) {
            await route.abort('connectionreset')
            interrupted()
            return
        }
        await route.continue()
    })

    const created = first.waitForResponse((r) => r.url().endsWith('/api/uploads') && r.request().method() === 'POST')
    await first.goto('')
    await first.locator('input[type=file]').setInputFiles(file)
    const { uploadId } = (await (await created).json()) as UploadStatus
    await interruptedSignal
    await first.close()

    const partial = await apiFetch<UploadStatus>(`/api/uploads/${uploadId}`, { token: ownerToken() })
    expect(partial.body.state).toBe('uploading')
    expect(partial.body.received).toBe(CHUNK)

    // --- Second attempt: same file, new tab. It must resume, not restart. ---
    const second = await context.newPage()
    const resumed = second.waitForResponse((r) => r.url().endsWith('/api/uploads') && r.request().method() === 'POST')
    await second.goto('')
    await second.locator('input[type=file]').setInputFiles(file)
    const resumedStatus = (await (await resumed).json()) as UploadStatus
    expect(resumedStatus.uploadId).toBe(uploadId)
    expect(resumedStatus.received).toBe(CHUNK)

    await expect(second.getByText(/تم النشر بنجاح/)).toBeVisible({ timeout: 60_000 })

    // --- The published video: remuxed, never re-encoded, correct size. ------
    const done = await apiFetch<UploadStatus>(`/api/uploads/${uploadId}`, { token: ownerToken() })
    expect(done.body.state).toBe('ready')

    const list = await apiFetch<VideosResponse>('/api/videos', { token: ownerToken() })
    const video = list.body.data.find((v) => v.videoId === done.body.videoId)
    expect(video).toBeDefined()
    expect(video!.title).toBe('sim-upload')
    expect(video!.processing).toBe('remux')
    expect(video!.videoCodec).toBe('h264')
    expect(video!.fileName.endsWith('.mp4')).toBe(true)

    // It shows at the top of the feed (newest first) and plays.
    await second.reload()
    await expect(second.locator('#videos__container > *').first()).toHaveAttribute('id', video!.videoId)
})
