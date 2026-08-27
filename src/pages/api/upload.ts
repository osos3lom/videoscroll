import fs from 'node:fs'
import path from 'node:path'
import type { NextApiRequest, NextApiResponse } from 'next'
import { isVideoFile, toVideoId } from '../../lib/videos'

export const config = {
    api: {
        bodyParser: false,
    },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST'])
        return res.status(405).json({ error: 'Method Not Allowed' })
    }

    const rawFileName = req.headers['x-filename'] as string | undefined
    if (!rawFileName) {
        return res.status(400).json({ error: 'x-filename header is required' })
    }

    const fileName = path.basename(decodeURIComponent(rawFileName))
    if (!isVideoFile(fileName)) {
        return res.status(400).json({ error: 'Unsupported video format' })
    }

    const uploadDir = path.join(process.cwd(), 'videos')
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
    }

    const targetPath = path.join(uploadDir, fileName)
    const writeStream = fs.createWriteStream(targetPath)

    try {
        await new Promise<void>((resolve, reject) => {
            req.pipe(writeStream)
            req.on('error', reject)
            writeStream.on('error', reject)
            writeStream.on('finish', resolve)
        })

        const stats = fs.statSync(targetPath)
        const videoId = toVideoId(fileName)
        const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

        // Generate poster immediately and run background GPU optimization
        const { generatePoster, optimizeVideo, POSTERS_DIR } = await import('../../lib/transcode')
        const posterPath = path.join(POSTERS_DIR, `${videoId}.webp`)
        generatePoster(targetPath, posterPath).catch((e) => console.error('[upload poster error]', e))

        // Background optimization with faststart + keyframes
        optimizeVideo(targetPath, targetPath)
            .then(() => console.error(`[upload optimize] Successfully optimized ${fileName}`))
            .catch((e) => console.error('[upload optimize error]', e))

        return res.status(201).json({
            videoId,
            fileName,
            title: path.basename(fileName, path.extname(fileName)),
            src: `${basePath}/api/video/${encodeURIComponent(fileName)}`,
            size: stats.size,
        })
    } catch (error) {
        console.error('[API /upload]', error)
        if (fs.existsSync(targetPath)) {
            try {
                fs.unlinkSync(targetPath)
            } catch {
                // ignore
            }
        }
        return res.status(500).json({ error: 'Failed to upload video' })
    }
}
