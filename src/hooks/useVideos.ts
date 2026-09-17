import { useEffect, useMemo } from 'react'
import useSWR from 'swr'
import { IS_DEMO, posterUrl, videoSrc } from '../lib/apiUrl'
import { DEMO_VIDEOS } from '../lib/demoVideos'
import { apiFetch, updateSessionUser } from '../lib/session'
import type { LocalVideo, VideoSocial, VideosResponse } from '../types/api'
import { useSession } from './useSession'

/** Dispatched after an upload is published or a video deleted. */
export const VIDEOS_CHANGED_EVENT = 'videoscroll_videos_changed'

export interface UseVideosResult {
    videos: LocalVideo[]
    social: Record<string, VideoSocial>
    /** True while the first request is still in flight. */
    isLoading: boolean
    /** True when the list is the static demo reels (no API configured). */
    isDemo: boolean
    error: Error | undefined
    refresh: () => void
}

const fetchVideos = () => apiFetch<VideosResponse>('/api/videos')

/**
 * The app's single source of video data.
 *
 * The response carries a media token valid for at least six hours; refetching
 * hourly (and on focus) keeps it fresh. Tokens are bucketed server-side, so a
 * refetch normally returns the identical token and no video URL changes.
 */
export function useVideos(): UseVideosResult {
    const session = useSession()
    const key = !IS_DEMO && session ? ['videos', session.user.id] : null

    const { data, error, isLoading, mutate } = useSWR<VideosResponse>(key, fetchVideos, {
        revalidateOnFocus: true,
        refreshInterval: 60 * 60 * 1000,
        dedupingInterval: 10_000,
        errorRetryCount: 3,
    })

    useEffect(() => {
        const onChange = () => void mutate()
        window.addEventListener(VIDEOS_CHANGED_EVENT, onChange)
        return () => window.removeEventListener(VIDEOS_CHANGED_EVENT, onChange)
    }, [mutate])

    // Role changes made by the owner arrive with the list.
    useEffect(() => {
        if (data?.user) updateSessionUser(data.user)
    }, [data?.user])

    const videos = useMemo<LocalVideo[]>(() => {
        if (IS_DEMO) return DEMO_VIDEOS
        if (!data) return []
        // Older servers sent `null` for an empty community.
        return (data.data ?? []).map((meta) => ({
            ...meta,
            src: videoSrc(meta.videoId, data.mediaToken),
            poster: posterUrl(meta.videoId, data.mediaToken),
        }))
    }, [data])

    return {
        videos,
        social: data?.social ?? {},
        isLoading: !IS_DEMO && isLoading,
        isDemo: IS_DEMO,
        error: error as Error | undefined,
        refresh: () => void mutate(),
    }
}
