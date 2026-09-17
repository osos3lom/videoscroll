import { FC, JSX, useEffect, useRef, useState } from 'react'
import { MdAspectRatio, MdCropFree, MdFullscreen, MdVolumeOff, MdVolumeUp } from 'react-icons/md'
import Footer from '../footer'
import PlayIcon from '../playIcon'
import Sidebar from '../sidebar'
import { useInViewPlayback } from '../../hooks/useInViewPlayback'
import { VIDEOS_CHANGED_EVENT } from '../../hooks/useVideos'
import type { LocalVideo, VideoSocial } from '../../types/video'
import styles from './videos.module.css'

export interface IvideosProps {
    video: LocalVideo
    social?: VideoSocial
    isMuted: boolean
    isFirst?: boolean
    isNearView?: boolean
    initialIsHorizontal?: boolean
    onOrientationChange?: (videoId: string, isHorizontal: boolean) => void
    onToggleMute: () => void
    onSocialChange: (videoId: string, social: VideoSocial) => void
    onEnded?: () => void
}

const VideoComponent: FC<IvideosProps> = ({
    video,
    social,
    isMuted,
    isFirst = false,
    isNearView = true,
    initialIsHorizontal,
    onOrientationChange,
    onToggleMute,
    onSocialChange,
    onEnded,
}): JSX.Element => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isPausedByUser, setIsPausedByUser] = useState(false)
    const [detectedIsHorizontal, setDetectedIsHorizontal] = useState<boolean | null>(null)
    // Server metadata knows the orientation before any video bytes arrive,
    // so the layout does not jump when the first frame decodes.
    const metadataIsHorizontal =
        video.width && video.height ? video.width > video.height : undefined
    const isHorizontal = detectedIsHorizontal ?? initialIsHorizontal ?? metadataIsHorizontal ?? false
    const [fitMode, setFitMode] = useState<'fit-width' | 'fill-screen'>('fit-width')
    const isInView = useInViewPlayback(isNearView ? videoRef : containerRef, isFirst)

    // Cleanup video decoder buffers on unmount or when leaving active window
    useEffect(() => {
        const element = videoRef.current
        return () => {
            if (element) {
                try {
                    element.pause()
                    element.removeAttribute('src')
                    element.load()
                } catch {
                    // ignore
                }
            }
        }
    }, [isNearView])

    // The whole point: only the video in view plays. Everything else is paused
    // and rewound, so we never hold more than one active decode.
    // Set iOS-critical DOM properties before play() is called.
    useEffect(() => {
        const element = videoRef.current
        if (element) {
            element.muted = isMuted
            element.defaultMuted = isMuted
            element.setAttribute('playsinline', '')
            element.setAttribute('webkit-playsinline', 'true')
        }
    }, [isMuted, isNearView])

    useEffect(() => {
        const element = videoRef.current
        if (!element) return

        if (isInView && !isPausedByUser) {
            element.muted = isMuted
            const playPromise = element.play()
            if (playPromise !== undefined) {
                playPromise.catch(() => undefined)
            }
            return
        }

        element.pause()
        if (!isInView) {
            element.currentTime = 0
        }
    }, [isInView, isPausedByUser, isMuted])

    const togglePlayback = () => setIsPausedByUser((paused) => !paused)

    const handleCanPlay = () => {
        const element = videoRef.current
        if (element && isInView && !isPausedByUser) {
            element.muted = isMuted
            void element.play().catch(() => undefined)
        }
    }

    const handleLoadedMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
        const el = event.currentTarget
        if (el.videoWidth && el.videoHeight) {
            const horizontal = el.videoWidth > el.videoHeight
            setDetectedIsHorizontal(horizontal)
            onOrientationChange?.(video.videoId, horizontal)
        }
        handleCanPlay()
    }

    const toggleFitMode = (e: React.MouseEvent) => {
        e.stopPropagation()
        setFitMode((prev) => (prev === 'fit-width' ? 'fill-screen' : 'fit-width'))
    }

    const handleFullscreen = (e: React.MouseEvent) => {
        e.stopPropagation()
        const el = videoRef.current
        if (!el) return
        if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => undefined)
        } else if (el.requestFullscreen) {
            void el.requestFullscreen().catch(() => undefined)
        } else if ('webkitEnterFullscreen' in el) {
            const webkitVideo = el as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
            webkitVideo.webkitEnterFullscreen?.()
        }
    }

    const handleError = () => {
        console.error(`[videoscroll] Error loading video: ${video.fileName}`)
        // The usual cause after a device wakes from sleep is an expired media
        // token; refetching the list issues a fresh one.
        window.dispatchEvent(new Event(VIDEOS_CHANGED_EVENT))
        if (isInView && onEnded) {
            setTimeout(() => {
                onEnded()
            }, 1200)
        }
    }

    const poster = video.poster

    return (
        <div ref={containerRef} className={styles.video} id={video.videoId}>
            {/* Ambient background glow for horizontal videos */}
            {isNearView && isHorizontal && (
                <div
                    aria-hidden="true"
                    className={styles.video__ambient}
                    style={{ backgroundImage: `url(${poster})` }}
                />
            )}

            {isNearView ? (
                <video
                    ref={videoRef}
                    className={`${styles.video__element} ${
                        isHorizontal
                            ? fitMode === 'fit-width'
                                ? styles.video__element_horizontal
                                : styles.video__element_fill
                            : ''
                    }`}
                    src={video.src}
                    poster={poster}
                    muted={isMuted}
                    autoPlay={isInView}
                    playsInline
                    {...({ 'webkit-playsinline': 'true' } as Record<string, string>)}
                    preload={isInView ? 'auto' : 'metadata'}
                    // CORS mode is required, not optional: the service worker answers
                    // some range requests itself, and for a non-CORS <video> Chrome
                    // aborts playback when range responses come from different
                    // sources ("data source error").
                    crossOrigin="anonymous"
                    disablePictureInPicture
                    onCanPlay={handleCanPlay}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={onEnded}
                    onError={handleError}
                />
            ) : (
                <div className={styles.video__element} style={{ backgroundColor: '#000' }} />
            )}

            <button
                type="button"
                className={styles.video__press}
                onClick={togglePlayback}
                aria-label={isPausedByUser ? 'Play video' : 'Pause video'}
            >
                {isPausedByUser && <PlayIcon />}
            </button>

            <button
                type="button"
                className={styles.video__mute}
                onClick={onToggleMute}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
                {isMuted ? <MdVolumeOff size={20} /> : <MdVolumeUp size={20} />}
            </button>

            {/* Quick action controls for horizontal videos */}
            {isHorizontal && (
                <div className={styles.video__topControls}>
                    <button
                        type="button"
                        className={styles.video__pillButton}
                        onClick={toggleFitMode}
                        aria-label={fitMode === 'fit-width' ? 'Zoom to Fill' : 'Fit Full Width'}
                        title={fitMode === 'fit-width' ? 'Zoom to Fill' : 'Fit Full Width'}
                    >
                        {fitMode === 'fit-width' ? (
                            <>
                                <MdCropFree size={16} />
                                <span>Full Width</span>
                            </>
                        ) : (
                            <>
                                <MdAspectRatio size={16} />
                                <span>Zoomed</span>
                            </>
                        )}
                    </button>

                    <button
                        type="button"
                        className={styles.video__pillButton}
                        onClick={handleFullscreen}
                        aria-label="Fullscreen"
                        title="Fullscreen"
                    >
                        <MdFullscreen size={20} />
                    </button>
                </div>
            )}

            <Footer video={video} />
            <Sidebar
                video={video}
                social={social}
                onSocialChange={onSocialChange}
                isHorizontal={isHorizontal}
            />
        </div>
    )
}

export default VideoComponent
