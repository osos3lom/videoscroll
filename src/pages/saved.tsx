import type { GetStaticProps, NextPage } from 'next'
import Head from 'next/head'
import { useState } from 'react'
import { useSocialStorage } from '../hooks/useSocialStorage'
import VideoCard from '../components/videoCard'
import { listVideos, readSocial } from '../lib/videos'
import type { LocalVideo, VideoSocial } from '../types/video'
import styles from './sharedGrid.module.css'

interface SavedPageProps {
    initialVideos: LocalVideo[]
    initialSocial: Record<string, VideoSocial>
}

const SavedPage: NextPage<SavedPageProps> = ({ initialVideos = [], initialSocial = {} }) => {
    const [videos] = useState<LocalVideo[]>(initialVideos)
    const [social] = useSocialStorage(initialSocial)

    const savedVideos = videos.filter((v) => (social[v.videoId]?.bookmarks ?? 0) > 0)

    return (
        <div className={styles.container}>
            <Head>
                <title>Saved Videos - VideoScroll</title>
                <meta name="description" content="Browse videos you have bookmarked" />
            </Head>

            <header className={styles.header}>
                <h1 className={styles.header__title}>Saved Videos</h1>
                <p className={styles.header__subtitle}>
                    Browse reels that you have bookmarked ({savedVideos.length})
                </p>
            </header>

            <main>
                {savedVideos.length > 0 ? (
                    <div className={styles.grid}>
                        {savedVideos.map((video) => (
                            <VideoCard
                                key={video.videoId}
                                video={video}
                            />
                        ))}
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <h2>No saved videos yet</h2>
                        <p>Go to the feed and click the bookmark icon to save your favorite clips!</p>
                    </div>
                )}
            </main>
        </div>
    )
}

export const getStaticProps: GetStaticProps<SavedPageProps> = async () => {
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

export default SavedPage
