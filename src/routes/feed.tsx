import { useCallback, useEffect, useRef, useState } from 'react'
import { MdFitScreen, MdStayCurrentPortrait } from 'react-icons/md'
import VideoComponent from '../components/video'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePrefetch } from '../hooks/usePrefetch'
import { useSession } from '../hooks/useSession'
import { useSocialStorage } from '../hooks/useSocialStorage'
import { useVideos } from '../hooks/useVideos'
import styles from './feed.module.css'

const FeedPage = () => {
    useDocumentTitle('VideoScroll')

    const { videos, social: serverSocial, isLoading, error } = useVideos()
    const session = useSession()
    const canUpload = session?.user.role === 'owner' || session?.user.role === 'uploader'
    const [social, handleSocialChange] = useSocialStorage(serverSocial)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isMuted, setIsMuted] = useState(true)
    const [activeIndex, setActiveIndex] = useState(0)
    const [horizontalVideos, setHorizontalVideos] = useState<Record<string, boolean>>({})
    const [isWideMode, setIsWideMode] = useState(false)

    const handleOrientationChange = useCallback((videoId: string, isHorizontal: boolean) => {
        setHorizontalVideos((prev) => {
            if (prev[videoId] === isHorizontal) return prev
            return { ...prev, [videoId]: isHorizontal }
        })
    }, [])

    const toggleWideMode = useCallback(() => setIsWideMode((prev) => !prev), [])

    usePrefetch(videos, activeIndex)

    const activeVideo = videos[activeIndex]
    const isCurrentHorizontal = activeVideo ? Boolean(horizontalVideos[activeVideo.videoId]) : false

    // Virtualization / Windowing: Track active scroll index to only mount
    // video decoders in the DOM for current & immediately adjacent items (±1).
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const handleScroll = () => {
            const itemHeight = container.clientHeight
            if (itemHeight > 0) {
                const newIndex = Math.round(container.scrollTop / itemHeight)
                setActiveIndex((prev) => (prev !== newIndex ? newIndex : prev))
            }
        }

        container.addEventListener('scroll', handleScroll, { passive: true })
        return () => container.removeEventListener('scroll', handleScroll)
    }, [])

    // Unlock WebKit audio/video playback restrictions on iOS upon first user interaction
    useEffect(() => {
        const unlockMedia = () => {
            const videoElements = document.querySelectorAll<HTMLVideoElement>('video')
            videoElements.forEach((video) => {
                if (video.muted) {
                    video.muted = true
                    void video.play().catch(() => undefined)
                }
            })
            window.removeEventListener('touchstart', unlockMedia)
            window.removeEventListener('click', unlockMedia)
        }

        window.addEventListener('touchstart', unlockMedia, { once: true, passive: true })
        window.addEventListener('click', unlockMedia, { once: true })
        return () => {
            window.removeEventListener('touchstart', unlockMedia)
            window.removeEventListener('click', unlockMedia)
        }
    }, [])

    // Arrow keys / PageUp / PageDown / j / k page through feed, m toggles mute.
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const container = containerRef.current
            if (!container) return

            if (event.key.toLowerCase() === 'm') {
                setIsMuted((muted) => !muted)
                return
            }

            const isDown =
                event.key === 'ArrowDown' ||
                event.key === 'PageDown' ||
                event.key.toLowerCase() === 'j'
            const isUp =
                event.key === 'ArrowUp' || event.key === 'PageUp' || event.key.toLowerCase() === 'k'
            if (!isDown && !isUp) return

            event.preventDefault()
            container.scrollBy({
                top: isDown ? container.clientHeight : -container.clientHeight,
                behavior: 'smooth',
            })
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    // Scroll to the #videoId in the URL once the list it refers to has arrived.
    const hasHandledHash = useRef(false)
    useEffect(() => {
        if (hasHandledHash.current || videos.length === 0) return
        const hash = window.location.hash
        if (!hash) {
            hasHandledHash.current = true
            return
        }

        const targetElement = document.getElementById(hash.replace('#', ''))
        if (targetElement) {
            hasHandledHash.current = true
            targetElement.scrollIntoView({ behavior: 'auto' })
        }
    }, [videos])

    const toggleMute = useCallback(() => setIsMuted((muted) => !muted), [])

    const handleNextVideo = useCallback(
        (currentIndex: number) => {
            const container = containerRef.current
            if (!container) return

            if (currentIndex < videos.length - 1) {
                const nextIndex = currentIndex + 1
                const targetElement = container.children[nextIndex] as HTMLElement | undefined
                if (targetElement && typeof targetElement.scrollIntoView === 'function') {
                    targetElement.scrollIntoView({ behavior: 'smooth' })
                } else {
                    container.scrollTo({
                        top: nextIndex * container.clientHeight,
                        behavior: 'smooth',
                    })
                }
            }
        },
        [videos.length]
    )

    return (
        <div className={styles.app}>
            <main
                className={`${styles.app__frame} ${
                    isWideMode
                        ? styles.app__frame_fullwidth
                        : isCurrentHorizontal
                          ? styles.app__frame_horizontal
                          : ''
                }`}
            >
                {/* Desktop toggle button to switch between Full Width and Phone Frame */}
                <button
                    type="button"
                    className={styles.app__wideToggle}
                    onClick={toggleWideMode}
                    aria-label={isWideMode ? 'Exit full width' : 'Expand full width'}
                    title={isWideMode ? 'Switch to Portrait Frame' : 'Expand to Full Width'}
                >
                    {isWideMode ? (
                        <>
                            <MdStayCurrentPortrait size={16} />
                            <span>Standard</span>
                        </>
                    ) : (
                        <>
                            <MdFitScreen size={16} />
                            <span>Full Width</span>
                        </>
                    )}
                </button>

                <div className={styles.app__videos} id="videos__container" ref={containerRef}>
                    {videos.map((video, index) => {
                        const isNear = Math.abs(index - activeIndex) <= 1
                        const isMounted = Math.abs(index - activeIndex) <= 2

                        if (!isMounted) {
                            return (
                                <div
                                    key={video.videoId}
                                    id={video.videoId}
                                    className={styles.app__placeholder}
                                />
                            )
                        }

                        return (
                            <VideoComponent
                                key={video.videoId}
                                video={video}
                                social={social[video.videoId]}
                                isMuted={isMuted}
                                isFirst={index === 0}
                                isNearView={isNear}
                                initialIsHorizontal={horizontalVideos[video.videoId]}
                                onOrientationChange={handleOrientationChange}
                                onToggleMute={toggleMute}
                                onSocialChange={handleSocialChange}
                                onEnded={() => handleNextVideo(index)}
                            />
                        )
                    })}

                    {videos.length === 0 && (
                        <div className={styles.app__empty}>
                            {isLoading ? (
                                <h1>Loading videos…</h1>
                            ) : error ? (
                                <>
                                    <h1>Can’t reach the server</h1>
                                    <p>
                                        The community server may be offline or restarting. This
                                        page retries automatically.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <h1>No videos yet</h1>
                                    <p>
                                        {canUpload ? (
                                            <>
                                                Use the <strong>+</strong> button to upload the
                                                first one.
                                            </>
                                        ) : (
                                            'Nothing has been shared yet. Check back soon.'
                                        )}
                                    </p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}

export default FeedPage
