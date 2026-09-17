import type { PublicUser, SessionResponse } from '../types/api'
import { apiUrl } from './apiUrl'
import { messageForCode } from './errorMessages'
import { clearMediaCache } from './mediaCache/chunkStore'

/**
 * The signed-in session: a bearer token plus the user it belongs to.
 *
 * Kept in localStorage because the API is on a different origin from this
 * page, so an HttpOnly cookie would be a third-party cookie that Safari will
 * not send. The token is revocable server-side ("sign out everywhere", role
 * changes, password changes), and the Content-Security-Policy in index.html
 * restricts what script could ever read it.
 */

const STORAGE_KEY = 'videoscroll_session'

export interface Session {
    token: string
    expiresAt: string
    user: PublicUser
}

function read(): Session | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const session = JSON.parse(raw) as Session
        if (!session.token || Date.parse(session.expiresAt) <= Date.now()) return null
        return session
    } catch {
        return null
    }
}

let current: Session | null = read()
const listeners = new Set<() => void>()

function emit() {
    for (const listener of listeners) listener()
}

// Keep tabs in sync: signing out in one signs out all.
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY) return
        current = read()
        emit()
    })
}

export function getSession(): Session | null {
    return current
}

export function subscribeSession(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function setSession(response: SessionResponse): void {
    current = { token: response.token, expiresAt: response.expiresAt, user: response.user }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
    } catch {
        // Private mode with storage disabled: the session lasts for this tab.
    }
    emit()
}

/** Updates the cached user (e.g. after an owner changed this user's role). */
export function updateSessionUser(user: PublicUser): void {
    if (!current) return
    const u = current.user
    if (
        u.role === user.role &&
        u.displayName === user.displayName &&
        u.username === user.username &&
        Boolean(u.mustChangePassword) === Boolean(user.mustChangePassword)
    ) {
        return
    }
    setSession({ ...current, user })
}

/**
 * Forgets the session and wipes the temporary video cache, so nothing from
 * the community stays on a shared device after signing out.
 */
export function clearSession(): void {
    const hadSession = current !== null
    current = null
    try {
        localStorage.removeItem(STORAGE_KEY)
    } catch {
        // ignore
    }
    void clearMediaCache()
    navigator.serviceWorker?.controller?.postMessage({ type: 'cache-cleared' })
    if (hadSession) emit()
}

export class ApiError extends Error {
    readonly status: number
    readonly body: Record<string, unknown>

    constructor(status: number, message: string, body: Record<string, unknown> = {}) {
        super(message)
        this.status = status
        this.body = body
    }
}

interface ApiFetchOptions {
    method?: string
    json?: unknown
    body?: BodyInit
    headers?: Record<string, string>
    signal?: AbortSignal
}

/**
 * fetch() against the API with the bearer token attached. A 401 from any
 * authenticated call means the session is gone — expired, revoked, or the
 * account disabled — so it is cleared here, once, for the whole app.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...options.headers }
    const token = current?.token
    if (token) headers.Authorization = `Bearer ${token}`

    let body = options.body
    if (options.json !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(options.json)
    }

    let response: Response
    try {
        response = await fetch(apiUrl(path), {
            method: options.method ?? 'GET',
            headers,
            body,
            signal: options.signal,
            credentials: 'omit',
        })
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new ApiError(0, messageForCode('network_error') ?? 'Could not reach the server', { code: 'network_error' })
    }

    if (response.status === 204) return undefined as T

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
        if (response.status === 401 && token) clearSession()
        // The owner reset this password while the app was open: switch to the
        // "choose your password" screen.
        if (response.status === 403 && data.code === 'password_change_required' && current) {
            updateSessionUser({ ...current.user, mustChangePassword: true })
        }
        // Prefer the app's translation of the server's error code.
        const message =
            messageForCode(data.code) ??
            (typeof data.error === 'string' ? data.error : `Request failed (${response.status})`)
        throw new ApiError(response.status, message, data)
    }
    return data as T
}
