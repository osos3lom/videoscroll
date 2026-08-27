import type { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import { useState } from 'react'
import { useSocialStorage } from '../hooks/useSocialStorage'
import VideoCard from '../components/videoCard'
import { listVideos, readSocial } from '../lib/videos'
import type { LocalVideo, VideoSocial } from '../types/video'
import styles from './sharedGrid.module.css'

interface ProfilePageProps {
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

const ProfilePage: NextPage<ProfilePageProps> = ({ initialVideos = [], initialSocial = {} }) => {
    const [videos] = useState<LocalVideo[]>(() =>
        initialVideos.length > 0 ? initialVideos : getDemoVideos()
    )
    const [social] = useSocialStorage(initialSocial)

    // Compute stats
    const totalVideos = videos.length
    const totalLikes = videos.reduce((acc, v) => acc + (social[v.videoId]?.likes ?? 0), 0)
    const totalSaved = videos.reduce((acc, v) => acc + (social[v.videoId]?.bookmarks ?? 0), 0)

    return (
        <div className={styles.container}>
            <Head>
                <title>My Profile - VideoScroll</title>
                <meta name="description" content="Manage your local videos and profile statistics" />
            </Head>

            <header className={styles.profileHeader}>
                <div className={styles.profileHeader__avatar}>
                    <div className={styles.profileHeader__avatarInner}>U</div>
                </div>

                <div className={styles.profileHeader__info}>
                    <h1>Local Creator</h1>
                    <p>@local_creator</p>
                </div>

                <div className={styles.profileStats}>
                    <div className={styles.profileStat}>
                        <span className={styles.profileStat__value}>{totalVideos}</span>
                        <span className={styles.profileStat__label}>Videos</span>
                    </div>
                    <div className={styles.profileStat}>
                        <span className={styles.profileStat__value}>{totalLikes}</span>
                        <span className={styles.profileStat__label}>Likes</span>
                    </div>
                    <div className={styles.profileStat}>
                        <span className={styles.profileStat__value}>{totalSaved}</span>
                        <span className={styles.profileStat__label}>Saved</span>
                    </div>
                </div>
            </header>

            <main>
                <h2 className={styles.profileSectionTitle}>My Uploads</h2>

                {videos.length > 0 ? (
                    <div className={styles.grid}>
                        {videos.map((video) => (
                            <VideoCard
                                key={video.videoId}
                                video={video}
                            />
                        ))}
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <h2>No uploads yet</h2>
                        <p>Click the &quot;+&quot; button in the navigation bar to upload your first video!</p>
                    </div>
                )}
            </main>
        </div>
    )
}

export const getServerSideProps: GetServerSideProps<ProfilePageProps> = async ({ res }) => {
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

export default ProfilePage

