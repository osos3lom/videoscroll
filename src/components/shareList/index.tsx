import { useState } from 'react'
import useSWR from 'swr'
import { useDialog } from '../../hooks/useDialog'
import { apiFetch } from '../../lib/session'
import { SHARES_KEY, expiryText } from '../../lib/shares'
import type { ShareView } from '../../types/api'
import styles from './shareList.module.css'

interface Props {
    /** The owner's list covers everyone's links, so say who made each. */
    showCreator?: boolean
}

/**
 * Live public links, each with a stop button. The server returns the
 * caller's own links, or every link for the owner. Links cannot be shown
 * again: only a hash of each code is kept.
 */
export default function ShareList({ showCreator = false }: Props) {
    const { data, error, mutate } = useSWR<{ shares: ShareView[] }>(SHARES_KEY, (path: string) =>
        apiFetch<{ shares: ShareView[] }>(path)
    )
    const dialog = useDialog()
    const [failure, setFailure] = useState<string | null>(null)

    const stop = async (share: ShareView) => {
        const confirmed = await dialog.confirm({
            title: 'إيقاف الرابط؟',
            message: `لن يتمكن أحد بعد الآن من فتح «${share.title}» بهذا الرابط.`,
            confirmLabel: 'إيقاف',
            danger: true,
        })
        if (!confirmed) return
        setFailure(null)
        try {
            await apiFetch(`/api/shares/${encodeURIComponent(share.id)}`, { method: 'DELETE' })
            await mutate()
        } catch (caught) {
            setFailure(caught instanceof Error ? caught.message : 'تعذر إيقاف الرابط')
        }
    }

    const shares = data?.shares ?? []

    return (
        <div className={styles.shareList}>
            {dialog.element}
            {error && <p className={styles.error}>{error instanceof Error ? error.message : 'تعذر تحميل الروابط'}</p>}
            {failure && <p className={styles.error}>{failure}</p>}
            {data && shares.length === 0 && <p className={styles.empty}>لا توجد روابط مشاركة فعّالة.</p>}
            {shares.length > 0 && (
                <ul className={styles.items}>
                    {shares.map((share) => (
                        <li key={share.id} className={styles.item}>
                            <div className={styles.text}>
                                <strong className={styles.title}>{share.title}</strong>
                                <span className={styles.meta}>
                                    {showCreator && share.createdByName ? `${share.createdByName} · ` : ''}
                                    {expiryText(share.expiresAt)}
                                </span>
                            </div>
                            <button
                                type="button"
                                className={styles.stop}
                                onClick={() => void stop(share)}
                                aria-label={`إيقاف رابط ${share.title}`}
                            >
                                إيقاف
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
