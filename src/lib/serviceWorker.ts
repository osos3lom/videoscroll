import { IS_DEMO, staticUrl } from './apiUrl'

const KILL_SWITCH_KEY = 'videoscroll_sw'

/**
 * Registers sw.js, which serves prefetched video bytes. Production only —
 * the file is emitted by the build, not by the dev server.
 *
 * `localStorage.videoscroll_sw = 'off'` unregisters it, as an escape hatch if
 * a browser ever misbehaves with service-worker-served media.
 */
export function registerServiceWorker(): void {
    if (!import.meta.env.PROD || IS_DEMO || !('serviceWorker' in navigator)) return

    let disabled = false
    try {
        disabled = localStorage.getItem(KILL_SWITCH_KEY) === 'off'
    } catch {
        // storage blocked
    }

    if (disabled) {
        void navigator.serviceWorker
            .getRegistrations()
            .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        return
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(staticUrl('sw.js'), { scope: import.meta.env.BASE_URL })
            .catch((error) => console.error('[videoscroll] service worker registration failed', error))
    })
}

/** Whether a service worker is controlling this page and can serve cache. */
export function hasActiveServiceWorker(): boolean {
    return typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller)
}
