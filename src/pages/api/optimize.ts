import type { NextApiRequest, NextApiResponse } from 'next'
import { detectBestEncoder, optimizeAllVideos } from '../../lib/transcode'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'GET') {
        const encoder = detectBestEncoder()
        return res.status(200).json({ status: 'ready', detectedEncoder: encoder })
    }

    if (req.method === 'POST') {
        try {
            const result = await optimizeAllVideos()
            return res.status(200).json({ status: 'complete', ...result })
        } catch (error) {
            console.error('[API /optimize] error:', error)
            return res.status(500).json({ error: 'Optimization failed' })
        }
    }

    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ error: 'Method Not Allowed' })
}
