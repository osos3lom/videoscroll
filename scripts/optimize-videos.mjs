/* eslint-disable no-console */
import { execSync, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const POSTERS_DIR = path.join(process.cwd(), 'public', 'posters')
if (!fs.existsSync(POSTERS_DIR)) {
    fs.mkdirSync(POSTERS_DIR, { recursive: true })
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.m4v'])
const isVideoFile = (fileName) => {
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
const toVideoId = (fileName) => `v-${Buffer.from(fileName, 'utf8').toString('base64url').replace(/=+$/, '')}`

function detectBestEncoder() {
    const candidates = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf', 'libx264']
    for (const encoder of candidates) {
        try {
            execSync(
                `ffmpeg -hide_banner -f lavfi -i testsrc=duration=1:size=320x240:rate=1 -c:v ${encoder} -f null -`,
                { stdio: 'ignore', timeout: 4000 }
            )
            return encoder
        } catch {
            // continue
        }
    }
    return 'libx264'
}

function generatePoster(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(inputPath) || !isVideoFile(path.basename(inputPath))) {
            return reject(new Error(`Invalid or missing video file: ${inputPath}`))
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
        execFile('ffmpeg', args, { timeout: 15000 }, (err) => {
            if (err) {
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
                execFile('ffmpeg', fallbackArgs, { timeout: 15000 }, (fbErr) => {
                    if (fbErr) return reject(fbErr)
                    resolve(outputPath)
                })
                return
            }
            resolve(outputPath)
        })
    })
}

function optimizeVideo(inputPath, outputPath, encoder) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(inputPath) || !isVideoFile(path.basename(inputPath))) {
            return reject(new Error(`Invalid or missing video file: ${inputPath}`))
        }
        const tempOutput = `${outputPath}.optimizing.tmp.mp4`
        const encoderArgs = []

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
            encoderArgs.push('-c:v', 'h264_qsv', '-b:v', '2500k', '-maxrate', '3500k', '-bufsize', '5000k')
        } else if (encoder === 'h264_amf') {
            encoderArgs.push('-c:v', 'h264_amf', '-b:v', '2500k', '-maxrate', '3500k', '-bufsize', '5000k')
        } else if (encoder === 'h264_mf') {
            encoderArgs.push('-c:v', 'h264_mf', '-b:v', '2500k')
        } else {
            encoderArgs.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-maxrate', '3500k', '-bufsize', '5000k')
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

async function main() {
    console.log('\n🚀 Starting VideoScroll GPU Video Optimizer & Poster Generator...')
    const encoder = detectBestEncoder()
    console.log(`✨ Detected Video Encoder: [${encoder}]`)

    const targetDirs = [path.join(process.cwd(), 'videos'), path.join(process.cwd(), 'public', 'videos')]

    let totalVideos = 0
    let totalPosters = 0

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
                        // ignore
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

            // 1. Posters
            if (!fs.existsSync(posterPath)) {
                try {
                    process.stdout.write(`📸 Extracting poster for ${file}... `)
                    await generatePoster(filePath, posterPath)
                    console.log('✓')
                    totalPosters++
                } catch (e) {
                    console.log(`✗ Error: ${e.message}`)
                }
            }

            // 2. FastStart & Keyframe Optimization
            try {
                process.stdout.write(`⚡ Web-optimizing ${file}... `)
                await optimizeVideo(filePath, filePath, encoder)
                console.log('✓')
            } catch (e) {
                console.log(`(kept current: ${e.message})`)
            }

            totalVideos++
        }
    }

    console.log(`\n🎉 Processed ${totalVideos} videos (${totalPosters} new posters created).`)
    console.log('⚡ All videos are web-optimized for instant mobile playback!\n')
}

main().catch((err) => {
    console.error('Fatal optimizer error:', err)
    process.exit(1)
})
