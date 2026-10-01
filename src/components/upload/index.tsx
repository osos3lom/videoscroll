import { type ChangeEvent, type FC, type JSX, useEffect, useRef, useState } from 'react'
import { MdAdd, MdPhotoLibrary, MdVideoLibrary } from 'react-icons/md'
import { ACCEPT, BATCH_LIMIT, PICK_UPLOAD_EVENT, addFiles, resetQueue } from '../../lib/uploadQueue'
import type { MediaKind } from '../../types/api'
import { ActionSheet } from '../sheet'
import UploadQueue from '../uploadQueue'
import styles from './upload.module.css'

/**
 * The navbar's "+" button and everything behind it: a choice of videos or
 * images, the file pickers, and the queue. Rendered only for accounts that
 * can upload; the server enforces the same rule regardless.
 */
const Upload: FC = (): JSX.Element => {
    const inputs = useRef<Record<MediaKind, HTMLInputElement | null>>({ video: null, image: null })
    const [choosing, setChoosing] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)

    // Signing out unmounts the layout: nothing keeps uploading for nobody.
    useEffect(() => () => resetQueue(), [])

    // Other pages (e.g. /images) open a picker through an event, so there is
    // still only one set of inputs and one queue.
    useEffect(() => {
        const onPick = (event: Event) => {
            const kind = (event as CustomEvent<MediaKind>).detail
            if (kind === 'video' || kind === 'image') inputs.current[kind]?.click()
        }
        window.addEventListener(PICK_UPLOAD_EVENT, onPick)
        return () => window.removeEventListener(PICK_UPLOAD_EVENT, onPick)
    }, [])

    const onFiles = (kind: MediaKind) => (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length === 0) return
        setNotice(addFiles(kind, files).notice ?? null)
    }

    return (
        <>
            <button type="button" className={styles.addButton} onClick={() => setChoosing(true)} aria-label="رفع فيديوهات أو صور">
                <div className={styles.addIconWrapper}>
                    <MdAdd size={28} color="#000" />
                </div>
            </button>

            {(['video', 'image'] as MediaKind[]).map((kind) => (
                <input
                    key={kind}
                    type="file"
                    multiple
                    ref={(el) => {
                        inputs.current[kind] = el
                    }}
                    accept={ACCEPT[kind]}
                    aria-label={kind === 'video' ? 'اختيار فيديوهات' : 'اختيار صور'}
                    onChange={onFiles(kind)}
                    style={{ display: 'none' }}
                />
            ))}

            {choosing && (
                <ActionSheet
                    title="ماذا تريد أن ترفع؟"
                    onClose={() => setChoosing(false)}
                    actions={[
                        {
                            label: `فيديوهات (حتى ${BATCH_LIMIT.video} في المرة)`,
                            icon: <MdVideoLibrary size={22} />,
                            onSelect: () => inputs.current.video?.click(),
                        },
                        {
                            label: `صور (حتى ${BATCH_LIMIT.image} في المرة)`,
                            icon: <MdPhotoLibrary size={22} />,
                            onSelect: () => inputs.current.image?.click(),
                        },
                    ]}
                />
            )}

            <UploadQueue notice={notice} onDismissNotice={() => setNotice(null)} />
        </>
    )
}

export default Upload
