import { type FormEvent, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { mutate } from 'swr'
import { shareLink } from '../../lib/apiUrl'
import { apiFetch } from '../../lib/session'
import { SHARES_KEY } from '../../lib/shares'
import type { ShareDays, ShareView } from '../../types/api'
import { copyText, shareUrl } from '../../utils/share'
import dialogStyles from '../dialog/dialog.module.css'
import styles from './shareDialog.module.css'

const DURATIONS: { days: ShareDays; label: string }[] = [
    { days: 1, label: 'يوم' },
    { days: 7, label: '7 أيام' },
    { days: 30, label: '30 يوماً' },
    { days: 0, label: 'حتى أوقفه' },
]

interface Props {
    videoId: string
    title: string
    onClose: () => void
}

/**
 * Creating a public link for one video, in two taps: choose how long it
 * works, then share it. The share sheet gets its own tap because Safari only
 * opens it straight from a gesture, and creating the link is a network call.
 */
export default function ShareDialog({ videoId, title, onClose }: Props) {
    const [days, setDays] = useState<ShareDays>(7)
    const [link, setLink] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    const create = async (event: FormEvent) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        setNote(null)
        try {
            const result = await apiFetch<{ code: string; share: ShareView }>('/api/shares', {
                method: 'POST',
                json: { videoId, expiresInDays: days },
            })
            setLink(shareLink(result.code))
            void mutate(SHARES_KEY)
        } catch (caught) {
            setNote({ ok: false, text: caught instanceof Error ? caught.message : 'تعذر إنشاء الرابط' })
        } finally {
            setBusy(false)
        }
    }

    const report = (result: Awaited<ReturnType<typeof copyText>>) => {
        if (result === 'copied') setNote({ ok: true, text: 'تم نسخ الرابط.' })
        if (result === 'failed') setNote({ ok: false, text: 'تعذر المشاركة. انسخ الرابط يدوياً.' })
    }

    return createPortal(
        <div className={dialogStyles.backdrop} onClick={(event) => event.target === event.currentTarget && onClose()}>
            <form
                className={dialogStyles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-dialog-title"
                onSubmit={create}
            >
                <h2 id="share-dialog-title" className={dialogStyles.title}>
                    مشاركة الفيديو
                </h2>
                <p className={dialogStyles.message}>أي شخص لديه الرابط يمكنه مشاهدة «{title}» وتنزيله، حتى دون حساب.</p>

                {!link ? (
                    <>
                        <p id="share-days-label" className={styles.legend}>
                            مدة صلاحية الرابط
                        </p>
                        <div className={styles.durations} role="radiogroup" aria-labelledby="share-days-label">
                            {DURATIONS.map((option) => (
                                <label
                                    key={option.days}
                                    className={`${styles.duration} ${days === option.days ? styles.selected : ''}`}
                                >
                                    <input
                                        type="radio"
                                        name="share-days"
                                        value={option.days}
                                        checked={days === option.days}
                                        onChange={() => setDays(option.days)}
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                        <div className={dialogStyles.actions}>
                            <button
                                type="submit"
                                className={`${dialogStyles.button} ${dialogStyles.primary}`}
                                disabled={busy}
                            >
                                {busy ? 'جارٍ الإنشاء…' : 'إنشاء الرابط'}
                            </button>
                            <button type="button" className={dialogStyles.button} onClick={onClose}>
                                إلغاء
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <input
                            className={`${dialogStyles.input} ${styles.link}`}
                            value={link}
                            readOnly
                            dir="ltr"
                            aria-label="رابط المشاركة"
                            onFocus={(event) => event.currentTarget.select()}
                        />
                        <div className={dialogStyles.actions}>
                            <button
                                type="button"
                                className={`${dialogStyles.button} ${dialogStyles.primary}`}
                                onClick={() => void shareUrl(title, link).then(report)}
                            >
                                مشاركة
                            </button>
                            <button
                                type="button"
                                className={dialogStyles.button}
                                onClick={() => void copyText(link).then(report)}
                            >
                                نسخ
                            </button>
                        </div>
                        <button type="button" className={styles.done} onClick={onClose}>
                            تم
                        </button>
                    </>
                )}

                {note && (
                    <p className={note.ok ? styles.ok : styles.error} role="status">
                        {note.text}
                    </p>
                )}
            </form>
        </div>,
        document.body
    )
}
