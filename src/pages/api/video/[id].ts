import fs from 'node:fs'
import type { NextApiRequest, NextApiResponse } from 'next'
import { mimeTypeFor, resolveVideoPath } from '../../../lib/videos'

export const config = {
    api: {
        responseLimit: false,
    },
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', ['GET', 'HEAD'])
        return res.status(405).end('Method Not Allowed')
    }

    const { id } = req.query
    const rawTarget = Array.isArray(id) ? id.join('/') : id

    if (!rawTarget) {
        return res.status(400).json({ error: 'Video identifier is required' })
    }

    const filePath = resolveVideoPath(decodeURIComponent(rawTarget))
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Video not found' })
    }

    let stat: fs.Stats
    try {
        stat = fs.statSync(filePath)
    } catch {
        return res.status(404).json({ error: 'Video file unreadable' })
    }

    const fileSize = stat.size
    const mimeType = mimeTypeFor(filePath)
    const range = req.headers.range

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')

    if (!range) {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': mimeType,
        })
        fs.createReadStream(filePath).pipe(res)
        return
    }

    // Parse Range header e.g. "bytes=0-1048575" or "bytes=1048576-"
    const match = range.match(/bytes=(\d*)-(\d*)/)
    if (!match) {
        res.setHeader('Content-Range', `bytes */${fileSize}`)
        return res.status(416).end('Range Not Satisfiable')
    }

    const rawStart = match[1]
    const rawEnd = match[2]

    const start = rawStart ? parseInt(rawStart, 10) : 0
    let end = rawEnd ? parseInt(rawEnd, 10) : fileSize - 1

    if (isNaN(start) || start >= fileSize || start < 0) {
        res.setHeader('Content-Range', `bytes */${fileSize}`)
        return res.status(416).end('Range Not Satisfiable')
    }

    if (isNaN(end) || end >= fileSize || end < start) {
        end = fileSize - 1
    }

    const contentLength = end - start + 1

    res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': contentLength,
        'Content-Type': mimeType,
    })

    if (req.method === 'HEAD') {
        return res.end()
    }

    const stream = fs.createReadStream(filePath, { start, end })
    stream.on('error', (err) => {
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error streaming video' })
        } else {
            res.destroy(err)
        }
    })

    stream.pipe(res)
}
