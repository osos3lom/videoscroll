import { useEffect, useMemo } from 'react'
import useSWR from 'swr'
import { IS_DEMO, imageSrc, imageThumbUrl } from '../lib/apiUrl'
import { ApiError, apiFetch } from '../lib/session'
import type { ImagesResponse } from '../types/api'
import { useSession } from './useSession'

/** Dispatched after an image is published, renamed or deleted. */
export const IMAGES_CHANGED_EVENT = 'videoscroll_images_changed'

/** An image ready to render. */
export interface LocalImage {
    imageId: string
    title: string
    fileName: string
    size: number
    uploadedAt: string
    uploaderId?: string
    width: number
    height: number
    src: string
    thumb: string
    download: string
}

export interface UseImagesResult {
    images: LocalImage[]
    isLoading: boolean
    /** The server predates images (404), or this is the demo. */
    unsupported: boolean
    refresh: () => void
}

/** null: the server has no image routes yet. */
async function fetchImages(path: string): Promise<ImagesResponse | null> {
    try {
        return await apiFetch<ImagesResponse>(path)
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
    }
}

/**
 * The signed-in member's images. Images are private: everyone gets their
 * own, and the owner gets every image so they can be managed.
 */
export function useImages(): UseImagesResult {
    const session = useSession()
    const isOwner = session?.user.role === 'owner'
    const path = isOwner ? '/api/images?all=1' : '/api/images'
    const key = !IS_DEMO && session ? path : null

    const { data, isLoading, mutate } = useSWR<ImagesResponse | null>(key, fetchImages, {
        revalidateOnFocus: true,
        refreshInterval: 60 * 60 * 1000,
        dedupingInterval: 10_000,
    })

    useEffect(() => {
        const onChange = () => void mutate()
        window.addEventListener(IMAGES_CHANGED_EVENT, onChange)
        return () => window.removeEventListener(IMAGES_CHANGED_EVENT, onChange)
    }, [mutate])

    const images = useMemo<LocalImage[]>(() => {
        if (!data) return []
        return (data.data ?? []).map((meta) => ({
            imageId: meta.videoId,
            title: meta.title,
            fileName: meta.fileName,
            size: meta.size,
            uploadedAt: meta.uploadedAt,
            uploaderId: meta.uploaderId,
            width: meta.width,
            height: meta.height,
            src: imageSrc(meta.videoId, data.mediaToken),
            thumb: imageThumbUrl(meta.videoId, data.mediaToken),
            download: imageSrc(meta.videoId, data.mediaToken, true),
        }))
    }, [data])

    return {
        images,
        isLoading: Boolean(key) && isLoading,
        unsupported: IS_DEMO || data === null,
        refresh: () => void mutate(),
    }
}
