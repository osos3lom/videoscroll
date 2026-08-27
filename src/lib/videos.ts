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

export const isVideoFile = (fileName: string): boolean => {
    if (!fileName || fileName.startsWith('.')) return false
    const lower = fileName.toLowerCase()
    if (
        lower.includes('.optimizing.') ||
        lower.includes('.tmp.') ||
        lower.endsWith('.tmp') ||
        lower.endsWith('.crdownload') ||
        lower.endsWith('.part')
    ) {
        return false
    }
    return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

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

export const resolveVideoPath = (fileOrId: string): string | null => {
    let fileName = fileOrId
    if (fileOrId.startsWith('v-')) {
        const decoded = fromVideoId(fileOrId)
        if (decoded) fileName = decoded
    }
    const safeName = path.basename(fileName)
    if (!safeName || !isVideoFile(safeName)) return null

    const candidates = [
        path.join(process.cwd(), 'public', 'videos', safeName),
        path.join(process.cwd(), 'videos', safeName),
    ]

    for (const fullPath of candidates) {
        if (fs.existsSync(fullPath)) {
            const relative = path.relative(path.dirname(fullPath), fullPath)
            if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
                return fullPath
            }
        }
    }

    return null
}

let cachedVideos: { list: LocalVideo[]; timestamp: number } | null = null

export const invalidateVideosCache = () => {
    cachedVideos = null
}

export const listVideos = (): LocalVideo[] => {
    const now = Date.now()
    if (cachedVideos && now - cachedVideos.timestamp < 10000) {
        return cachedVideos.list
    }

    const publicVideos = path.join(process.cwd(), 'public', 'videos')
    const rootVideos = path.join(process.cwd(), 'videos')

    const fileMap = new Map<string, string>()

    if (fs.existsSync(publicVideos)) {
        for (const f of fs.readdirSync(publicVideos)) {
            if (isVideoFile(f)) fileMap.set(f, path.join(publicVideos, f))
        }
    }
    if (fs.existsSync(rootVideos)) {
        for (const f of fs.readdirSync(rootVideos)) {
            if (isVideoFile(f) && !fileMap.has(f)) fileMap.set(f, path.join(rootVideos, f))
        }
    }

    if (fileMap.size === 0) return []
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

    const list = Array.from(fileMap.entries())
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map(([fileName, fullPath]) => {
            const videoId = toVideoId(fileName)
            return {
                videoId,
                fileName,
                title: path.basename(fileName, path.extname(fileName)),
                src: `${basePath}/api/video/${encodeURIComponent(fileName)}`,
                size: fs.statSync(fullPath).size,
            }
        })

    cachedVideos = { list, timestamp: now }
    return list
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
