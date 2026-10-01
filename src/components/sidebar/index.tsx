import { MdFavorite, MdFileDownload, MdLibraryAdd, MdOutlineBookmark } from 'react-icons/md'
import { RiShareForwardFill } from 'react-icons/ri'
import styles from './sidebar.module.css'
import { FC, JSX, useState } from 'react'
import { IS_DEMO } from '../../lib/apiUrl'
import { downloadVideo } from '../../lib/download'
import ShareDialog from '../shareDialog'
import { onShare } from '../../utils/share'
import type { LocalVideo, ReactionKind, VideoSocial } from '../../types/api'
import 'animate.css'

/** What one member has done with one item, and the community totals. */
export interface ReactionState {
    liked: boolean
    saved: boolean
    counts: VideoSocial
}

export interface ISidebarProps {
    video: LocalVideo
    reaction: ReactionState
    onToggleReaction: (kind: ReactionKind, videoId: string) => void
    /** Shown as "add to collection" when set. */
    onAddToCollection?: (videoId: string) => void
    isHorizontal?: boolean
}

const Sidebar: FC<ISidebarProps> = ({
    video,
    reaction,
    onToggleReaction,
    onAddToCollection,
    isHorizontal = false,
}): JSX.Element => {
    const [isSharing, setIsSharing] = useState(false)
    const { liked, saved, counts } = reaction

    return (
        <div className={`${styles.sidebar} ${isHorizontal ? styles.sidebar_horizontal : ''}`}>
            <button
                type="button"
                className={styles.sidebar__button}
                onClick={() => onToggleReaction('like', video.videoId)}
                aria-label={liked ? 'إلغاء الإعجاب' : 'إعجاب'}
                aria-pressed={liked}
            >
                <MdFavorite
                    size={40}
                    color={liked ? '#D65076' : '#fff'}
                    className={liked ? 'animate__animated animate__heartBeat' : ''}
                />
                <p>{counts.likes}</p>
            </button>

            <button
                type="button"
                className={styles.sidebar__button}
                onClick={() => onToggleReaction('save', video.videoId)}
                aria-label={saved ? 'إزالة من المحفوظات' : 'حفظ الفيديو'}
                aria-pressed={saved}
            >
                <MdOutlineBookmark
                    size={40}
                    color={saved ? '#FCD354' : '#FFFFFF'}
                    className={saved ? 'animate__animated animate__heartBeat' : ''}
                />
                <p>{counts.bookmarks}</p>
            </button>

            {onAddToCollection && (
                <button
                    type="button"
                    className={styles.sidebar__button}
                    onClick={() => onAddToCollection(video.videoId)}
                    aria-label="أضف إلى مجموعة"
                >
                    <MdLibraryAdd size={36} />
                </button>
            )}

            <button
                type="button"
                className={styles.sidebar__button}
                onClick={() => downloadVideo(video)}
                aria-label="تنزيل الفيديو"
            >
                <MdFileDownload size={40} />
            </button>

            <button
                type="button"
                className={styles.sidebar__button}
                // The demo has no server to make a public link with.
                onClick={() => (IS_DEMO ? void onShare(video.title) : setIsSharing(true))}
                aria-label="مشاركة الفيديو"
            >
                <RiShareForwardFill size={40} />
            </button>

            {isSharing && (
                <ShareDialog videoId={video.videoId} title={video.title} onClose={() => setIsSharing(false)} />
            )}
        </div>
    )
}

export default Sidebar
