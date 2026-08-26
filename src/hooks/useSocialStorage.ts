import { useCallback, useSyncExternalStore } from 'react'
import type { VideoSocial } from '../types/video'

const LOCAL_STORAGE_SOCIAL_KEY = 'videoscroll_social'

function getSocialSnapshot(): string {
    if (typeof window === 'undefined') return '{}'
    return localStorage.getItem(LOCAL_STORAGE_SOCIAL_KEY) || '{}'
}

function getServerSnapshot(): string {
    return '{}'
}

function subscribeSocial(callback: () => void) {
    if (typeof window === 'undefined') return () => undefined
    window.addEventListener('storage', callback)
    window.addEventListener('videoscroll_social_update', callback)
    return () => {
        window.removeEventListener('storage', callback)
        window.removeEventListener('videoscroll_social_update', callback)
    }
}

export function useSocialStorage(initialSocial: Record<string, VideoSocial> = {}) {
    const rawSaved = useSyncExternalStore(subscribeSocial, getSocialSnapshot, getServerSnapshot)

    let parsed: Record<string, VideoSocial> = {}
    try {
        parsed = JSON.parse(rawSaved) as Record<string, VideoSocial>
    } catch {
        parsed = {}
    }

    const social: Record<string, VideoSocial> = { ...initialSocial, ...parsed }

    const updateSocial = useCallback((videoId: string, nextSocial: VideoSocial) => {
        try {
            const currentRaw = localStorage.getItem(LOCAL_STORAGE_SOCIAL_KEY) || '{}'
            const current = JSON.parse(currentRaw) as Record<string, VideoSocial>
            const updated = { ...current, [videoId]: nextSocial }
            localStorage.setItem(LOCAL_STORAGE_SOCIAL_KEY, JSON.stringify(updated))
            window.dispatchEvent(new Event('videoscroll_social_update'))
        } catch {
            // Ignore
        }
    }, [])

    return [social, updateSocial] as const
}
