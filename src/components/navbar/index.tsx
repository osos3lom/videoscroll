import type { FC, JSX, ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import {
    MdHome,
    MdOutlineHome,
    MdFavorite,
    MdFavoriteBorder,
    MdBookmark,
    MdBookmarkBorder,
    MdPerson,
    MdOutlinePerson,
} from 'react-icons/md'
import styles from './navbar.module.css'

interface INavbarProps {
    /**
     * Rendered in the centre position. Null in the public build, which has no
     * upload capability at all.
     */
    uploadSlot?: ReactNode
}

const Navbar: FC<INavbarProps> = ({ uploadSlot = null }): JSX.Element => {
    const currentPath = useLocation().pathname

    const isFeedActive = currentPath === '/'
    const isLikesActive = currentPath === '/likes'
    const isSavedActive = currentPath === '/saved'
    const isProfileActive = currentPath === '/profile'

    return (
        <nav className={styles.navbar}>
            <div className={styles.navbar__container}>
                {/* Feed Tab */}
                <Link to="/" className={styles.navbar__item} aria-label="Feed">
                    {isFeedActive ? (
                        <MdHome size={28} className={styles.navbar__icon_active} />
                    ) : (
                        <MdOutlineHome size={28} className={styles.navbar__icon} />
                    )}
                    <span className={`${styles.navbar__label} ${isFeedActive ? styles.navbar__label_active : ''}`}>
                        Feed
                    </span>
                </Link>

                {/* Likes Tab */}
                <Link to="/likes" className={styles.navbar__item} aria-label="Likes">
                    {isLikesActive ? (
                        <MdFavorite size={26} className={styles.navbar__icon_active} />
                    ) : (
                        <MdFavoriteBorder size={26} className={styles.navbar__icon} />
                    )}
                    <span className={`${styles.navbar__label} ${isLikesActive ? styles.navbar__label_active : ''}`}>
                        Likes
                    </span>
                </Link>

                {uploadSlot}

                {/* Saved Tab */}
                <Link to="/saved" className={styles.navbar__item} aria-label="Saved">
                    {isSavedActive ? (
                        <MdBookmark size={26} className={styles.navbar__icon_active} />
                    ) : (
                        <MdBookmarkBorder size={26} className={styles.navbar__icon} />
                    )}
                    <span className={`${styles.navbar__label} ${isSavedActive ? styles.navbar__label_active : ''}`}>
                        Saved
                    </span>
                </Link>

                {/* Profile Tab */}
                <Link to="/profile" className={styles.navbar__item} aria-label="Profile">
                    {isProfileActive ? (
                        <MdPerson size={26} className={styles.navbar__icon_active} />
                    ) : (
                        <MdOutlinePerson size={26} className={styles.navbar__icon} />
                    )}
                    <span className={`${styles.navbar__label} ${isProfileActive ? styles.navbar__label_active : ''}`}>
                        Profile
                    </span>
                </Link>
            </div>
        </nav>
    )
}

export default Navbar
