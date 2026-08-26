import fs from 'node:fs'
import path from 'node:path'
import type { LocalVideo, VideoSocial } from '../types/video'

/** Everything here is local disk access — no network calls, ever. */

export const VIDEOS_DIR = fs.existsSync(path.join(process.cwd(), 'public', 'videos'))
    ? path.join(process.cwd(), 'public', 'videos')
    : path.join(process.cwd(), 'videos')
const DATA_DIR = path.join(process.cwd(), 'data')
const SOCIAL_FILE = path.join(DATA_DIR, 'social.json')

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.m4v'])

const MIME_TYPES: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.ogv': 'video/ogg',
    '.mov': 'video/quicktime',
}

export const isVideoFile = (fileName: string): boolean => VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase())

export const mimeTypeFor = (fileName: string): string =>
    MIME_TYPES[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream'

/** Filename -> stable id. Keeps it URL-safe and usable as a DOM id. */
export const toVideoId = (fileName: string): string =>
    `v-${Buffer.from(fileName, 'utf8').toString('base64url').replace(/=+$/, '')}`

export const fromVideoId = (videoId: string): string | null => {
    if (!videoId.startsWith('v-')) return null
    try {
        return Buffer.from(videoId.slice(2), 'base64url').toString('utf8')
    } catch {
        return null
    }
}

/**
 * Resolves a filename to an absolute path inside VIDEOS_DIR.
 * Returns null if the name escapes the folder (path traversal) or isn't a video.
 */
export const resolveVideoPath = (fileName: string): string | null => {
    const safeName = path.basename(fileName)
    if (!safeName || safeName !== fileName || !isVideoFile(safeName)) return null

    const fullPath = path.join(VIDEOS_DIR, safeName)
    const relative = path.relative(VIDEOS_DIR, fullPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null

    return fullPath
}

export const listVideos = (): LocalVideo[] => {
    const publicVideos = path.join(process.cwd(), 'public', 'videos')
    const rootVideos = path.join(process.cwd(), 'videos')

    const targetDir =
        fs.existsSync(publicVideos) && fs.readdirSync(publicVideos).some(isVideoFile)
            ? publicVideos
            : fs.existsSync(rootVideos) && fs.readdirSync(rootVideos).some(isVideoFile)
            ? rootVideos
            : publicVideos

    if (!fs.existsSync(targetDir)) return []
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

    return fs
        .readdirSync(targetDir)
        .filter(isVideoFile)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map((fileName) => {
            const videoId = toVideoId(fileName)
            return {
                videoId,
                fileName,
                title: path.basename(fileName, path.extname(fileName)),
                src: `${basePath}/videos/${encodeURIComponent(fileName)}`,
                size: fs.statSync(path.join(targetDir, fileName)).size,
            }
        })
}

export const readSocial = (): Record<string, VideoSocial> => {
    try {
        return JSON.parse(fs.readFileSync(SOCIAL_FILE, 'utf8')) as Record<string, VideoSocial>
    } catch {
        // Missing or corrupt file just means "no likes yet".
        return {}
    }
}

export const writeSocial = (social: Record<string, VideoSocial>): void => {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(SOCIAL_FILE, JSON.stringify(social, null, 2), 'utf8')
}
