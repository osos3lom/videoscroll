import { useCallback, useSyncExternalStore } from 'react'
import {
    apiFetch,
    clearSession,
    getSession,
    setSession,
    subscribeSession,
    type Session,
} from '../lib/session'
import type { SessionResponse } from '../types/api'

export function useSession(): Session | null {
    return useSyncExternalStore(subscribeSession, getSession, () => null)
}

export function useSessionActions() {
    const login = useCallback(async (username: string, password: string) => {
        setSession(
            await apiFetch<SessionResponse>('/api/auth/login', {
                method: 'POST',
                json: { username, password },
            })
        )
    }, [])

    const join = useCallback(async (code: string, username: string, password: string) => {
        setSession(
            await apiFetch<SessionResponse>('/api/auth/join', {
                method: 'POST',
                json: { code, username, password },
            })
        )
    }, [])

    /** Signs out this device only. */
    const logout = useCallback(() => clearSession(), [])

    /** Revokes every token for the account, then signs out here too. */
    const logoutEverywhere = useCallback(async () => {
        await apiFetch('/api/auth/logout-all', { method: 'POST' })
        clearSession()
    }, [])

    const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
        setSession(
            await apiFetch<SessionResponse>('/api/auth/password', {
                method: 'POST',
                json: { currentPassword, newPassword },
            })
        )
    }, [])

    return { login, join, logout, logoutEverywhere, changePassword }
}
