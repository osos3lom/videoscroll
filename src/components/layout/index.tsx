import type { FC, ReactNode } from 'react'
import { useSession } from '../../hooks/useSession'
import Navbar from '../navbar'
import Upload from '../upload'
import styles from './layout.module.css'

interface ILayoutProps {
    children: ReactNode
}

const Layout: FC<ILayoutProps> = ({ children }) => {
    const role = useSession()?.user.role
    const canUpload = role === 'owner' || role === 'uploader'

    return (
        <div className={styles.layout}>
            <div className={styles.layout__content}>{children}</div>

            {/* The server enforces the same rule; this only hides a button that would 403. */}
            <Navbar uploadSlot={canUpload ? <Upload /> : null} />
        </div>
    )
}

export default Layout
