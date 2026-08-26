import type { GetStaticProps, NextPage } from 'next'
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

const LikesPage: NextPage<LikesPageProps> = ({ initialVideos = [], initialSocial = {} }) => {
    const [videos] = useState<LocalVideo[]>(initialVideos)
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

export const getStaticProps: GetStaticProps<LikesPageProps> = async () => {
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

export default LikesPage
