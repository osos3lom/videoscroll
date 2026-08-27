import type { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import { useState } from 'react'
import { useSocialStorage } from '../hooks/useSocialStorage'
import VideoCard from '../components/videoCard'
import { listVideos, readSocial } from '../lib/videos'
import type { LocalVideo, VideoSocial } from '../types/video'
import styles from './sharedGrid.module.css'

interface LikesPageProps {
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
            src: `${basePath}/api/video/clip1.mp4`,
            size: 8218006,
        },
        {
            videoId: 'v-clip2',
            fileName: 'clip2.mp4',
            title: 'Reel 2 - Coastal Breeze',
            src: `${basePath}/api/video/clip2.mp4`,
            size: 4310068,
        },
        {
            videoId: 'v-clip3',
            fileName: 'clip3.mp4',
            title: 'Reel 3 - Scenic Waves',
            src: `${basePath}/api/video/clip3.mp4`,
            size: 9072343,
        },
    ]
}

const LikesPage: NextPage<LikesPageProps> = ({ initialVideos = [], initialSocial = {} }) => {
    const [videos] = useState<LocalVideo[]>(() =>
        initialVideos.length > 0 ? initialVideos : getDemoVideos()
    )
    const [social] = useSocialStorage(initialSocial)

    const likedVideos = videos.filter((v) => (social[v.videoId]?.likes ?? 0) > 0)

    return (
        <div className={styles.container}>
            <Head>
                <title>Liked Videos - VideoScroll</title>
                <meta name="description" content="Browse videos you have liked" />
            </Head>

            <header className={styles.header}>
                <h1 className={styles.header__title}>Liked Videos</h1>
                <p className={styles.header__subtitle}>
                    Browse reels that you have liked ({likedVideos.length})
                </p>
            </header>

            <main>
                {likedVideos.length > 0 ? (
                    <div className={styles.grid}>
                        {likedVideos.map((video) => (
                            <VideoCard
                                key={video.videoId}
                                video={video}
                            />
                        ))}
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <h2>No liked videos yet</h2>
                        <p>Go to the feed and click the heart icon on your favorite videos!</p>
                    </div>
                )}
            </main>
        </div>
    )
}

export const getServerSideProps: GetServerSideProps<LikesPageProps> = async ({ res }) => {
    try {
        res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=59')
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

export default LikesPage

