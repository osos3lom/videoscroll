import { useEffect } from 'react'

/**
 * Sets `document.title` for as long as the calling route is mounted, restoring
 * the previous title on unmount. Replaces the handful of `next/head` uses, all
 * of which only set a title.
 */
export function useDocumentTitle(title: string): void {
    useEffect(() => {
        const previous = document.title
        document.title = title
        return () => {
            document.title = previous
        }
    }, [title])
}
