import VideoCard from '../components/videoCard'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSocialStorage } from '../hooks/useSocialStorage'
import { useVideos } from '../hooks/useVideos'
import styles from './sharedGrid.module.css'

const SavedPage = () => {
    useDocumentTitle('المقاطع المحفوظة - VideoScroll')

    const { videos, social: serverSocial } = useVideos()
    const [social] = useSocialStorage(serverSocial)

    const savedVideos = videos.filter((video) => (social[video.videoId]?.bookmarks ?? 0) > 0)

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.header__title}>المقاطع المحفوظة</h1>
                <p className={styles.header__subtitle}>
                    تصفح المقاطع التي قمت بحفظها ({savedVideos.length})
                </p>
            </header>

            <main>
                {savedVideos.length > 0 ? (
                    <div className={styles.grid}>
                        {savedVideos.map((video) => (
                            <VideoCard key={video.videoId} video={video} />
                        ))}
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <h2>لا توجد مقاطع محفوظة بعد</h2>
                        <p>انتقل إلى الفيديوهات واضغط على رمز الإشارة المرجعية لحفظ مقاطعك المفضلة!</p>
                    </div>
                )}
            </main>
        </div>
    )
}

export default SavedPage
