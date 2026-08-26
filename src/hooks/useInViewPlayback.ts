import { RefObject, useEffect, useState } from 'react'

/** Fraction of the video that must be visible before it starts playing. */
const PLAY_THRESHOLD = 0.5

/**
 * Reports whether an element is the one currently filling the viewport.
 *
 * This is what keeps a single video playing at a time: without it every
 * <video> in the feed would autoplay at once and never stop.
 */
export const useInViewPlayback = (
    elementRef: RefObject<HTMLElement | null>,
    initialInView = false
): boolean => {
    const [isInView, setIsInView] = useState(initialInView)

    useEffect(() => {
        const element = elementRef.current
        if (!element || typeof IntersectionObserver === 'undefined') return

        const container = element.closest('#videos__container')

        const observer = new IntersectionObserver(
            ([entry]) => setIsInView(entry.isIntersecting),
            {
                root: container ?? null,
                threshold: PLAY_THRESHOLD,
            }
        )

        observer.observe(element)
        return () => observer.disconnect()
    }, [elementRef])

    return isInView
}
