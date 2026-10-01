import { useCallback, useEffect, useRef, useState } from 'react'
import { MdFitScreen, MdStayCurrentPortrait } from 'react-icons/md'
import VideoComponent from '../components/video'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePrefetch } from '../hooks/usePrefetch'
import { useSession } from '../hooks/useSession'
import { useReactions } from '../hooks/useReactions'
import { seekBy } from '../hooks/useVideoGestures'
import { useVideos } from '../hooks/useVideos'
import styles from './feed.module.css'

const FeedPage = () => {
    useDocumentTitle('VideoScroll')

    const { videos, social: serverSocial, isLoading, error } = useVideos()
    const session = useSession()
    const canUpload = session?.user.role === 'owner' || session?.user.role === 'uploader'
    const reactions = useReactions(serverSocial)
    const containerRef = useRef<HTMLDivElement>(null)
    // Sound is on by default. Where the browser refuses to autoplay it, the
    // video reports back and this flips to muted until the first tap.
    const [isMuted, setIsMuted] = useState(false)
    const isMutedRef = useRef(false)
    const hasPickedSoundRef = useRef(false)
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

    const applyMuted = useCallback((muted: boolean) => {
        isMutedRef.current = muted
        setIsMuted(muted)
    }, [])

    // The first tap or click is the user gesture that lets sound through, so it
    // undoes the autoplay fallback. Un-mute right here inside the event: WebKit
    // accepts it during a gesture, not from the effect that follows it.
    useEffect(() => {
        const detach = () => {
            window.removeEventListener('touchstart', unlockAudio)
            window.removeEventListener('click', unlockAudio)
        }

        function unlockAudio() {
            if (hasPickedSoundRef.current || !isMutedRef.current) {
                detach()
                return
            }

            let unmuted = false
            for (const video of document.querySelectorAll<HTMLVideoElement>('video')) {
                if (video.paused) continue
                unmuted = true
                video.muted = false
                video.play().catch(() => {
                    // Still refused: a playing video beats a silent stall.
                    video.muted = true
                    void video.play().catch(() => undefined)
                    applyMuted(true)
                })
            }

            // Nothing was playing yet, so wait for the next gesture instead.
            if (!unmuted) return
            applyMuted(false)
            detach()
        }

        window.addEventListener('touchstart', unlockAudio, { passive: true })
        window.addEventListener('click', unlockAudio)
        return detach
    }, [applyMuted])

    // Once someone picks, that choice sticks: no fallback or unlock overrides it.
    const toggleMute = useCallback(() => {
        hasPickedSoundRef.current = true
        applyMuted(!isMutedRef.current)
    }, [applyMuted])

    const handleAutoplayBlocked = useCallback(() => applyMuted(true), [applyMuted])

    // Arrow keys / PageUp / PageDown / j / k page through feed, m toggles mute.
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const container = containerRef.current
            if (!container) return

            if (event.key.toLowerCase() === 'm') {
                toggleMute()
                return
            }

            // Physical directions, like the double-tap sides: → is forward.
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                const middle = container.getBoundingClientRect().top + container.clientHeight / 2
                const video = Array.from(container.querySelectorAll('video')).find((el) => {
                    const rect = el.getBoundingClientRect()
                    return rect.top <= middle && rect.bottom >= middle
                })
                if (!video) return
                event.preventDefault()
                seekBy(video, event.key === 'ArrowRight' ? 5 : -5)
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
    }, [toggleMute])

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
                    aria-label={isWideMode ? 'الخروج من وضع العرض الكامل' : 'توسيع للعرض الكامل'}
                    title={isWideMode ? 'التبديل إلى الإطار العمودي' : 'توسيع إلى العرض الكامل'}
                >
                    {isWideMode ? (
                        <>
                            <MdStayCurrentPortrait size={16} />
                            <span>قياسي</span>
                        </>
                    ) : (
                        <>
                            <MdFitScreen size={16} />
                            <span>عرض كامل</span>
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
                                reaction={{
                                    liked: reactions.isLiked(video.videoId),
                                    saved: reactions.isSaved(video.videoId),
                                    counts: reactions.counts(video.videoId),
                                }}
                                isMuted={isMuted}
                                isFirst={index === 0}
                                isNearView={isNear}
                                initialIsHorizontal={horizontalVideos[video.videoId]}
                                onOrientationChange={handleOrientationChange}
                                onToggleMute={toggleMute}
                                onAutoplayBlocked={handleAutoplayBlocked}
                                onToggleReaction={reactions.toggle}
                                onEnded={() => handleNextVideo(index)}
                            />
                        )
                    })}

                    {videos.length === 0 && (
                        <div className={styles.app__empty}>
                            {isLoading ? (
                                <h1>جارٍ تحميل الفيديوهات…</h1>
                            ) : error ? (
                                <>
                                    <h1>تعذر الاتصال بالخادم</h1>
                                    <p>
                                        قد يكون خادم المجتمع متوقفاً أو يعيد التشغيل. تحاول هذه الصفحة
                                        إعادة الاتصال تلقائياً.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <h1>لا توجد فيديوهات حتى الآن</h1>
                                    <p>
                                        {canUpload ? (
                                            <>
                                                استخدم زر <strong>+</strong> لرفع أول فيديو.
                                            </>
                                        ) : (
                                            'لم تتم مشاركة أي شيء بعد. تفقد الصفحة قريباً.'
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
