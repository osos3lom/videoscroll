import { execFile, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { isVideoFile, toVideoId } from './videos'

export const POSTERS_DIR = path.join(process.cwd(), 'public', 'posters')

// Ensure posters directory exists
if (!fs.existsSync(POSTERS_DIR)) {
    fs.mkdirSync(POSTERS_DIR, { recursive: true })
}

let cachedEncoder: string | null = null

/**
 * Detects the best available hardware-accelerated video encoder,
 * falling back to CPU libx264.
 */
export function detectBestEncoder(): string {
    if (cachedEncoder) return cachedEncoder

    const candidates = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf', 'libx264']

    for (const encoder of candidates) {
        try {
            execSync(
                `ffmpeg -hide_banner -f lavfi -i testsrc=duration=1:size=320x240:rate=1 -c:v ${encoder} -f null -`,
                { stdio: 'ignore', timeout: 4000 }
            )
            cachedEncoder = encoder
            return encoder
        } catch {
            // continue probing
        }
    }

    cachedEncoder = 'libx264'
    return cachedEncoder
}

/**
 * Generates an instant WebP poster thumbnail from a video file.
 */
export function generatePoster(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(inputPath)) {
            return reject(new Error(`Video file does not exist: ${inputPath}`))
        }
        if (!isVideoFile(path.basename(inputPath))) {
            return reject(new Error(`Not a recognized video file: ${inputPath}`))
        }

        const outDir = path.dirname(outputPath)
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true })
        }

        const args = [
            '-y',
            '-ss',
            '00:00:00.500',
            '-i',
            inputPath,
            '-vframes',
            '1',
            '-vf',
            "scale='min(720,iw)':-2",
            '-q:v',
            '80',
            outputPath,
        ]

        execFile('ffmpeg', args, { timeout: 15000 }, (error) => {
            if (error) {
                // Fallback to start of video if 0.5s is past duration
                const fallbackArgs = [
                    '-y',
                    '-i',
                    inputPath,
                    '-vframes',
                    '1',
                    '-vf',
                    "scale='min(720,iw)':-2",
                    '-q:v',
                    '80',
                    outputPath,
                ]
                execFile('ffmpeg', fallbackArgs, { timeout: 15000 }, (fallbackErr) => {
                    if (fallbackErr) return reject(fallbackErr)
                    resolve(outputPath)
                })
                return
            }
            resolve(outputPath)
        })
    })
}

/**
 * Optimizes a video for mobile streaming:
 * - GPU acceleration (NVENC/QSV/AMF/MF/libx264)
 * - Container faststart (+faststart MOOV atom at head of file)
 * - Resolution normalization (clamped to max 1080p width/height)
 * - Controlled bitrate (2.5 - 3.5 Mbps) for zero-lag mobile playback
 * - Fixed keyframes (-g 48) for instant seeking and smooth looping
 * - Universal AAC audio normalization
 */
export function optimizeVideo(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(inputPath)) {
            return reject(new Error(`Video file does not exist: ${inputPath}`))
        }
        if (!isVideoFile(path.basename(inputPath))) {
            return reject(new Error(`Not a recognized video file: ${inputPath}`))
        }

        const encoder = detectBestEncoder()
        const tempOutput = `${outputPath}.optimizing.tmp.mp4`

        const encoderArgs: string[] = []
        if (encoder === 'h264_nvenc') {
            encoderArgs.push(
                '-c:v',
                'h264_nvenc',
                '-preset',
                'p4',
                '-tune',
                'hq',
                '-b:v',
                '2500k',
                '-maxrate',
                '3500k',
                '-bufsize',
                '5000k'
            )
        } else if (encoder === 'h264_qsv') {
            encoderArgs.push(
                '-c:v',
                'h264_qsv',
                '-b:v',
                '2500k',
                '-maxrate',
                '3500k',
                '-bufsize',
                '5000k'
            )
        } else if (encoder === 'h264_amf') {
            encoderArgs.push(
                '-c:v',
                'h264_amf',
                '-b:v',
                '2500k',
                '-maxrate',
                '3500k',
                '-bufsize',
                '5000k'
            )
        } else if (encoder === 'h264_mf') {
            encoderArgs.push('-c:v', 'h264_mf', '-b:v', '2500k')
        } else {
            encoderArgs.push(
                '-c:v',
                'libx264',
                '-preset',
                'fast',
                '-crf',
                '23',
                '-maxrate',
                '3500k',
                '-bufsize',
                '5000k'
            )
        }

        const args = [
            '-y',
            '-i',
            inputPath,
            ...encoderArgs,
            '-vf',
            "scale='min(1080,iw)':-2",
            '-pix_fmt',
            'yuv420p',
            '-g',
            '48',
            '-keyint_min',
            '24',
            '-movflags',
            '+faststart',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-ar',
            '44100',
            tempOutput,
        ]

        execFile('ffmpeg', args, { timeout: 180000 }, (error) => {
            if (error) {
                if (fs.existsSync(tempOutput)) {
                    try {
                        fs.unlinkSync(tempOutput)
                    } catch {
                        // ignore
                    }
                }
                return reject(error)
            }

            try {
                if (fs.existsSync(outputPath) && inputPath === outputPath) {
                    fs.unlinkSync(outputPath)
                }
                fs.renameSync(tempOutput, outputPath)
                resolve(outputPath)
            } catch (err) {
                reject(err)
            }
        })
    })
}

/**
 * Scans directories and optimizes all videos and generates posters in the background.
 */
export async function optimizeAllVideos(): Promise<{ processed: number; encoder: string }> {
    const encoder = detectBestEncoder()
    const targetDirs = [
        path.join(process.cwd(), 'videos'),
        path.join(process.cwd(), 'public', 'videos'),
    ]

    let processed = 0

    for (const dir of targetDirs) {
        if (!fs.existsSync(dir)) continue

        // Clean up any stale partial/optimizing temp files left from aborted runs
        try {
            const rawFiles = fs.readdirSync(dir)
            for (const f of rawFiles) {
                if (
                    f.includes('.optimizing.') ||
                    f.includes('.tmp.') ||
                    f.endsWith('.tmp') ||
                    f.endsWith('.crdownload') ||
                    f.endsWith('.part')
                ) {
                    try {
                        fs.unlinkSync(path.join(dir, f))
                    } catch {
                        // ignore if in use
                    }
                }
            }
        } catch {
            // ignore
        }

        const files = fs.readdirSync(dir).filter(isVideoFile)

        for (const file of files) {
            const filePath = path.join(dir, file)
            const videoId = toVideoId(file)
            const posterPath = path.join(POSTERS_DIR, `${videoId}.webp`)

            // 1. Generate poster if missing
            if (!fs.existsSync(posterPath)) {
                try {
                    await generatePoster(filePath, posterPath)
                } catch (posterErr) {
                    console.error(`[transcode] Failed to generate poster for ${file}:`, posterErr)
                }
            }

            processed++
        }
    }

    return { processed, encoder }
}
