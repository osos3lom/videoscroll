/** A video file found in the local `videos/` folder. */
export interface LocalVideo {
    /** Stable, URL-safe id derived from the filename. */
    videoId: string
    /** Filename on disk, e.g. `sunset.mp4`. */
    fileName: string
    /** Human-readable title (filename without extension). */
    title: string
    /** Local streaming URL served by this app. */
    src: string
    /** File size in bytes. */
    size: number
}

export interface VideoSocial {
    likes: number
    bookmarks: number
}

export type SocialKey = keyof VideoSocial

/** Shape returned by `GET /api/videos`. */
export interface VideosResponse {
    data: LocalVideo[]
    social: Record<string, VideoSocial>
}
