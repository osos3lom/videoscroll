import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import styles from './dialog.module.css'

export interface ConfirmOptions {
    title: string
    message?: ReactNode
    confirmLabel: string
    danger?: boolean
}

export interface PromptOptions {
    title: string
    label: string
    initial: string
    confirmLabel: string
    maxLength?: number
}

export type DialogRequest = (({ kind: 'confirm' } & ConfirmOptions) | ({ kind: 'prompt' } & PromptOptions)) & {
    // null means cancelled; a confirm resolves with ''.
    resolve: (value: string | null) => void
}

/** The modal drawn by `useDialog` (src/hooks/useDialog.tsx). */
export default function DialogView({
    request,
    onClose,
}: {
    request: DialogRequest
    onClose: (value: string | null) => void
}) {
    const [value, setValue] = useState(request.kind === 'prompt' ? request.initial : '')
    const inputRef = useRef<HTMLInputElement>(null)
    const cancelRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (request.kind === 'prompt') {
            inputRef.current?.focus()
            inputRef.current?.select()
        } else {
            // A destructive default should not be one Enter away.
            cancelRef.current?.focus()
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose(null)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [request, onClose])

    const submit = (event: FormEvent) => {
        event.preventDefault()
        if (request.kind === 'prompt' && value.trim() === '') return
        onClose(request.kind === 'prompt' ? value : '')
    }

    return (
        <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && onClose(null)}>
            <form
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="app-dialog-title"
                onSubmit={submit}
            >
                <h2 id="app-dialog-title" className={styles.title}>
                    {request.title}
                </h2>
                {request.kind === 'confirm' && request.message && <p className={styles.message}>{request.message}</p>}
                {request.kind === 'prompt' && (
                    <label className={styles.label}>
                        {request.label}
                        <input
                            ref={inputRef}
                            className={styles.input}
                            value={value}
                            maxLength={request.maxLength}
                            onChange={(event) => setValue(event.target.value)}
                        />
                    </label>
                )}
                <div className={styles.actions}>
                    <button
                        type="submit"
                        className={`${styles.button} ${request.kind === 'confirm' && request.danger ? styles.danger : styles.primary}`}
                        disabled={request.kind === 'prompt' && value.trim() === ''}
                    >
                        {request.confirmLabel}
                    </button>
                    <button ref={cancelRef} type="button" className={styles.button} onClick={() => onClose(null)}>
                        إلغاء
                    </button>
                </div>
            </form>
        </div>
    )
}
