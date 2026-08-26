import { MdFavorite, MdOutlineBookmark } from 'react-icons/md'
import { RiShareForwardFill } from 'react-icons/ri'
import styles from './sidebar.module.css'
import { FC, JSX } from 'react'
import { onShare } from '../../utils/share'
import { getSocialResults } from '../../utils/socialResults'
import type { LocalVideo, VideoSocial } from '../../types/video'
import 'animate.css'

export interface ISidebarProps {
    video: LocalVideo
    social?: VideoSocial
    onSocialChange: (videoId: string, social: VideoSocial) => void
}

const Sidebar: FC<ISidebarProps> = ({ video, social, onSocialChange }): JSX.Element => {
    const likes = getSocialResults(social, 'likes')
    const bookmarks = getSocialResults(social, 'bookmarks')

    const hasLiked = likes > 0
    const hasBookmarked = bookmarks > 0

    const handleLike = () => {
        const nextLikes = hasLiked ? Math.max(0, likes - 1) : likes + 1
        onSocialChange(video.videoId, { likes: nextLikes, bookmarks })
    }

    const handleBookmark = () => {
        const nextBookmarks = hasBookmarked ? Math.max(0, bookmarks - 1) : bookmarks + 1
        onSocialChange(video.videoId, { likes, bookmarks: nextBookmarks })
    }

    return (
        <div className={styles.sidebar}>
            <button
                type="button"
                className={styles.sidebar__button}
                onClick={handleLike}
                aria-label={hasLiked ? 'Unlike video' : 'Like video'}
            >
                <MdFavorite
                    size={40}
                    color={hasLiked ? '#D65076' : '#fff'}
                    className={hasLiked ? 'animate__animated animate__heartBeat' : ''}
                />
                <p>{likes}</p>
            </button>

            <button
                type="button"
                className={styles.sidebar__button}
                onClick={handleBookmark}
                aria-label={hasBookmarked ? 'Remove bookmark' : 'Bookmark video'}
            >
                <MdOutlineBookmark
                    size={40}
                    color={hasBookmarked ? '#FCD354' : '#FFFFFF'}
                    className={hasBookmarked ? 'animate__animated animate__heartBeat' : ''}
                />
                <p>{bookmarks}</p>
            </button>

            <button
                type="button"
                className={styles.sidebar__button}
                onClick={() => onShare(video.title)}
                aria-label="Share video"
            >
                <RiShareForwardFill size={40} />
            </button>
        </div>
    )
}

export default Sidebar
