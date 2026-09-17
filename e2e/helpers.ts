import crypto from 'node:crypto'
import type { Page } from '@playwright/test'
import type { SessionResponse } from '../src/types/api'

export const api = () => process.env.E2E_API ?? 'http://localhost:3101'
export const web = () => process.env.E2E_WEB ?? 'http://localhost:4175'
export const ownerToken = () => process.env.E2E_OWNER_TOKEN ?? ''

export const E2E_DIR = '.sim-e2e'
/** Storage state of the owner, signed in once by global setup. */
export const OWNER_STATE = `${E2E_DIR}/owner-state.json`

const SESSION_KEY = 'videoscroll_session'

export async function apiFetch<T>(path: string, init: RequestInit & { token?: string; json?: unknown } = {}): Promise<{ status: number; body: T }> {
    const headers = new Headers(init.headers)
    if (init.token) headers.set('Authorization', `Bearer ${init.token}`)
    let body = init.body
    if (init.json !== undefined) {
        headers.set('Content-Type', 'application/json')
        body = JSON.stringify(init.json)
    }
    const response = await fetch(`${api()}${path}`, { ...init, headers, body })
    const text = await response.text()
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T }
}

export async function apiLogin(username: string, password: string): Promise<SessionResponse> {
    const { status, body } = await apiFetch<SessionResponse>('/api/auth/login', {
        method: 'POST',
        json: { username, password },
    })
    if (status !== 200) throw new Error(`login for ${username} failed with ${status}`)
    return body
}

export async function createInvite(token: string, role: 'viewer' | 'uploader' | 'owner'): Promise<string> {
    const { status, body } = await apiFetch<{ code: string }>('/api/admin/invites', {
        method: 'POST',
        token,
        json: { role, expiresInDays: 1 },
    })
    if (status !== 201) throw new Error(`invite failed with ${status}`)
    return body.code
}

/** Creates a member through an invite, entirely over the API. */
export async function createMember(role: 'viewer' | 'uploader') {
    const code = await createInvite(ownerToken(), role)
    const username = `${role}-${crypto.randomBytes(3).toString('hex')}`
    const password = crypto.randomBytes(12).toString('base64url')
    const { status, body } = await apiFetch<SessionResponse>('/api/auth/join', {
        method: 'POST',
        json: { code, username, password },
    })
    if (status !== 201) throw new Error(`join failed with ${status}`)
    return { username, password, session: body }
}

export function randomPassword() {
    return crypto.randomBytes(12).toString('base64url')
}

/** A Playwright storage state holding a signed-in session for the web origin. */
export function sessionStorageState(session: SessionResponse) {
    return {
        cookies: [],
        origins: [
            {
                origin: web(),
                localStorage: [
                    {
                        name: SESSION_KEY,
                        value: JSON.stringify({ token: session.token, expiresAt: session.expiresAt, user: session.user }),
                    },
                ],
            },
        ],
    }
}

/** Collects uncaught errors and console errors for later assertion. */
export function collectErrors(page: Page): string[] {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`)
    })
    return errors
}

/** Video ids in feed order, as rendered. */
export async function feedIds(page: Page): Promise<string[]> {
    await page.locator('#videos__container > *').first().waitFor()
    return page.$$eval('#videos__container > *', (nodes) => nodes.map((n) => n.id))
}

/** Reads the service worker's chunk index straight from IndexedDB. */
export async function cachedEntries(page: Page): Promise<{ key: string; headChunks: number; total: number }[]> {
    return page.evaluate(
        () =>
            new Promise((resolve) => {
                const request = indexedDB.open('videoscroll-media', 1)
                request.onerror = () => resolve([])
                request.onsuccess = () => {
                    const db = request.result
                    if (!db.objectStoreNames.contains('entries')) {
                        db.close()
                        resolve([])
                        return
                    }
                    const all = db.transaction('entries').objectStore('entries').getAll()
                    all.onsuccess = () => {
                        db.close()
                        resolve(all.result)
                    }
                    all.onerror = () => {
                        db.close()
                        resolve([])
                    }
                }
            })
    )
}

/** Resolves once the feed item with this video id is actually playing. */
export async function expectPlaying(page: Page, videoId: string) {
    try {
        await page.waitForFunction(
            (id) => {
                const video = document.getElementById(id)?.querySelector('video')
                return Boolean(video && video.readyState >= 3 && video.currentTime > 0.3 && !video.paused)
            },
            videoId,
            { timeout: 20_000 }
        )
    } catch (error) {
        const state = await page.$$eval('video', (videos) =>
            videos.map((v) => ({
                id: v.closest('[id]')?.id,
                readyState: v.readyState,
                networkState: v.networkState,
                currentTime: v.currentTime,
                paused: v.paused,
                error: v.error?.message,
            }))
        )
        throw new Error(`video ${videoId} is not playing. Videos: ${JSON.stringify(state, null, 2)}`, { cause: error })
    }
}
