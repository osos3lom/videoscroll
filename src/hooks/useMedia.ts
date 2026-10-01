import { useMemo } from 'react'
import type { LocalVideo, MediaKind } from '../types/api'
import { type LocalImage, useImages } from './useImages'
import { useVideos } from './useVideos'

/** One video or image, in the shape every grid and viewer renders. */
export interface MediaEntry {
    id: string
    kind: MediaKind
    title: string
    src: string
    /** Poster frame for a video, thumbnail for an image. */
    poster?: string
    width?: number
    height?: number
    duration?: number
    download?: string
    uploaderId?: string
    /** The feed's own object, for videos. */
    video?: LocalVideo
    image?: LocalImage
}

export function videoEntry(video: LocalVideo): MediaEntry {
    return {
        id: video.videoId,
        kind: 'video',
        title: video.title,
        src: video.src,
        poster: video.poster,
        width: video.width,
        height: video.height,
        duration: video.duration,
        download: video.download,
        uploaderId: video.uploaderId,
        video,
    }
}

export function imageEntry(image: LocalImage): MediaEntry {
    return {
        id: image.imageId,
        kind: 'image',
        title: image.title,
        src: image.src,
        poster: image.thumb,
        width: image.width,
        height: image.height,
        download: image.download,
        uploaderId: image.uploaderId,
        image,
    }
}

/** Every video and every image this member can see, by id. */
export function useMediaLookup() {
    const videos = useVideos()
    const images = useImages()

    const byId = useMemo(() => {
        const map = new Map<string, MediaEntry>()
        for (const video of videos.videos) map.set(video.videoId, videoEntry(video))
        for (const image of images.images) map.set(image.imageId, imageEntry(image))
        return map
    }, [videos.videos, images.images])

    return {
        byId,
        videos,
        images,
        isLoading: videos.isLoading || images.isLoading,
    }
}
