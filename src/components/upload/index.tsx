import { type FC, type JSX, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MdAdd, MdClose } from 'react-icons/md'
import { VIDEOS_CHANGED_EVENT } from '../../hooks/useVideos'
import { ApiError } from '../../lib/session'
import { cancelUpload, getUploadStatus, uploadFile } from '../../lib/uploader'
import styles from './upload.module.css'

type Phase =
    | { kind: 'idle' }
    | { kind: 'uploading'; percent: number; resumed: boolean }
    | { kind: 'processing'; fileName: string }
    | { kind: 'done'; message: string }
    | { kind: 'error'; message: string }

const POLL_MS = 4000

/**
 * The navbar's "+" button and everything behind it. Rendered only for
 * accounts that can upload; the server enforces the same rule regardless.
 */
const Upload: FC = (): JSX.Element => {
    const inputRef = useRef<HTMLInputElement | null>(null)
    const controllerRef = useRef<AbortController | null>(null)
    const uploadIdRef = useRef<string | null>(null)
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

    const busy = phase.kind === 'uploading'

    useEffect(() => () => controllerRef.current?.abort(), [])

    // Auto-dismiss finished and failed toasts.
    useEffect(() => {
        if (phase.kind !== 'done' && phase.kind !== 'error') return
        const timer = setTimeout(() => setPhase({ kind: 'idle' }), 6000)
        return () => clearTimeout(timer)
    }, [phase])

    const waitForProcessing = useCallback(async (uploadId: string, fileName: string, signal: AbortSignal) => {
        setPhase({ kind: 'processing', fileName })
        for (;;) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS))
            if (signal.aborted) return
            try {
                const status = await getUploadStatus(uploadId, signal)
                if (status.state === 'ready') {
                    window.dispatchEvent(new Event(VIDEOS_CHANGED_EVENT))
                    setPhase({ kind: 'done', message: `“${fileName}” is live` })
                    return
                }
                if (status.state === 'failed') {
                    setPhase({ kind: 'error', message: status.error ?? 'Processing failed' })
                    return
                }
            } catch (error) {
                if (signal.aborted) return
                if (error instanceof ApiError && error.status === 404) {
                    // The record was swept after completion.
                    window.dispatchEvent(new Event(VIDEOS_CHANGED_EVENT))
                    setPhase({ kind: 'idle' })
                    return
                }
                // Transient: keep polling.
            }
        }
    }, [])

    const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        const controller = new AbortController()
        controllerRef.current = controller
        setPhase({ kind: 'uploading', percent: 0, resumed: false })

        try {
            const status = await uploadFile(
                file,
                ({ sent, total, resumedFrom }) => {
                    setPhase({
                        kind: 'uploading',
                        percent: Math.floor((sent / total) * 100),
                        resumed: resumedFrom > 0,
                    })
                },
                controller.signal
            )
            uploadIdRef.current = status.uploadId

            if (status.state === 'ready') {
                window.dispatchEvent(new Event(VIDEOS_CHANGED_EVENT))
                setPhase({ kind: 'done', message: 'That video is already uploaded' })
                return
            }
            if (status.state === 'failed') {
                setPhase({ kind: 'error', message: status.error ?? 'Processing failed' })
                return
            }
            await waitForProcessing(status.uploadId, file.name, controller.signal)
        } catch (error) {
            if (controller.signal.aborted) return
            const message =
                error instanceof ApiError || error instanceof Error ? error.message : 'Upload failed'
            setPhase({
                kind: 'error',
                message: `${message}. Pick the same file again to resume.`,
            })
        }
    }

    const cancel = () => {
        controllerRef.current?.abort()
        if (uploadIdRef.current && phase.kind === 'uploading') {
            void cancelUpload(uploadIdRef.current)
        }
        uploadIdRef.current = null
        setPhase({ kind: 'idle' })
    }

    return (
        <>
            <button
                type="button"
                className={styles.addButton}
                onClick={() => !busy && inputRef.current?.click()}
                aria-label="Upload video"
                disabled={busy}
            >
                <div className={styles.addIconWrapper}>
                    <MdAdd size={28} color="#000" />
                </div>
            </button>

            <input
                type="file"
                ref={inputRef}
                accept="video/*"
                onChange={handleFile}
                style={{ display: 'none' }}
            />

            {/*
             * Portaled to <body>: the navbar has a transform and a
             * backdrop-filter, either of which traps position: fixed children.
             */}
            {phase.kind !== 'idle' &&
                createPortal(
                    <div
                        className={`${styles.toast} ${phase.kind === 'error' ? styles.toast_error : ''}`}
                        role="status"
                    >
                        {(phase.kind === 'uploading' || phase.kind === 'processing') && (
                            <div className={styles.toast__spinner} />
                        )}
                        <span>
                            {phase.kind === 'uploading' &&
                                `${phase.resumed ? 'Resuming' : 'Uploading'}… ${phase.percent}%`}
                            {phase.kind === 'processing' && 'Processing on the server…'}
                            {(phase.kind === 'done' || phase.kind === 'error') && phase.message}
                        </span>
                        {phase.kind === 'uploading' && (
                            <>
                                <button
                                    type="button"
                                    className={styles.toast__cancel}
                                    onClick={cancel}
                                    aria-label="Cancel upload"
                                >
                                    <MdClose size={16} />
                                </button>
                                <div className={styles.toast__progressbar}>
                                    <div
                                        className={styles.toast__progressbarFill}
                                        style={{ width: `${phase.percent}%` }}
                                    />
                                </div>
                            </>
                        )}
                    </div>,
                    document.body
                )}
        </>
    )
}

export default Upload
