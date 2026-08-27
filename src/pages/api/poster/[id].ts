import fs from 'node:fs'
import path from 'node:path'
import type { NextApiRequest, NextApiResponse } from 'next'
import { generatePoster, POSTERS_DIR } from '../../../lib/transcode'
import { fromVideoId, resolveVideoPath, toVideoId } from '../../../lib/videos'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', ['GET', 'HEAD'])
        return res.status(405).end('Method Not Allowed')
    }

    const { id } = req.query
    const rawTarget = Array.isArray(id) ? id.join('/') : id

    if (!rawTarget) {
        return res.status(400).json({ error: 'Poster ID is required' })
    }

    const cleanTarget = decodeURIComponent(rawTarget).replace(/\.webp$/, '')
    let videoId = cleanTarget
    let fileName: string | null = null

    if (cleanTarget.startsWith('v-')) {
        fileName = fromVideoId(cleanTarget)
    } else {
        fileName = cleanTarget
        videoId = toVideoId(cleanTarget)
    }

    const posterPath = path.join(POSTERS_DIR, `${videoId}.webp`)

    // If poster already exists, serve it
    if (fs.existsSync(posterPath)) {
        res.setHeader('Content-Type', 'image/webp')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        if (req.method === 'HEAD') return res.end()
        fs.createReadStream(posterPath).pipe(res)
        return
    }

    // Otherwise generate it on-the-fly from the source video
    if (fileName) {
        const videoPath = resolveVideoPath(fileName)
        if (videoPath && fs.existsSync(videoPath)) {
            try {
                await generatePoster(videoPath, posterPath)
                if (fs.existsSync(posterPath)) {
                    res.setHeader('Content-Type', 'image/webp')
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
                    if (req.method === 'HEAD') return res.end()
                    fs.createReadStream(posterPath).pipe(res)
                    return
                }
            } catch (err) {
                console.error('[API /poster] generation error:', err)
            }
        }
    }

    return res.status(404).json({ error: 'Poster not found' })
}
