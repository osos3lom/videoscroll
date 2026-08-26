import React, { FC, JSX, useRef, useState } from 'react'
import { RiAddFill } from 'react-icons/ri'
import type { LocalVideo } from '../../types/video'
import styles from './upload.module.css'

interface IUploadProps {
    onVideoAdded: (video: LocalVideo) => void
}

/** Loads picked video files directly in the browser. */
const Upload: FC<IUploadProps> = ({ onVideoAdded }): JSX.Element => {
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const inputFile = useRef<HTMLInputElement | null>(null)

    const openFilePicker = () => {
        if (isUploading) return
        setError(null)
        inputFile.current?.click()
    }

    const fileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        setIsUploading(true)
        setError(null)

        try {
            const objectUrl = URL.createObjectURL(file)
            const videoId = `v-local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            const newVideo: LocalVideo = {
                videoId,
                fileName: file.name,
                title: file.name.replace(/\.[^/.]+$/, ''),
                src: objectUrl,
                size: file.size,
            }
            onVideoAdded(newVideo)
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Failed to load video'
            setError(message)
            console.error('[upload]', caught)
        } finally {
            setIsUploading(false)
            // Allow re-picking the same file.
            event.target.value = ''
        }
    }

    return (
        <div className={styles.upload} onClick={openFilePicker}>
            {isUploading && <p className={styles.upload__label}>Adding...</p>}
            {error && <p className={styles.upload__label}>{error}</p>}

            {!isUploading && !error && (
                <div className={styles.addIcon__wrapper}>
                    <RiAddFill size={20} color={'#111111'} />
                </div>
            )}

            <input
                type="file"
                id="upload"
                ref={inputFile}
                name="upload"
                accept="video/*"
                onChange={fileInputChange}
                style={{ display: 'none' }}
            />
        </div>
    )
}

export default Upload
