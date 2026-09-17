/**
 * How aggressively to prefetch, from the hints the browser exposes. The
 * Network Information API is Chromium-only; elsewhere this assumes a decent
 * connection, and the prefetch is small enough that being wrong is cheap.
 */

interface NetworkInformation {
    saveData?: boolean
    effectiveType?: 'slow-2g' | '2g' | '3g' | '4g'
    type?: string
}

function connection(): NetworkInformation | undefined {
    return (navigator as Navigator & { connection?: NetworkInformation }).connection
}

/** Number of upcoming videos worth prefetching right now. */
export function prefetchCount(): number {
    const info = connection()
    if (info?.saveData) return 0
    switch (info?.effectiveType) {
        case 'slow-2g':
        case '2g':
            return 0
        case '3g':
            return 1
    }
    if (info?.type === 'cellular') return 1
    return 2
}
