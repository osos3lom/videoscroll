import type { GetStaticProps, NextPage } from 'next'
import Head from 'next/head'
import { useCallback, useEffect, useRef, useState } from 'react'
import VideoComponent from '../components/video'
import { useSocialStorage } from '../hooks/useSocialStorage'
import { listVideos, readSocial } from '../lib/videos'
import { LOCAL_VIDEO_UPDATE_EVENT, listLocalVideos } from '../lib/videoStore'
import type { LocalVideo, VideoSocial } from '../types/video'
import styles from './index.module.css'

interface HomeProps {
    initialVideos: LocalVideo[]
    initialSocial: Record<string, VideoSocial>
}

const getDemoVideos = (): LocalVideo[] => {
    const basePath =
        typeof window !== 'undefined' && window.location.pathname.startsWith('/videoscroll')
            ? '/videoscroll'
            : process.env.NEXT_PUBLIC_BASE_PATH || ''

    return [
        {
            videoId: 'v-clip1',
            fileName: 'clip1.mp4',
            title: 'Reel 1 - Ocean Views',
            src: `${basePath}/videos/clip1.mp4`,
            size: 8218006,
        },
        {
            videoId: 'v-clip2',
            fileName: 'clip2.mp4',
            title: 'Reel 2 - Coastal Breeze',
            src: `${basePath}/videos/clip2.mp4`,
            size: 4310068,
        },
        {
            videoId: 'v-clip3',
            fileName: 'clip3.mp4',
            title: 'Reel 3 - Scenic Waves',
            src: `${basePath}/videos/clip3.mp4`,
            size: 9072343,
        },
    ]
}

const Home: NextPage<HomeProps> = ({ initialVideos = [], initialSocial = {} }) => {
    const [videos, setVideos] = useState<LocalVideo[]>(() =>
        initialVideos.length > 0 ? initialVideos : getDemoVideos()
    )
    const [social, handleSocialChange] = useSocialStorage(initialSocial)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isMuted, setIsMuted] = useState(true)

    const loadDemoVideos = useCallback(() => {
        setVideos(getDemoVideos())
    }, [])

    // Merge in videos uploaded previously (persisted in IndexedDB) and keep in
    // sync with uploads triggered from elsewhere, e.g. the navbar's upload button.
    useEffect(() => {
        let cancelled = false

        const mergeStoredVideos = (stored: LocalVideo[]) => {
            if (cancelled) return
            setVideos((prev) => {
                const storedIds = new Set(stored.map((video) => video.videoId))
                return [...stored, ...prev.filter((video) => !storedIds.has(video.videoId))]
            })
        }

        // Initial hydration on mount — no scrolling, just fill in what's stored.
        listLocalVideos()
            .then(mergeStoredVideos)
            .catch((caught) => console.error('[videoscroll] failed to load stored videos', caught))

        // A genuinely new upload happened (from any page) — merge it in and
        // jump to the top of the feed so it's immediately visible.
        const handleLocalVideoUpdate = () => {
            listLocalVideos()
                .then((stored) => {
                    mergeStoredVideos(stored)
                    const container = containerRef.current
                    if (container) {
                        setTimeout(() => container.scrollTo({ top: 0, behavior: 'smooth' }), 100)
                    }
                })
                .catch((caught) => console.error('[videoscroll] failed to load stored videos', caught))
        }

        window.addEventListener(LOCAL_VIDEO_UPDATE_EVENT, handleLocalVideoUpdate)
        return () => {
            cancelled = true
            window.removeEventListener(LOCAL_VIDEO_UPDATE_EVENT, handleLocalVideoUpdate)
        }
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

            const isDown = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key.toLowerCase() === 'j'
            const isUp = event.key === 'ArrowUp' || event.key === 'PageUp' || event.key.toLowerCase() === 'k'
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

    // Scroll to hash on load or when videos change
    useEffect(() => {
        const hash = window.location.hash
        if (hash) {
            const videoId = hash.replace('#', '')
            const targetElement = document.getElementById(videoId)
            if (targetElement) {
                setTimeout(() => {
                    targetElement.scrollIntoView({ behavior: 'auto' })
                }, 50)
            }
        }
    }, [videos])

    const toggleMute = useCallback(() => setIsMuted((muted) => !muted), [])

    return (
        <div className={styles.app}>
            <Head>
                <title>Local video scroller</title>
                <meta name="description" content="Scroll through videos stored on your own machine" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, viewport-fit=cover"
                />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <main className={styles.app__frame}>
                <div className={styles.app__videos} id="videos__container" ref={containerRef}>
                    {videos.map((video, index) => (
                        <VideoComponent
                            key={video.videoId}
                            video={video}
                            social={social[video.videoId]}
                            isMuted={isMuted}
                            isFirst={index === 0}
                            onToggleMute={toggleMute}
                            onSocialChange={handleSocialChange}
                        />
                    ))}

                    {videos.length === 0 && (
                        <div className={styles.app__empty}>
                            <h1>No videos loaded</h1>
                            <p>
                                Add video files to the <code>public/videos/</code> folder, or load our demo reels.
                            </p>
                            <button
                                type="button"
                                className={styles.app__demoBtn}
                                onClick={loadDemoVideos}
                            >
                                Load Demo Videos
                            </button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}

export const getStaticProps: GetStaticProps<HomeProps> = async () => {
    try {
        let initialVideos = listVideos()
        if (initialVideos.length === 0) {
            const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
            initialVideos = [
                {
                    videoId: 'v-clip1',
                    fileName: 'clip1.mp4',
                    title: 'Reel 1 - Ocean Views',
                    src: `${basePath}/videos/clip1.mp4`,
                    size: 8218006,
                },
                {
                    videoId: 'v-clip2',
                    fileName: 'clip2.mp4',
                    title: 'Reel 2 - Coastal Breeze',
                    src: `${basePath}/videos/clip2.mp4`,
                    size: 4310068,
                },
                {
                    videoId: 'v-clip3',
                    fileName: 'clip3.mp4',
                    title: 'Reel 3 - Scenic Waves',
                    src: `${basePath}/videos/clip3.mp4`,
                    size: 9072343,
                },
            ]
        }
        const initialSocial = readSocial()
        return {
            props: {
                initialVideos,
                initialSocial,
            },
        }
    } catch {
        return {
            props: {
                initialVideos: [],
                initialSocial: {},
            },
        }
    }
}

export default Home
