/**
 * Single source of truth for every URL the app builds.
 *
 * The app is served from GitHub Pages and calls the self-hosted API on another
 * origin, named by `VITE_API_ORIGIN`. In development the origin is empty and
 * Vite proxies `/api` to the local server, so every helper degrades to a
 * root-relative path.
 */

/** Origin of the API, without a trailing slash. Empty means same-origin. */
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '')

/**
 * A production build with no API configured has nothing to sign in to, so it
 * shows the three bundled demo reels instead. This is what a fork of the repo
 * publishes before its owner has set `VITE_API_ORIGIN`.
 */
export const IS_DEMO = import.meta.env.PROD && API_ORIGIN === ''

export function apiUrl(path: string): string {
    return `${API_ORIGIN}${path}`
}

/**
 * Media URLs carry a media-scoped token as `t`, because `<video src>` and CSS
 * `background-image` cannot send an Authorization header. The token is stable
 * for hours at a time, so the URL — and every cache keyed on it — is too.
 */
export function videoSrc(videoId: string, mediaToken: string): string {
    return apiUrl(`/api/video/${encodeURIComponent(videoId)}?t=${encodeURIComponent(mediaToken)}`)
}

/** Like `videoSrc`, but the server answers with Content-Disposition: attachment. */
export function downloadUrl(videoId: string, mediaToken: string): string {
    return apiUrl(`/api/download/${encodeURIComponent(videoId)}?t=${encodeURIComponent(mediaToken)}`)
}

export function posterUrl(videoId: string, mediaToken: string): string {
    return apiUrl(`/api/poster/${encodeURIComponent(videoId)}?t=${encodeURIComponent(mediaToken)}`)
}

/*
 * Public share links. The code goes in the query (as `s`), where the
 * server's log filter strips it; the page that uses them keeps it in the
 * fragment, so GitHub Pages never sees it either.
 */
const publicApi = (kind: string, code: string) => apiUrl(`/api/public/${kind}?s=${encodeURIComponent(code)}`)
export const publicShareUrl = (code: string) => publicApi('share', code)
export const publicVideoSrc = (code: string) => publicApi('video', code)
export const publicPosterUrl = (code: string) => publicApi('poster', code)
export const publicDownloadUrl = (code: string) => publicApi('download', code)

/** The page a share link opens: `…/videoscroll/watch#<code>`. */
export function shareLink(code: string): string {
    return new URL(`${import.meta.env.BASE_URL}watch#${code}`, window.location.origin).href
}

/**
 * URL of a file shipped inside this build's own `public/` directory. Honours
 * `base`, so it resolves correctly under the `/videoscroll/` Pages prefix and
 * from a deep link alike.
 */
export function staticUrl(path: string): string {
    return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}
