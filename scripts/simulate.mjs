#!/usr/bin/env node
/**
 * Runs a local copy of the production topology:
 *
 *   http://localhost:4174/videoscroll/   the GitHub Pages bundle (vite preview)
 *   http://localhost:3100                the Go API, a different origin
 *
 * Because the two are on different origins and the bundle is a real
 * production build, this exercises everything the live site does: CORS, the
 * Content-Security-Policy, the /videoscroll/ base path, bearer tokens, media
 * tokens and the service worker.
 *
 * All state lives in .sim/ (gitignored). The first run creates an owner
 * account with a random password and imports the three demo clips.
 *
 *   npm run simulate              start (reuses .sim/ state)
 *   npm run simulate -- --fresh   wipe .sim/ first
 *
 * The e2e suite imports startSimulation() with its own directory and ports.
 */
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const binary = path.join(root, 'dist-server', process.platform === 'win32' ? 'videoscroll.exe' : 'videoscroll')
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const DEMO_CLIPS = ['clip1.mp4', 'clip2.mp4', 'clip3.mp4'].map((c) => path.join(root, 'videos', c))

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { cwd: root, stdio: options.quiet ? 'pipe' : 'inherit', ...options })
    if (result.status !== 0) {
        const output = options.quiet ? `\n${result.stdout}\n${result.stderr}` : ''
        throw new Error(`${path.basename(command)} ${args.join(' ')} failed (${result.status})${output}`)
    }
    return result
}

async function waitFor(url, timeoutMs, child) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`process for ${url} exited with ${child.exitCode}`)
        try {
            const response = await fetch(url)
            if (response.ok) return
        } catch {
            // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`timed out waiting for ${url}`)
}

/**
 * @param {object} [options]
 * @param {string} [options.dir]       state directory, relative to the repo
 * @param {number} [options.apiPort]
 * @param {number} [options.webPort]
 * @param {boolean} [options.fresh]    delete the state directory first
 * @param {boolean} [options.quiet]    hide build and server output
 */
export async function startSimulation({
    dir = '.sim',
    apiPort = 3100,
    webPort = 4174,
    fresh = false,
    quiet = false,
} = {}) {
    const simDir = path.join(root, dir)
    const mediaDir = path.join(simDir, 'media')
    const distDir = path.join(simDir, 'dist')
    const credentialsFile = path.join(simDir, 'credentials.json')
    const apiOrigin = `http://localhost:${apiPort}`
    const webOrigin = `http://localhost:${webPort}`
    const log = quiet ? () => {} : (msg) => console.log(`\x1b[36m[simulate]\x1b[0m ${msg}`)

    if (fresh) fs.rmSync(simDir, { recursive: true, force: true })
    fs.mkdirSync(simDir, { recursive: true })

    log('building the Go server')
    run(process.execPath, ['scripts/server.mjs', 'build'], { quiet })

    log(`building the Pages bundle against ${apiOrigin}`)
    run(process.execPath, [viteBin, 'build', '--mode', 'pages', '--base=/videoscroll/', '--outDir', distDir, '--emptyOutDir'], {
        quiet,
        env: { ...process.env, VITE_API_ORIGIN: apiOrigin },
    })

    // Explicit environment, and an env file that does not exist, so a
    // developer's .env.server can never leak into the simulation.
    const serverEnv = {
        ...process.env,
        VIDEOSCROLL_ENV_FILE: path.join(simDir, 'no-env-file'),
        HOST: '127.0.0.1',
        PORT: String(apiPort),
        MEDIA_DIR: mediaDir,
        ALLOWED_ORIGINS: `${webOrigin},http://127.0.0.1:${webPort}`,
        APP_URL: `${webOrigin}/videoscroll`,
        MIN_FREE_BYTES: String(1 << 30),
        FFMPEG_THREADS: '2',
    }

    let credentials
    if (fs.existsSync(credentialsFile)) {
        credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'))
    } else {
        credentials = { username: 'owner', password: crypto.randomBytes(12).toString('base64url') }
        log('creating the owner account')
        run(binary, ['create-owner', credentials.username], {
            quiet: true,
            env: serverEnv,
            input: `${credentials.password}\n`,
        })
        fs.writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2))

        log('importing the demo clips')
        run(binary, ['import', ...DEMO_CLIPS], { quiet: true, env: serverEnv })
    }

    log(`starting the API on ${apiOrigin}`)
    const api = spawn(binary, ['serve'], { cwd: root, env: serverEnv, stdio: quiet ? 'ignore' : 'inherit' })

    log(`starting the frontend on ${webOrigin}/videoscroll/`)
    const web = spawn(
        process.execPath,
        [viteBin, 'preview', '--outDir', distDir, '--base=/videoscroll/', '--port', String(webPort), '--strictPort'],
        { cwd: root, stdio: quiet ? 'ignore' : 'inherit' }
    )

    const stop = async () => {
        for (const child of [web, api]) {
            if (child.exitCode === null) child.kill()
        }
        await Promise.all(
            [web, api].map((child) =>
                child.exitCode !== null ? null : new Promise((resolve) => child.once('exit', resolve))
            )
        )
    }

    try {
        await waitFor(`${apiOrigin}/api/health`, 30_000, api)
        await waitFor(`${webOrigin}/videoscroll/`, 30_000, web)
        await waitForVideos(apiOrigin, credentials)
    } catch (error) {
        await stop()
        throw error
    }

    return { apiOrigin, webOrigin, appUrl: `${webOrigin}/videoscroll/`, mediaDir, simDir, credentials, stop }
}

/** Waits until the imported clips have been processed and listed. */
async function waitForVideos(apiOrigin, credentials) {
    const login = await fetch(`${apiOrigin}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
    })
    if (!login.ok) throw new Error(`owner login failed: ${login.status}`)
    const { token } = await login.json()

    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
        const response = await fetch(`${apiOrigin}/api/videos`, { headers: { Authorization: `Bearer ${token}` } })
        const body = await response.json()
        if (body.data?.length >= DEMO_CLIPS.length) return
        await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('demo clips were not processed within 60s')
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
    const sim = await startSimulation({ fresh: process.argv.includes('--fresh') })
    console.log(`
\x1b[32mSimulation running.\x1b[0m

  App:       ${sim.appUrl}
  API:       ${sim.apiOrigin}
  Sign in:   ${sim.credentials.username} / ${sim.credentials.password}
  State:     ${path.relative(root, sim.simDir)}/  (delete it, or pass --fresh, to start over)

Things to try: swipe the feed, upload a video with the + button, create an
invite in Profile → Manage community and open it in a private window.

Press Ctrl+C to stop.
`)
    const shutdown = async () => {
        await sim.stop()
        process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
}
