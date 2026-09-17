import {
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from 'react'

/** Seconds a double tap jumps. */
export const SKIP_SECONDS = 10
/** A drag across the full width covers at most this much of a long video. */
const SCRUB_SPAN_SECONDS = 180
const DOUBLE_TAP_MS = 300
/** Further taps within this window add to a running skip (+20, +30…). */
const SKIP_CHAIN_MS = 600
/** Taps on the sides wait this long, in case a second tap follows. */
const SINGLE_TAP_DELAY_MS = 250
const TAP_SLOP_PX = 10
const TAP_MAX_MS = 500

type Zone = 'back' | 'middle' | 'forward'

export interface SkipFeedback {
    side: 'back' | 'forward'
    seconds: number
    /** Changes on every tap, so the ripple animation restarts. */
    key: number
}

export interface ScrubFeedback {
    time: number
    duration: number
}

interface Gesture {
    pointerId: number
    startX: number
    startY: number
    startedAt: number
    width: number
    left: number
    mode: 'pending' | 'scrub' | 'ignored'
    originTime: number
    wasPaused: boolean
}

function clampTime(video: HTMLVideoElement, time: number): number {
    const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.1) : time
    return Math.min(Math.max(0, time), end)
}

function seek(video: HTMLVideoElement, time: number, exact: boolean) {
    const target = clampTime(video, time)
    // Safari's fastSeek lands on the nearest keyframe: smooth while dragging.
    const fast = video as HTMLVideoElement & { fastSeek?: (time: number) => void }
    if (!exact && typeof fast.fastSeek === 'function') fast.fastSeek(target)
    else video.currentTime = target
}

/** Moves a video by `delta` seconds, e.g. from the arrow keys. */
export function seekBy(video: HTMLVideoElement, delta: number) {
    seek(video, video.currentTime + delta, true)
}

/**
 * Taps, double taps and horizontal drags on a feed video:
 *
 *   - tap: play or pause (on the sides, after a short wait for a second tap)
 *   - double tap on the right or left third: skip 10 s forward or back
 *   - horizontal drag: scrub; the video follows the finger
 *
 * Directions are physical (right is forward), as in other video apps, RTL
 * or not. Vertical drags are left to the browser, which scrolls the feed: the
 * target has `touch-action: pan-y`, so the browser cancels the pointer as
 * soon as it takes over.
 */
