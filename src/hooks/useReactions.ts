import { useCallback, useEffect, useMemo } from 'react'
import useSWR, { mutate as mutateGlobal } from 'swr'
import { IS_DEMO } from '../lib/apiUrl'
import { ApiError, apiFetch } from '../lib/session'
import type { ReactionKind, Reactions, VideoSocial, VideosResponse } from '../types/api'
import { useSession } from './useSession'
import { LOCAL_STORAGE_SOCIAL_KEY, useSocialStorage } from './useSocialStorage'
import { videosKey } from './useVideos'

const IMPORTED_KEY = 'videoscroll_social_imported'
const IMPORT_BATCH = 500

export interface UseReactionsResult {
    /** Newest first. */
    likedIds: string[]
    savedIds: string[]
    isLiked: (mediaId: string) => boolean
    isSaved: (mediaId: string) => boolean
    /** Community totals for one item, as shown next to the buttons. */
    counts: (mediaId: string) => VideoSocial
    toggle: (kind: ReactionKind, mediaId: string) => void
    /**
     * 'server' once the API answers; 'local' in the demo or against a server
     * too old to store reactions, where they stay on this device as before.
     */
    mode: 'server' | 'local' | 'loading'
}

/** null: the server predates /api/me/reactions. */
async function fetchReactions(): Promise<Reactions | null> {
    try {
        return await apiFetch<Reactions>('/api/me/reactions')
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
    }
}

function readLocalSocial(): Record<string, VideoSocial> {
    try {
        return JSON.parse(localStorage.getItem(LOCAL_STORAGE_SOCIAL_KEY) || '{}') as Record<string, VideoSocial>
    } catch {
        return {}
    }
}

/**
 * Sends this device's old, browser-only likes and saves to the account, once.
 * The server skips anything it already has, so other devices doing the same
 * is harmless. The local copy is left in place.
 */
async function importLocal(userId: string): Promise<boolean> {
    const flag = `${IMPORTED_KEY}:${userId}`
    try {
        if (localStorage.getItem(flag)) return false
    } catch {
        return false
    }
    const local = readLocalSocial()
    const likes = Object.keys(local).filter((id) => (local[id]?.likes ?? 0) > 0)
    const saves = Object.keys(local).filter((id) => (local[id]?.bookmarks ?? 0) > 0)
    let imported = 0
    for (let i = 0; i < Math.max(likes.length, saves.length); i += IMPORT_BATCH) {
        const result = await apiFetch<{ imported: number }>('/api/me/reactions/import', {
            method: 'POST',
            json: { likes: likes.slice(i, i + IMPORT_BATCH), saves: saves.slice(i, i + IMPORT_BATCH) },
        })
        imported += result.imported
    }
    try {
        localStorage.setItem(flag, new Date().toISOString())
    } catch {
        // Next load tries again; the import is idempotent.
    }
    return imported > 0
}

const SOCIAL_FIELD: Record<ReactionKind, keyof VideoSocial> = { like: 'likes', save: 'bookmarks' }

/** The signed-in member's likes and saves: the single source for both. */
export function useReactions(serverSocial: Record<string, VideoSocial> = {}): UseReactionsResult {
    const session = useSession()
    const userId = session?.user.id
    const key = !IS_DEMO && userId ? ['reactions', userId] : null
    const { data, mutate, isLoading } = useSWR<Reactions | null>(key, fetchReactions, {
        revalidateOnFocus: true,
        dedupingInterval: 10_000,
    })
    const [localSocial, updateLocalSocial] = useSocialStorage(serverSocial)

    const mode: UseReactionsResult['mode'] = IS_DEMO || data === null ? 'local' : data ? 'server' : isLoading ? 'loading' : 'local'

    useEffect(() => {
        if (mode !== 'server' || !userId) return
        let cancelled = false
        importLocal(userId)
            .then((changed) => {
                if (changed && !cancelled) {
                    void mutate()
                    void mutateGlobal(videosKey(userId))
                }
            })
            .catch(() => undefined)
        return () => {
            cancelled = true
        }
    }, [mode, userId, mutate])

    const likedIds = useMemo(() => {
        if (mode === 'server') return data!.likes.map((e) => e.mediaId)
        return Object.keys(localSocial)
            .filter((id) => (localSocial[id]?.likes ?? 0) > 0)
            .reverse()
    }, [mode, data, localSocial])

    const savedIds = useMemo(() => {
        if (mode === 'server') return data!.saves.map((e) => e.mediaId)
        return Object.keys(localSocial)
            .filter((id) => (localSocial[id]?.bookmarks ?? 0) > 0)
            .reverse()
    }, [mode, data, localSocial])

    const likedSet = useMemo(() => new Set(likedIds), [likedIds])
    const savedSet = useMemo(() => new Set(savedIds), [savedIds])

    const counts = useCallback(
        (mediaId: string): VideoSocial => {
            if (mode === 'server') return serverSocial[mediaId] ?? { likes: 0, bookmarks: 0 }
            return localSocial[mediaId] ?? { likes: 0, bookmarks: 0 }
        },
        [mode, serverSocial, localSocial]
    )

    const toggle = useCallback(
        (kind: ReactionKind, mediaId: string) => {
            const field = SOCIAL_FIELD[kind]
            const isOn = (kind === 'like' ? likedSet : savedSet).has(mediaId)

            if (mode !== 'server') {
                const current = localSocial[mediaId] ?? { likes: 0, bookmarks: 0 }
                updateLocalSocial(mediaId, {
                    ...current,
                    [field]: isOn ? Math.max(0, current[field] - 1) : current[field] + 1,
                })
                return
            }
            if (!userId) return

            const listField = kind === 'like' ? 'likes' : 'saves'
            const delta = isOn ? -1 : 1
            const adjustCount = (list: VideosResponse | undefined) => {
                if (!list) return list
                const current = list.social?.[mediaId] ?? { likes: 0, bookmarks: 0 }
                return {
                    ...list,
                    social: { ...list.social, [mediaId]: { ...current, [field]: Math.max(0, current[field] + delta) } },
                }
            }

            // Optimistic: flip the button and the count now, undo on failure.
            void mutate(
                (current) => {
                    if (!current) return current
                    const without = current[listField].filter((e) => e.mediaId !== mediaId)
                    const next = isOn ? without : [{ mediaId, at: new Date().toISOString() }, ...without]
                    return { ...current, [listField]: next }
                },
                { revalidate: false }
            )
            void mutateGlobal(videosKey(userId), adjustCount, { revalidate: false })

            apiFetch(`/api/me/reactions/${kind}/${encodeURIComponent(mediaId)}`, {
                method: isOn ? 'DELETE' : 'PUT',
            }).catch(() => {
                void mutate()
                void mutateGlobal(videosKey(userId))
            })
        },
        [mode, likedSet, savedSet, localSocial, updateLocalSocial, mutate, userId]
    )

    return {
        likedIds,
        savedIds,
        isLiked: (id) => likedSet.has(id),
        isSaved: (id) => savedSet.has(id),
        counts,
        toggle,
        mode,
    }
}
