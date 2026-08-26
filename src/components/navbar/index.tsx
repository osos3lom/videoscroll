import { FC, JSX } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
    MdHome,
    MdOutlineHome,
    MdFavorite,
    MdFavoriteBorder,
    MdBookmark,
    MdBookmarkBorder,
    MdPerson,
    MdOutlinePerson,
    MdAdd,
} from 'react-icons/md'
import styles from './navbar.module.css'

interface INavbarProps {
    onUploadClick: () => void
}

const Navbar: FC<INavbarProps> = ({ onUploadClick }): JSX.Element => {
    const router = useRouter()
    const currentPath = router.pathname

    const isFeedActive = currentPath === '/'
    const isLikesActive = currentPath === '/likes'
    const isSavedActive = currentPath === '/saved'
    const isProfileActive = currentPath === '/profile'

    return (
        <nav className={styles.navbar}>
            <div className={styles.navbar__container}>
                {/* Feed Tab */}
                <Link href="/" className={styles.navbar__item} aria-label="Feed">
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
                <Link href="/likes" className={styles.navbar__item} aria-label="Likes">
                    {isLikesActive ? (
                        <MdFavorite size={26} className={styles.navbar__icon_active} />
                    ) : (
                        <MdFavoriteBorder size={26} className={styles.navbar__icon} />
                    )}
                    <span className={`${styles.navbar__label} ${isLikesActive ? styles.navbar__label_active : ''}`}>
                        Likes
                    </span>
                </Link>

                {/* Add/Upload Button */}
                <button
                    type="button"
                    className={styles.navbar__addButton}
                    onClick={onUploadClick}
                    aria-label="Upload Video"
                >
                    <div className={styles.navbar__addIconWrapper}>
                        <MdAdd size={28} color="#000" />
                    </div>
                </button>

                {/* Saved Tab */}
                <Link href="/saved" className={styles.navbar__item} aria-label="Saved">
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
                <Link href="/profile" className={styles.navbar__item} aria-label="Profile">
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
