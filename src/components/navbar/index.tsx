import type { FC, JSX, ReactNode } from 'react'
import type { IconType } from 'react-icons'
import { Link, useLocation } from 'react-router'
import { MdHome, MdOutlineHome, MdPerson, MdOutlinePerson } from 'react-icons/md'
import styles from './navbar.module.css'

interface INavbarProps {
    /**
     * Rendered in the centre position. Null in the public build, which has no
     * upload capability at all.
     */
    uploadSlot?: ReactNode
}

interface NavItem {
    to: string
    label: string
    icon: IconType
    activeIcon: IconType
    /** Also active on these path prefixes (e.g. /profile/saved). */
    match: (path: string) => boolean
}

const before: NavItem[] = [
    { to: '/', label: 'الرئيسية', icon: MdOutlineHome, activeIcon: MdHome, match: (p) => p === '/' },
]

const after: NavItem[] = [
    {
        to: '/profile',
        label: 'حسابي',
        icon: MdOutlinePerson,
        activeIcon: MdPerson,
        match: (p) => p === '/profile' || p.startsWith('/profile/'),
    },
]

const Item: FC<{ item: NavItem; active: boolean }> = ({ item, active }) => {
    const Icon = active ? item.activeIcon : item.icon
    return (
        <Link
            to={item.to}
            className={styles.navbar__item}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
        >
            <Icon size={26} className={active ? styles.navbar__icon_active : styles.navbar__icon} />
            <span className={`${styles.navbar__label} ${active ? styles.navbar__label_active : ''}`}>{item.label}</span>
        </Link>
    )
}

const Navbar: FC<INavbarProps> = ({ uploadSlot = null }): JSX.Element => {
    const currentPath = useLocation().pathname

    return (
        <nav className={styles.navbar}>
            <div className={styles.navbar__container}>
                {before.map((item) => (
                    <Item key={item.to} item={item} active={item.match(currentPath)} />
                ))}
                {uploadSlot}
                {after.map((item) => (
                    <Item key={item.to} item={item} active={item.match(currentPath)} />
                ))}
            </div>
        </nav>
    )
}

export default Navbar