export function useVideoGestures(
    videoRef: RefObject<HTMLVideoElement | null>,
    { onTogglePlayback, enabled }: { onTogglePlayback: () => void; enabled: boolean }
) {
    const [skip, setSkip] = useState<SkipFeedback | null>(null)
    const [scrub, setScrub] = useState<ScrubFeedback | null>(null)

    const gesture = useRef<Gesture | null>(null)
    const lastTap = useRef<{ at: number; zone: Zone } | null>(null)
    const lastSkip = useRef<{ at: number; side: 'back' | 'forward'; seconds: number } | null>(null)
    const tapTimer = useRef<number | undefined>(undefined)
    const skipTimer = useRef<number | undefined>(undefined)
    const frame = useRef<number | undefined>(undefined)
    const pendingSeek = useRef<number | null>(null)
    const toggleRef = useRef(onTogglePlayback)

    useEffect(() => {
        toggleRef.current = onTogglePlayback
    }, [onTogglePlayback])

    // Scrolling away mid-gesture abandons it. (The scrub display is hidden
    // below while disabled, and cleared by the next gesture.)
    useEffect(() => {
        if (enabled) return
        window.clearTimeout(tapTimer.current)
        if (frame.current !== undefined) cancelAnimationFrame(frame.current)
        frame.current = undefined
        pendingSeek.current = null
        gesture.current = null
        lastTap.current = null
    }, [enabled])

    useEffect(
        () => () => {
            window.clearTimeout(tapTimer.current)
            window.clearTimeout(skipTimer.current)
            if (frame.current !== undefined) cancelAnimationFrame(frame.current)
        },
        []
    )

    const doSkip = (side: 'back' | 'forward', now: number) => {
        const video = videoRef.current
        if (!video) return
        const chained = lastSkip.current && lastSkip.current.side === side && now - lastSkip.current.at < SKIP_CHAIN_MS
        const seconds = chained ? lastSkip.current!.seconds + SKIP_SECONDS : SKIP_SECONDS
        lastSkip.current = { at: now, side, seconds }
        seekBy(video, side === 'forward' ? SKIP_SECONDS : -SKIP_SECONDS)
        setSkip({ side, seconds, key: now })
        window.clearTimeout(skipTimer.current)
        skipTimer.current = window.setTimeout(() => setSkip(null), 700)
    }

    const onTap = (zone: Zone, now: number) => {
        const previous = lastTap.current
        lastTap.current = { at: now, zone }

        if (zone !== 'middle') {
            const isDouble = previous && previous.zone === zone && now - previous.at < DOUBLE_TAP_MS
            const isChain =
                lastSkip.current && lastSkip.current.side === zone && now - lastSkip.current.at < SKIP_CHAIN_MS
            if (isDouble || isChain) {
                window.clearTimeout(tapTimer.current)
                doSkip(zone, now)
                return
            }
            window.clearTimeout(tapTimer.current)
            tapTimer.current = window.setTimeout(() => toggleRef.current(), SINGLE_TAP_DELAY_MS)
            return
        }
        window.clearTimeout(tapTimer.current)
        toggleRef.current()
    }

    const applySeek = () => {
        frame.current = undefined
        const video = videoRef.current
        if (video && pendingSeek.current !== null) seek(video, pendingSeek.current, false)
    }

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
        const video = videoRef.current
        const rect = event.currentTarget.getBoundingClientRect()
        setScrub(null)
        gesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startedAt: performance.now(),
            width: rect.width,
            left: rect.left,
            mode: 'pending',
            originTime: video?.currentTime ?? 0,
            wasPaused: video?.paused ?? true,
        }
    }

    const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
        const g = gesture.current
        const video = videoRef.current
        if (!g || g.pointerId !== event.pointerId || !video) return
        const dx = event.clientX - g.startX
        const dy = event.clientY - g.startY

        if (g.mode === 'pending') {
            if (Math.abs(dx) > TAP_SLOP_PX && Math.abs(dx) >= 1.5 * Math.abs(dy)) {
                if (!Number.isFinite(video.duration) || video.duration <= 0) {
                    g.mode = 'ignored'
                    return
                }
                g.mode = 'scrub'
                g.originTime = video.currentTime
                g.wasPaused = video.paused
                window.clearTimeout(tapTimer.current)
                event.currentTarget.setPointerCapture(event.pointerId)
                video.pause()
            } else if (Math.abs(dy) > TAP_SLOP_PX) {
                g.mode = 'ignored'
            }
        }

        if (g.mode === 'scrub') {
            const span = Math.min(video.duration, SCRUB_SPAN_SECONDS)
            const time = clampTime(video, g.originTime + (dx / g.width) * span)
            pendingSeek.current = time
            if (frame.current === undefined) frame.current = requestAnimationFrame(applySeek)
            setScrub({ time, duration: video.duration })
        }
    }

    const finishScrub = (g: Gesture) => {
        const video = videoRef.current
        if (frame.current !== undefined) cancelAnimationFrame(frame.current)
        frame.current = undefined
        if (video && pendingSeek.current !== null) seek(video, pendingSeek.current, true)
        pendingSeek.current = null
        if (video && !g.wasPaused) void video.play().catch(() => undefined)
        setScrub(null)
    }

    const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
        const g = gesture.current
        if (!g || g.pointerId !== event.pointerId) return
        gesture.current = null

        if (g.mode === 'scrub') {
            finishScrub(g)
            return
        }
        const now = performance.now()
        const moved = Math.hypot(event.clientX - g.startX, event.clientY - g.startY)
        if (g.mode !== 'pending' || moved > TAP_SLOP_PX || now - g.startedAt > TAP_MAX_MS) return

        const x = (event.clientX - g.left) / g.width
        onTap(x < 1 / 3 ? 'back' : x > 2 / 3 ? 'forward' : 'middle', now)
    }

    const onPointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
        const g = gesture.current
        if (!g || g.pointerId !== event.pointerId) return
        gesture.current = null
        if (g.mode === 'scrub') finishScrub(g)
    }

    // Pointer taps are handled above; a click with no pointer behind it is
    // the keyboard (Enter or Space on the focused button).
    const onClick = (event: ReactMouseEvent<HTMLElement>) => {
        if (event.detail === 0) toggleRef.current()
    }

    return {
        /** Seeking fires canplay; the player must not resume during a drag. */
        isScrubbing: () => gesture.current?.mode === 'scrub',
        skip: enabled ? skip : null,
        scrub: enabled ? scrub : null,
        handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick },
    }
}
