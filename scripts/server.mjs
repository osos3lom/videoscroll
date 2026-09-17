#!/usr/bin/env node
/**
 * Cross-platform wrapper around the Go toolchain for the backend in server/,
 * so npm scripts work the same from PowerShell, cmd and bash.
 *
 *   node scripts/server.mjs build            -> dist-server/videoscroll[.exe] for this machine
 *   node scripts/server.mjs build --linux    -> dist-server/videoscroll, static linux/amd64
 *   node scripts/server.mjs dev [args]       -> build, then `videoscroll serve`
 *   node scripts/server.mjs cli <cmd> [args] -> build, then `videoscroll <cmd>`
 *   node scripts/server.mjs test             -> go vet + go test
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const serverDir = path.join(root, 'server')

function findGo() {
    const probe = spawnSync('go', ['version'], { stdio: 'ignore', shell: false })
    if (probe.status === 0) return 'go'
    // winget installs here but only new shells pick up the PATH change.
    const windowsDefault = 'C:\\Program Files\\Go\\bin\\go.exe'
    if (process.platform === 'win32' && fs.existsSync(windowsDefault)) return windowsDefault
    console.error('Go is not installed or not on PATH. See docs/self-hosting.md.')
    process.exit(1)
}

const go = findGo()

function run(args, env = {}) {
    execFileSync(go, args, { cwd: serverDir, stdio: 'inherit', env: { ...process.env, ...env } })
}

function version() {
    try {
        return execFileSync('git', ['describe', '--always', '--dirty'], { cwd: root }).toString().trim()
    } catch {
        return 'dev'
    }
}

function build({ linux = false } = {}) {
    const exe = !linux && process.platform === 'win32' ? '.exe' : ''
    const output = path.join(root, 'dist-server', `videoscroll${exe}`)
    const env = linux ? { GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' } : { CGO_ENABLED: '0' }
    run(['build', '-trimpath', '-ldflags', `-s -w -X main.version=${version()}`, '-o', output, './cmd/videoscroll'], env)
    return output
}

function exec(binary, args) {
    // Run from the repo root so .env.server and the default ./media resolve there.
    const child = spawn(binary, args, { cwd: root, stdio: 'inherit' })
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => child.kill(signal))
    }
    child.on('exit', (code) => process.exit(code ?? 0))
}

const [command, ...rest] = process.argv.slice(2)

switch (command) {
    case 'build': {
        const output = build({ linux: rest.includes('--linux') })
        console.log(`built ${path.relative(root, output)}`)
        break
    }
    case 'dev':
        exec(build(), ['serve', ...rest])
        break
    case 'cli':
        exec(build(), rest)
        break
    case 'test':
        run(['vet', './...'])
        run(['test', './...'])
        break
    default:
        console.error('usage: node scripts/server.mjs build [--linux] | dev | cli <command> | test')
        process.exit(2)
}
