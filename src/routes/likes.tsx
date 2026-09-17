import VideoCard from '../components/videoCard'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSocialStorage } from '../hooks/useSocialStorage'
import { useVideos } from '../hooks/useVideos'
import styles from './sharedGrid.module.css'

const LikesPage = () => {
    useDocumentTitle('Liked Videos - VideoScroll')

    const { videos, social: serverSocial } = useVideos()
    const [social] = useSocialStorage(serverSocial)

    const likedVideos = videos.filter((video) => (social[video.videoId]?.likes ?? 0) > 0)

    return (
        <div className={styles.container}>
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
                            <VideoCard key={video.videoId} video={video} />
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

export default LikesPage
