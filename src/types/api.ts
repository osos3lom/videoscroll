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
    /** The owner set this password; the person must choose their own. */
    mustChangePassword?: boolean
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

/** httpapi.VideoSocial: community totals for one item. */
export interface VideoSocial {
    likes: number
    bookmarks: number
}

export type ReactionKind = 'like' | 'save'

/** reactions.Entry */
export interface ReactionEntry {
    mediaId: string
    at: string
}

/** reactions.Lists: the signed-in member's own likes and saves, newest first. */
export interface Reactions {
    likes: ReactionEntry[]
    saves: ReactionEntry[]
}

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

export type MediaKind = 'video' | 'image'

/** media.Meta for an image (kind "image"; the video-only fields are empty). */
export interface ImageMeta {
    /** The image id, `i-…`. The field name is shared with videos. */
    videoId: string
    kind: 'image'
    fileName: string
    title: string
    size: number
    uploadedAt: string
    uploaderId?: string
    width: number
    height: number
}

/** httpapi.ImagesResponse: the caller's own images. */
export interface ImagesResponse {
    data: ImageMeta[]
    mediaToken: string
    mediaTokenExpiresAt: string
}

export type CollectionSection = 'collections' | 'images'
export type Visibility = 'private' | 'public'

/** httpapi.CollectionItemView */
export interface CollectionItem {
    id: string
    mediaId: string
    kind: MediaKind
    addedAt: string
}

/** httpapi.CollectionView */
export interface Collection {
    id: string
    section: CollectionSection
    title: string
    description: string
    visibility: Visibility
    coverItemId?: string
    cover?: CollectionItem
    itemCount: number
    videoCount: number
    imageCount: number
    /** Present while public: the secret part of the public link. */
    shareCode?: string
    createdAt: string
    updatedAt: string
    /** Absent in listings fetched without items. */
    items?: CollectionItem[]
}

/** httpapi.collectionsResponse */
export interface CollectionsResponse {
    collections: Collection[]
    mediaToken: string
    mediaTokenExpiresAt: string
}

/** httpapi.collectionResponse */
export interface CollectionResponse {
    collection: Collection
    mediaToken: string
    mediaTokenExpiresAt: string
}

/** httpapi.PublicCollectionItem: no media id, file name or uploader. */
export interface PublicCollectionItem {
    key: string
    kind: MediaKind
    title: string
    width: number
    height: number
    duration?: number
}

/** httpapi.PublicCollection */
export interface PublicCollection {
    title: string
    description: string
    items: PublicCollectionItem[]
}

/** httpapi.uploadResponse */
export interface UploadStatus {
    uploadId: string
    fileName: string
    kind?: MediaKind
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

/** httpapi.ShareView: a member's public link, as listed to them. */
export interface ShareView {
    id: string
    videoId: string
    title: string
    createdBy: string
    createdByName: string
    createdAt: string
    /** Absent: the link works until it is stopped. */
    expiresAt?: string
}

/** Days a new link lasts; 0 means until it is stopped. */
export type ShareDays = 0 | 1 | 7 | 30

/** httpapi.PublicShare: everything a person without an account learns. */
export interface PublicShare {
    title: string
    width: number
    height: number
    duration: number
    size: number
    ext: string
    expiresAt?: string
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
    /** Same bytes as `src`, served as an attachment. Absent in the demo. */
    download?: string
    poster?: string
    width?: number
    height?: number
    bitrate?: number
    duration?: number
    uploaderId?: string
}
