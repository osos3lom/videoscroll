export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

/**
 * Opens the device's share sheet for a URL, or copies it where there is none.
 * Must run inside a tap: Safari refuses the share sheet otherwise.
 */
export async function shareUrl(title: string, url: string): Promise<ShareResult> {
    if (navigator.share) {
        try {
            await navigator.share({ title, url })
            return 'shared'
        } catch (error) {
            // AbortError: the person closed the sheet.
            return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed'
        }
    }
    return copyText(url)
}

export async function copyText(text: string): Promise<ShareResult> {
    try {
        await navigator.clipboard.writeText(text)
        return 'copied'
    } catch (error) {
        console.error('Could not copy to the clipboard', error)
        return 'failed'
    }
}

/** The demo build has no server to make links with: share the page itself. */
export const onShare = (title: string): Promise<ShareResult> => shareUrl(title, window.location.href)
