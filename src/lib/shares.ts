/** SWR key of the share-link list, so creating or stopping a link refreshes it. */
export const SHARES_KEY = '/api/shares'

/** "until 21 Sep, 14:00" style text for a link's expiry. */
export function expiryText(expiresAt?: string): string {
    if (!expiresAt) return 'بدون انتهاء'
    return `حتى ${new Date(expiresAt).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })}`
}
