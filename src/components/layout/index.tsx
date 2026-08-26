import { FC, ReactNode, useRef, useState } from 'react'
import { addLocalVideo } from '../../lib/videoStore'
import Navbar from '../navbar'
import styles from './layout.module.css'

interface ILayoutProps {
    children: ReactNode
}

const Layout: FC<ILayoutProps> = ({ children }) => {
    const inputFileRef = useRef<HTMLInputElement | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleUploadClick = () => {
        if (isUploading) return
        setError(null)
        inputFileRef.current?.click()
    }

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        setIsUploading(true)
        setError(null)

        try {
            // Stored in IndexedDB, not uploaded anywhere — this app is a static
            // export with no server, so the video feed listens for this write
            // via the LOCAL_VIDEO_UPDATE_EVENT dispatched by addLocalVideo.
            await addLocalVideo(file)
        } catch (caught) {
            const isQuotaError = caught instanceof DOMException && caught.name === 'QuotaExceededError'
            const message = isQuotaError
                ? 'Not enough storage space left in this browser for that video'
                : caught instanceof Error
                  ? caught.message
                  : 'Upload failed'
            setError(message)
            // Auto clear error toast after 4 seconds
            setTimeout(() => {
                setError(null)
            }, 4000)
            console.error('[global upload]', caught)
        } finally {
            setIsUploading(false)
            if (inputFileRef.current) {
                inputFileRef.current.value = ''
            }
        }
    }

    return (
        <div className={styles.layout}>
            {/* Page content */}
            <div className={styles.layout__content}>{children}</div>

            {/* Hidden Input for Global Upload */}
            <input
                type="file"
                id="global-upload"
                ref={inputFileRef}
                name="global-upload"
                accept="video/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
            />

            {/* Global upload state banners */}
            {isUploading && (
                <div className={styles.toast}>
                    <div className={styles.toast__spinner} />
                    <span>Uploading your video...</span>
                    <div className={styles.toast__progressbar}>
                        <div className={styles.toast__progressbarFill} />
                    </div>
                </div>
            )}

            {error && (
                <div className={`${styles.toast} ${styles.toast_error}`}>
                    <span>{error}</span>
                </div>
            )}

            {/* Shared bottom navbar */}
            <Navbar onUploadClick={handleUploadClick} />
        </div>
    )
}

export default Layout
