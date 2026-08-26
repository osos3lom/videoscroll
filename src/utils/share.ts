/**
 * Shares the current page using the browser's native share sheet.
 * Falls back to copying the URL. Nothing is sent anywhere by the app itself.
 */
export const onShare = async (title: string): Promise<void> => {
    const url = window.document.location.href

    if (navigator.share) {
        try {
            await navigator.share({ title, url })
            return
        } catch {
            // User dismissed the share sheet — nothing to do.
            return
        }
    }

    try {
        await navigator.clipboard.writeText(url)
    } catch (error) {
        console.error('Could not copy link to clipboard', error)
    }
}
