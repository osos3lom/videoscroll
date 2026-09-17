/**
 * Wire types for the Go API in server/.
 *
 * These are maintained by hand. Each interface names the Go struct it mirrors;
 * change both together.
 */

export type Role = 'owner' | 'uploader' | 'viewer'

/** users.Public */
export interface PublicUser {
    id: string
    username: string
    displayName: string
    role: Role
    disabled: boolean
    createdAt: string
}

/** media.Meta — one published video. Carries no URLs; see src/lib/apiUrl.ts. */
export interface VideoMeta {
    videoId: string
    fileName: string
    title: string
    size: number
    uploadedAt: string
    uploaderId?: string
    duration: number
    /** Display dimensions, already corrected for rotation. */
    width: number
    height: number
    /** Bits per second, used to size the prefetch. */
    bitrate: number
    videoCodec: string
    audioCodec?: string
    processing: string
}

export interface VideoSocial {
    likes: number
    bookmarks: number
}

export type SocialKey = keyof VideoSocial

/** httpapi.VideosResponse */
export interface VideosResponse {
    data: VideoMeta[]
    social: Record<string, VideoSocial>
    /** Authorizes <video> and poster loads for this user, as `?t=`. */
    mediaToken: string
    mediaTokenExpiresAt: string
    user: PublicUser
}

/** httpapi.sessionResponse */
export interface SessionResponse {
    token: string
    expiresAt: string
    user: PublicUser
}

export type UploadState = 'uploading' | 'queued' | 'processing' | 'ready' | 'failed'

/** httpapi.uploadResponse */
export interface UploadStatus {
    uploadId: string
    fileName: string
    size: number
    received: number
    chunkSize: number
    state: UploadState
    videoId?: string
    error?: string
}

/** httpapi.inviteView */
export interface InviteView {
    id: string
    role: Role
    createdAt: string
    expiresAt: string
    usedBy?: string
    usedAt?: string
}

/** httpapi.statusResponse */
export interface ServerStatus {
    videos: number
    users: number
    queue: { current?: string; waiting: number; failed: number }
    diskFreeBytes: number
    minFreeBytes: number
    uptime: string
}

/**
 * A video ready to render. Server videos carry the full metadata; the demo
 * reels only the basics, so the metadata fields are optional here.
 */
export interface LocalVideo extends Pick<VideoMeta, 'videoId' | 'fileName' | 'title' | 'size'> {
    src: string
    poster?: string
    width?: number
    height?: number
    bitrate?: number
    duration?: number
    uploaderId?: string
}
