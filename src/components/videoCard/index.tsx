import { FC, JSX, useRef, useState, useEffect } from 'react'
import { MdDeleteOutline, MdEdit } from 'react-icons/md'
import { Link } from 'react-router'
import type { LocalVideo } from '../../types/video'
import styles from './videoCard.module.css'

export interface IVideoCardProps {
    video: LocalVideo
    /** Shown as a delete button when the viewer may delete this video. */
    onDelete?: () => void
    /** Shown as a rename button when the viewer may rename this video. */
    onRename?: () => void
    /** Small caption under the title, e.g. who uploaded it. */
    subtitle?: string
}

const VideoCard: FC<IVideoCardProps> = ({ video, onDelete, onRename, subtitle }): JSX.Element => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [progress, setProgress] = useState(0)

    // Format file size helper
    const formatSize = (bytes: number): string => {
        if (!bytes) return '0 بايت'
        const k = 1024
        const sizes = ['بايت', 'ك.ب', 'م.ب', 'ج.ب']
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
        <Link to={`/#${video.videoId}`} className={styles.card}>
            <div
                className={styles.card__container}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <video
                    ref={videoRef}
                    className={styles.card__video}
                    src={`${video.src}#t=0.1`}
                    poster={video.poster}
                    loop
                    muted
                    preload="none"
                    crossOrigin="anonymous"
                    onTimeUpdate={handleTimeUpdate}
                />

                {/* Overlay Header: Title and Size */}
                <div className={styles.card__header}>
                    <h3 className={styles.card__title} title={video.title}>
                        {video.title}
                    </h3>
                    <span className={styles.card__size}>
                        {subtitle ? `${subtitle} · ` : ''}
                        {formatSize(video.size)}
                    </span>
                </div>

                {(onDelete || onRename) && (
                    <div className={styles.card__actions}>
                        {onRename && (
                            <button
                                type="button"
                                className={styles.card__action}
                                aria-label={`تعديل اسم ${video.title}`}
                                onClick={(event) => {
                                    // Inside the card's link: don't navigate.
                                    event.preventDefault()
                                    event.stopPropagation()
                                    onRename()
                                }}
                            >
                                <MdEdit size={17} />
                            </button>
                        )}
                        {onDelete && (
                            <button
                                type="button"
                                className={`${styles.card__action} ${styles.card__action_danger}`}
                                aria-label={`حذف ${video.title}`}
                                onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    onDelete()
                                }}
                            >
                                <MdDeleteOutline size={18} />
                            </button>
                        )}
                    </div>
                )}

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
