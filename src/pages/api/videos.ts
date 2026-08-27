import type { NextApiRequest, NextApiResponse } from 'next'
import { listVideos, readSocial } from '../../lib/videos'
import type { VideosResponse } from '../../types/video'

export default function handler(req: NextApiRequest, res: NextApiResponse<VideosResponse | { error: string }>) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET'])
        return res.status(405).json({ error: 'Method Not Allowed' })
    }

    try {
        const videos = listVideos()
        const social = readSocial()
        return res.status(200).json({ data: videos, social })
    } catch (error) {
        console.error('[API /videos]', error)
        return res.status(500).json({ error: 'Failed to retrieve videos' })
    }
}
