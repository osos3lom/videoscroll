import { FC, JSX, useEffect, useRef, useState } from 'react'
import { MdVolumeOff, MdVolumeUp } from 'react-icons/md'
import Footer from '../footer'
import PlayIcon from '../playIcon'
import Sidebar from '../sidebar'
import { useInViewPlayback } from '../../hooks/useInViewPlayback'
import type { LocalVideo, VideoSocial } from '../../types/video'
import styles from './videos.module.css'

export interface IvideosProps {
    video: LocalVideo
    social?: VideoSocial
    isMuted: boolean
    isFirst?: boolean
    isNearView?: boolean
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
    onToggleMute,
    onSocialChange,
    onEnded,
}): JSX.Element => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isPausedByUser, setIsPausedByUser] = useState(false)
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

    const handleError = () => {
        console.error(`[videoscroll] Error loading video: ${video.fileName}`)
        if (isInView && onEnded) {
            setTimeout(() => {
                onEnded()
            }, 1200)
        }
    }

    const posterUrl = `/api/poster/${video.videoId}`

    return (
        <div ref={containerRef} className={styles.video} id={video.videoId}>
            {isNearView ? (
                <video
                    ref={videoRef}
                    className={styles.video__element}
                    src={video.src}
                    poster={posterUrl}
                    muted={isMuted}
                    autoPlay={isInView}
                    playsInline
                    {...({ 'webkit-playsinline': 'true' } as Record<string, string>)}
                    preload={isInView ? 'auto' : 'metadata'}
                    disablePictureInPicture
                    onCanPlay={handleCanPlay}
                    onLoadedMetadata={handleCanPlay}
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

            <Footer video={video} />
            <Sidebar video={video} social={social} onSocialChange={onSocialChange} />
        </div>
    )
}

export default VideoComponent
