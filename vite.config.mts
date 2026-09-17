import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { build, defineConfig, loadEnv, type Plugin } from 'vite'

/** Filenames of the committed fallback reels, kept in sync with src/lib/demoVideos.ts. */
const DEMO_CLIPS = ['clip1.mp4', 'clip2.mp4', 'clip3.mp4']

/**
 * Copies the committed demo reels out of `videos/` and into the bundle, so a
 * build with no API configured still has something to play.
 */
function demoClips(enabled: boolean): Plugin {
    return {
        name: 'videoscroll-demo-clips',
        apply: 'build',
        generateBundle() {
            if (!enabled) return

            for (const clip of DEMO_CLIPS) {
                const source = path.resolve('videos', clip)
                if (!fs.existsSync(source)) {
                    this.warn(`demo clip missing, skipping: ${source}`)
                    continue
                }
                this.emitFile({
                    type: 'asset',
                    fileName: `videos/${clip}`,
                    source: fs.readFileSync(source),
                })
            }
        },
    }
}

/**
 * The PWA manifest's `scope`/`start_url`/icon paths must match `base`, which
 * is `/videoscroll/` on Pages and `/` in development.
 */
function webmanifest(): Plugin {
    let base = '/'

    return {
        name: 'videoscroll-webmanifest',
        configResolved(config) {
            base = config.base
        },
        transformIndexHtml() {
            return [
                {
                    tag: 'link',
                    attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` },
                    injectTo: 'head',
                },
                {
                    tag: 'link',
                    attrs: { rel: 'apple-touch-icon', href: `${base}icon-192x192.png` },
                    injectTo: 'head',
                },
            ]
        },
        generateBundle() {
            const icon = (size: number) => ({
                src: `${base}icon-${size}x${size}.png`,
                sizes: `${size}x${size}`,
                type: 'image/png',
            })

            this.emitFile({
                type: 'asset',
                fileName: 'manifest.webmanifest',
                source: JSON.stringify(
                    {
                        name: 'VideoScroll',
                        short_name: 'VideoScroll',
                        description: 'مجتمع فيديو خاص',
                        theme_color: '#000000',
                        background_color: '#000000',
                        display: 'standalone',
                        display_override: ['standalone'],
                        scope: base,
                        start_url: base,
                        icons: [icon(192), icon(256), icon(384), icon(512)],
                    },
                    null,
                    4
                ),
            })
        },
    }
}

/**
 * Content-Security-Policy as a <meta> tag, since GitHub Pages cannot set
 * response headers. The session token lives in localStorage, so the policy's
 * job is to make sure no script but this bundle's own can ever run, and that
 * nothing can be sent anywhere except the API.
 *
 * Build only: the dev server injects inline scripts for hot reload.
 */
function contentSecurityPolicy(apiOrigin: string): Plugin {
    return {
        name: 'videoscroll-csp',
        apply: 'build',
        transformIndexHtml() {
            const api = apiOrigin ? ` ${apiOrigin}` : ''
            const policy = [
                "default-src 'self'",
                "script-src 'self'",
                "style-src 'self' 'unsafe-inline'",
                `img-src 'self' data: blob:${api}`,
                `media-src 'self' blob:${api}`,
                `connect-src 'self'${api}`,
                "worker-src 'self'",
                "manifest-src 'self'",
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
            ].join('; ')
            return [
                { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
                // Media and API requests must not leak the page URL (it may hold
                // an invite code in its fragment) — belt and braces.
                { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
            ]
        },
    }
}

/**
 * Builds src/sw/sw.ts into a single classic script at the root of the output,
 * `sw.js`. Separate from the app bundle because a service worker must not be
 * content-hashed (its URL is its identity) and should not depend on ES module
 * service worker support.
 */
function serviceWorker(enabled: boolean): Plugin {
    let outDir = 'dist'
    return {
        name: 'videoscroll-service-worker',
        apply: 'build',
        configResolved(config) {
            outDir = config.build.outDir
        },
        async closeBundle() {
            if (!enabled) return
            await build({
                configFile: false,
                logLevel: 'warn',
                publicDir: false,
                build: {
                    outDir,
                    emptyOutDir: false,
                    copyPublicDir: false,
                    lib: {
                        entry: path.resolve('src/sw/sw.ts'),
                        formats: ['iife'],
                        name: 'videoscrollServiceWorker',
                        fileName: () => 'sw.js',
                    },
                },
            })
        },
    }
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const apiOrigin = (env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '')
    const isDemo = apiOrigin === ''

    return {
        plugins: [
            react(),
            webmanifest(),
            contentSecurityPolicy(apiOrigin),
            demoClips(isDemo),
            serviceWorker(!isDemo),
        ],
        build: {
            // Videos are streamed from the API, never bundled; keep the asset
            // inline limit low so nothing large sneaks into the JS.
            assetsInlineLimit: 4096,
        },
        server: {
            // Reachable from a phone on the LAN, which is how playback gets tested.
            host: true,
            port: 5173,
            // The Go API owns port 3000; proxy so `npm run dev` is same-origin.
            proxy: {
                '/api': 'http://127.0.0.1:3000',
            },
        },
    }
})
