import { useCallback, useEffect, useRef, useState } from 'react'
import { useVideoGestures } from '../../hooks/useVideoGestures'
import PlayIcon from '../playIcon'
import SeekOverlay from '../video/seekOverlay'
import styles from './mediaSlide.module.css'

export interface SlideMedia {
    kind: 'video' | 'image'
    src: string
    poster?: string
    title: string
}

interface Props {
    media: SlideMedia
    /** The one item on screen: only it plays. */
    active: boolean
    muted: boolean
    /** Autoplay with sound was refused; the viewer falls back to muted. */
    onAutoplayBlocked?: () => void
    /** A video failed to load, e.g. after its media token expired. */
    onError?: () => void
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return '0:00'
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * One full-screen photo or video in a collection. Photos are shown whole
 * over a blurred copy of themselves. Videos play while active, loop, and
 * answer taps (pause, double-tap skip) but leave sideways swipes to the
 * collection, with a seek bar for moving through them instead.
 */
export default function MediaSlide({ media, active, muted, onAutoplayBlocked, onError }: Props) {
    return (
        <div className={styles.slide}>
            {media.poster && (
                <div aria-hidden="true" className={styles.ambient} style={{ backgroundImage: `url("${media.poster}")` }} />
            )}
            {media.kind === 'image' ? (
                <img
                    className={styles.image}
                    src={media.src}
                    alt={media.title}
                    decoding="async"
                    draggable={false}
                    onError={onError}
                />
            ) : (
                <SlideVideo media={media} active={active} muted={muted} onAutoplayBlocked={onAutoplayBlocked} onError={onError} />
            )}
        </div>
    )
}

function SlideVideo({ media, active, muted, onAutoplayBlocked, onError }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [paused, setPaused] = useState(false)
    const [time, setTime] = useState(0)
    const [duration, setDuration] = useState(0)

    const gestures = useVideoGestures(videoRef, {
        onTogglePlayback: () => setPaused((p) => !p),
        enabled: active,
        scrub: false,
    })

    const start = useCallback(
        (element: HTMLVideoElement) => {
            const attempt = element.play()
            attempt?.catch(() => {
                if (element.muted) return
                element.muted = true
                onAutoplayBlocked?.()
                void element.play().catch(() => undefined)
            })
        },
        [onAutoplayBlocked]
    )

    // Leaving an item forgets a pause, like the feed.
    const [wasActive, setWasActive] = useState(active)
    if (wasActive !== active) {
        setWasActive(active)
        if (!active) setPaused(false)
    }

    useEffect(() => {
        const element = videoRef.current
        if (!element) return
        element.muted = muted
        if (active && !paused) {
            start(element)
            return
        }
        element.pause()
        // ...and rewinds it.
        if (!active && element.currentTime > 0) element.currentTime = 0
    }, [active, paused, muted, start])

    return (
        <>
            <video
                ref={videoRef}
                className={styles.video}
                src={media.src}
                poster={media.poster}
                muted={muted}
                loop
                playsInline
                preload={active ? 'auto' : 'metadata'}
                // Required: the service worker answers some ranges itself.
                crossOrigin="anonymous"
                disablePictureInPicture
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                onCanPlay={(event) => {
                    if (active && !paused && !gestures.isScrubbing()) start(event.currentTarget)
                }}
                onError={onError}
            />
            <button
                type="button"
                className={styles.press}
                {...gestures.handlers}
                aria-label={paused ? 'تشغيل الفيديو' : 'إيقاف الفيديو مؤقتاً'}
                tabIndex={active ? 0 : -1}
            >
                {paused && <PlayIcon />}
            </button>
            <SeekOverlay skip={gestures.skip} scrub={null} />
            {active && duration > 0 && (
                // Physical direction, like the rest of the player.
                <div className={styles.seek} dir="ltr">
                    <span className={styles.time}>{formatTime(time)}</span>
                    <input
                        type="range"
                        className={styles.range}
                        min={0}
                        max={duration}
                        step={0.1}
                        value={Math.min(time, duration)}
                        aria-label="موضع التشغيل"
                        onChange={(event) => {
                            const element = videoRef.current
                            if (!element) return
                            element.currentTime = Number(event.target.value)
                            setTime(element.currentTime)
                        }}
                        // The bar is a horizontal control inside a horizontal
                        // swipe area: keep the drag on the bar.
                        onPointerDown={(event) => event.stopPropagation()}
                        style={{ touchAction: 'none' }}
                    />
                    <span className={styles.time}>{formatTime(duration)}</span>
                </div>
            )}
        </>
    )
}
