import { useState } from 'react'
import { useDialog } from '../../hooks/useDialog'
import { collectionApi } from '../../hooks/useCollections'
import { collectionLink } from '../../lib/apiUrl'
import type { Collection } from '../../types/api'
import { copyText, shareUrl } from '../../utils/share'
import dialogStyles from '../dialog/dialog.module.css'
import shareStyles from '../shareDialog/shareDialog.module.css'
import Sheet from '../sheet'
import styles from './collectionShare.module.css'

interface Props {
    collection: Collection
    onClose: () => void
}

/**
 * Sharing a collection. A private collection has no link at all; making it
 * public creates one. Making it private again, or creating a new link,
 * stops every link handed out before.
 */
export default function CollectionShare({ collection: initial, onClose }: Props) {
    const [collection, setCollection] = useState(initial)
    const [busy, setBusy] = useState(false)
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
    const dialog = useDialog()

    const link = collection.visibility === 'public' && collection.shareCode ? collectionLink(collection.shareCode) : null

    const run = async (action: () => Promise<Collection>) => {
        if (busy) return
        setBusy(true)
        setNote(null)
        try {
            setCollection(await action())
        } catch (caught) {
            setNote({ ok: false, text: caught instanceof Error ? caught.message : 'تعذر الحفظ' })
        } finally {
            setBusy(false)
        }
    }

    const report = (result: Awaited<ReturnType<typeof copyText>>) => {
        if (result === 'copied') setNote({ ok: true, text: 'تم نسخ الرابط.' })
        if (result === 'failed') setNote({ ok: false, text: 'تعذر المشاركة. انسخ الرابط يدوياً.' })
    }

    const stop = async () => {
        const confirmed = await dialog.confirm({
            title: 'إيقاف المشاركة؟',
            message: 'ستصبح المجموعة خاصة، ولن يعمل الرابط الحالي بعد الآن.',
            confirmLabel: 'إيقاف',
            danger: true,
        })
        if (confirmed) void run(() => collectionApi.update(collection.id, { visibility: 'private' }))
    }

    const renew = async () => {
        const confirmed = await dialog.confirm({
            title: 'إنشاء رابط جديد؟',
            message: 'سيتوقف الرابط الحالي عن العمل لكل من أرسلته إليه.',
            confirmLabel: 'رابط جديد',
            danger: true,
        })
        if (confirmed) void run(() => collectionApi.resetShare(collection.id))
    }

    return (
        <Sheet title={`مشاركة «${collection.title}»`} onClose={onClose}>
            {dialog.element}
            {!link ? (
                <div className={styles.panel}>
                    <p className={dialogStyles.message}>
                        هذه المجموعة خاصة ولا يراها غيرك. اجعلها عامة لتحصل على رابط يفتحها أي شخص، حتى دون حساب.
                    </p>
                    <div className={dialogStyles.actions}>
                        <button
                            type="button"
                            className={`${dialogStyles.button} ${dialogStyles.primary}`}
                            disabled={busy}
                            onClick={() => void run(() => collectionApi.update(collection.id, { visibility: 'public' }))}
                        >
                            {busy ? 'جارٍ الإنشاء…' : 'اجعلها عامة وأنشئ الرابط'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className={styles.panel}>
                    <p className={dialogStyles.message}>
                        أي شخص لديه هذا الرابط يمكنه تصفح المجموعة ({collection.itemCount} عنصر) دون حساب.
                    </p>
                    <input
                        className={`${dialogStyles.input} ${shareStyles.link}`}
                        value={link}
                        readOnly
                        dir="ltr"
                        aria-label="رابط المجموعة"
                        onFocus={(event) => event.currentTarget.select()}
                    />
                    <div className={dialogStyles.actions}>
                        <button
                            type="button"
                            className={`${dialogStyles.button} ${dialogStyles.primary}`}
                            onClick={() => void shareUrl(collection.title, link).then(report)}
                        >
                            مشاركة
                        </button>
                        <button type="button" className={dialogStyles.button} onClick={() => void copyText(link).then(report)}>
                            نسخ
                        </button>
                    </div>
                    <div className={dialogStyles.actions}>
                        <button type="button" className={dialogStyles.button} disabled={busy} onClick={renew}>
                            رابط جديد
                        </button>
                        <button
                            type="button"
                            className={`${dialogStyles.button} ${dialogStyles.danger}`}
                            disabled={busy}
                            onClick={stop}
                        >
                            إيقاف المشاركة
                        </button>
                    </div>
                </div>
            )}
            {note && (
                <p className={note.ok ? shareStyles.ok : shareStyles.error} role="status">
                    {note.text}
                </p>
            )}
        </Sheet>
    )
}
