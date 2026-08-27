import { FC, JSX, useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import type { LocalVideo } from '../../types/video'
import styles from './videoCard.module.css'

export interface IVideoCardProps {
    video: LocalVideo
}

const VideoCard: FC<IVideoCardProps> = ({ video }): JSX.Element => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [progress, setProgress] = useState(0)

    // Format file size helper
    const formatSize = (bytes: number): string => {
        if (!bytes) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
    }

    const handleMouseEnter = () => {
        const element = videoRef.current
        if (element) {
            element.muted = true
            void element.play().catch(() => undefined)
        }
    }

    const handleMouseLeave = () => {
        const element = videoRef.current
        if (element) {
            element.pause()
            element.currentTime = 0
            setProgress(0)
        }
    }

    const handleTimeUpdate = () => {
        const element = videoRef.current
        if (element && element.duration) {
            setProgress((element.currentTime / element.duration) * 100)
        }
    }

    // Safely configure element properties on load/mount
    useEffect(() => {
        const element = videoRef.current
        if (element) {
            element.muted = true
            element.defaultMuted = true
            element.setAttribute('playsinline', '')
            element.setAttribute('webkit-playsinline', 'true')
        }
    }, [])

    return (
        <Link href={`/#${video.videoId}`} className={styles.card} passHref>
            <div
                className={styles.card__container}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <video
                    ref={videoRef}
                    className={styles.card__video}
                    src={`${video.src}#t=0.1`}
                    poster={`/api/poster/${video.videoId}`}
                    loop
                    muted
                    preload="none"
                    onTimeUpdate={handleTimeUpdate}
                />

                {/* Overlay Header: Title and Size */}
                <div className={styles.card__header}>
                    <h3 className={styles.card__title} title={video.title}>
                        {video.title}
                    </h3>
                    <span className={styles.card__size}>{formatSize(video.size)}</span>
                </div>

                {/* Real-time playback progress bar */}
                <div className={styles.card__progressBar}>
                    <div
                        className={styles.card__progressFill}
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </Link>
    )
}

export default VideoCard
