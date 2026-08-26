import { FC, ReactNode, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import Navbar from '../navbar'
import styles from './layout.module.css'

interface ILayoutProps {
    children: ReactNode
}

const Layout: FC<ILayoutProps> = ({ children }) => {
    const { mutate } = useSWRConfig()
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
            const response = await fetch('/api/videos/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'x-file-name': encodeURIComponent(file.name),
                },
                body: file,
            })

            if (!response.ok) {
                const body = await response.json().catch(() => ({}))
                throw new Error(body.error ?? 'Upload failed')
            }

            // Trigger global cache revalidation for all pages listening to the video API
            await mutate('/api/videos')
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Upload failed'
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
