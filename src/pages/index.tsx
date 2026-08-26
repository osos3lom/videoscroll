import type { GetStaticProps, NextPage } from 'next'
import Head from 'next/head'
import { useCallback, useEffect, useRef, useState } from 'react'
import VideoComponent from '../components/video'
import Upload from '../components/upload'
import { useSocialStorage } from '../hooks/useSocialStorage'
import { listVideos, readSocial } from '../lib/videos'
import type { LocalVideo, VideoSocial } from '../types/video'
import styles from './index.module.css'

interface HomeProps {
    initialVideos: LocalVideo[]
    initialSocial: Record<string, VideoSocial>
}

const Home: NextPage<HomeProps> = ({ initialVideos = [], initialSocial = {} }) => {
    const [videos, setVideos] = useState<LocalVideo[]>(initialVideos)
    const [social, handleSocialChange] = useSocialStorage(initialSocial)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isMuted, setIsMuted] = useState(true)

    const handleVideoAdded = useCallback((newVideo: LocalVideo) => {
        setVideos((prev) => [newVideo, ...prev])
        // Scroll to the newly added video at the top
        setTimeout(() => {
            const container = containerRef.current
            if (container) {
                container.scrollTo({ top: 0, behavior: 'smooth' })
            }
        }, 100)
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
                            <h1>No videos yet</h1>
                            <p>
                                Add video files to the <code>public/videos/</code> folder, then build and deploy.
                            </p>
                            <p className={styles.app__emptyHint}>
                                Or tap <strong>+</strong> below to load one directly from your device.
                            </p>
                        </div>
                    )}
                </div>

                <Upload onVideoAdded={handleVideoAdded} />
            </main>
        </div>
    )
}

export const getStaticProps: GetStaticProps<HomeProps> = async () => {
    try {
        const initialVideos = listVideos()
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
