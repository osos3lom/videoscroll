import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react'
import {
    MdAdd,
    MdArrowDownward,
    MdArrowUpward,
    MdDragIndicator,
    MdLock,
    MdPublic,
    MdRemoveCircleOutline,
    MdStar,
    MdStarBorder,
} from 'react-icons/md'
import { collectionApi } from '../../hooks/useCollections'
import { type MediaEntry, useMediaLookup } from '../../hooks/useMedia'
import { useReactions } from '../../hooks/useReactions'
import { useSession } from '../../hooks/useSession'
import type { Collection, CollectionSection, Visibility } from '../../types/api'
import dialogStyles from '../dialog/dialog.module.css'
import MediaPicker from '../mediaPicker'
import Sheet from '../sheet'
import styles from './collectionEditor.module.css'

interface Props {
    section: CollectionSection
    /** Absent: a new collection. */
    collection?: Collection
    /** Media to start a new collection with. */
    initialMediaIds?: string[]
    onClose: () => void
    onSaved?: (collection: Collection) => void
}

const LABELS: Record<CollectionSection, { new: string; edit: string; noun: string }> = {
    collections: { new: 'مجموعة جديدة', edit: 'تعديل المجموعة', noun: 'المجموعة' },
    images: { new: 'تصنيف صور جديد', edit: 'تعديل التصنيف', noun: 'التصنيف' },
}

/**
 * Creating and editing a collection: name, description, visibility, cover,
 * and which media it holds, in what order. Nothing here can delete media:
 * removing an item only takes it out of the collection.
 */
export default function CollectionEditor({ section, collection, initialMediaIds = [], onClose, onSaved }: Props) {
    const labels = LABELS[section]
    const { byId } = useMediaLookup()
    const session = useSession()
    const reactions = useReactions()

    const [title, setTitle] = useState(collection?.title ?? '')
    const [description, setDescription] = useState(collection?.description ?? '')
    const [visibility, setVisibility] = useState<Visibility>(collection?.visibility ?? 'private')
    // Items are keyed by media id, which is unique within a collection.
    const [mediaIds, setMediaIds] = useState<string[]>(
        () => collection?.items?.map((item) => item.mediaId) ?? initialMediaIds
    )
    const coverMediaId = collection?.items?.find((item) => item.id === collection.coverItemId)?.mediaId
    const [cover, setCover] = useState<string | undefined>(coverMediaId)
    const [picking, setPicking] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const entries = useMemo(
        () => mediaIds.map((id) => byId.get(id)).filter((entry): entry is MediaEntry => Boolean(entry)),
        [mediaIds, byId]
    )

    const move = (from: number, to: number) => {
        if (to < 0 || to >= mediaIds.length || from === to) return
        setMediaIds((ids) => {
            const next = [...ids]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            return next
        })
    }

    // Drag to reorder: the handle captures the pointer, and every row height
    // the pointer travels moves the item one place.
    const drag = useRef<{ id: string; startY: number; startIndex: number; rowHeight: number } | null>(null)
    const onHandleDown = (event: ReactPointerEvent<HTMLElement>, id: string, index: number) => {
        const row = event.currentTarget.closest('li')
        drag.current = { id, startY: event.clientY, startIndex: index, rowHeight: row?.getBoundingClientRect().height || 64 }
        event.currentTarget.setPointerCapture(event.pointerId)
    }
    const onHandleMove = (event: ReactPointerEvent<HTMLElement>) => {
        const d = drag.current
        if (!d) return
        const target = Math.max(0, Math.min(mediaIds.length - 1, d.startIndex + Math.round((event.clientY - d.startY) / d.rowHeight)))
        const current = mediaIds.indexOf(d.id)
        if (current !== target) move(current, target)
    }
    const onHandleUp = () => {
        drag.current = null
    }

    const save = async () => {
        if (busy) return
        if (!title.trim()) {
            setError('اكتب اسماً.')
            return
        }
        setBusy(true)
        setError(null)
        try {
            let saved: Collection
            if (!collection) {
                saved = await collectionApi.create(section, { title, description, visibility }, mediaIds)
            } else {
                saved = await collectionApi.update(collection.id, { title, description, visibility })
                const keep = new Set(mediaIds)
                for (const item of collection.items ?? []) {
                    if (!keep.has(item.mediaId)) saved = await collectionApi.removeItem(collection.id, item.id)
                }
                const present = new Set((saved.items ?? []).map((item) => item.mediaId))
                const added = mediaIds.filter((id) => !present.has(id))
                if (added.length > 0) saved = await collectionApi.addItems(collection.id, added)
                const itemByMedia = new Map((saved.items ?? []).map((item) => [item.mediaId, item.id]))
                const order = mediaIds.flatMap((id) => itemByMedia.get(id) ?? [])
                const currentOrder = (saved.items ?? []).map((item) => item.id)
                if (order.join() !== currentOrder.join()) saved = await collectionApi.reorder(collection.id, order)
            }
            const coverItemId = cover ? saved.items?.find((item) => item.mediaId === cover)?.id ?? '' : ''
            if (coverItemId !== (saved.coverItemId ?? '')) {
                saved = await collectionApi.update(saved.id, { coverItemId })
            }
            onSaved?.(saved)
            onClose()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'تعذر الحفظ')
        } finally {
            setBusy(false)
        }
    }

    if (picking) {
        return (
            <MediaPicker
                section={section}
                exclude={new Set(mediaIds)}
                userId={session?.user.id}
                savedIds={reactions.savedIds}
                likedIds={reactions.likedIds}
                onCancel={() => setPicking(false)}
                onPick={(ids) => {
                    setMediaIds((current) => [...current, ...ids.filter((id) => !current.includes(id))])
                    setPicking(false)
                }}
            />
        )
    }

    return (
        <Sheet
            title={collection ? labels.edit : labels.new}
            onClose={onClose}
            tall
            footer={
                <>
                    <button
                        type="button"
                        className={`${dialogStyles.button} ${dialogStyles.primary}`}
                        onClick={save}
                        disabled={busy}
                    >
                        {busy ? 'جارٍ الحفظ…' : 'حفظ'}
                    </button>
                    <button type="button" className={dialogStyles.button} onClick={onClose}>
                        إلغاء
                    </button>
                </>
            }
        >
            <div className={styles.form}>
                <label className={dialogStyles.label}>
                    الاسم
                    <input
                        className={dialogStyles.input}
                        value={title}
                        maxLength={80}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder={section === 'images' ? 'مثلاً: رحلة العلا' : 'مثلاً: مقاطع العائلة'}
                        autoFocus={!collection}
                        required
                    />
                </label>

                <label className={dialogStyles.label}>
                    الوصف (اختياري)
                    <textarea
                        className={`${dialogStyles.input} ${styles.textarea}`}
                        value={description}
                        maxLength={500}
                        rows={2}
                        onChange={(event) => setDescription(event.target.value)}
                    />
                </label>

                <fieldset className={styles.visibility}>
                    <legend className={styles.legend}>من يمكنه رؤيتها؟</legend>
                    <button
                        type="button"
                        className={`${styles.option} ${visibility === 'private' ? styles.option_on : ''}`}
                        aria-pressed={visibility === 'private'}
                        onClick={() => setVisibility('private')}
                    >
                        <MdLock size={20} />
                        <span>
                            <strong>خاصة</strong>
                            <small>أنت فقط</small>
                        </span>
                    </button>
                    <button
                        type="button"
                        className={`${styles.option} ${visibility === 'public' ? styles.option_on : ''}`}
                        aria-pressed={visibility === 'public'}
                        onClick={() => setVisibility('public')}
                    >
                        <MdPublic size={20} />
                        <span>
                            <strong>عامة</strong>
                            <small>أي شخص لديه الرابط</small>
                        </span>
                    </button>
                </fieldset>

                <div className={styles.itemsHeader}>
                    <h3 className={styles.legend}>العناصر ({entries.length})</h3>
                    <button type="button" className={styles.add} onClick={() => setPicking(true)}>
                        <MdAdd size={20} />
                        إضافة
                    </button>
                </div>

                {entries.length === 0 ? (
                    <p className={styles.hint}>
                        {section === 'images'
                            ? 'أضف صوراً من صورك المرفوعة. حذف التصنيف لاحقاً لا يحذف الصور.'
                            : 'أضف فيديوهات أو صوراً موجودة. حذف المجموعة لاحقاً لا يحذف ما بداخلها.'}
                    </p>
                ) : (
                    <ol className={styles.items}>
                        {entries.map((entry, index) => {
                            const isCover = cover ? cover === entry.id : index === 0
                            return (
                                <li key={entry.id} className={styles.item}>
                                    <span
                                        className={styles.handle}
                                        onPointerDown={(event) => onHandleDown(event, entry.id, index)}
                                        onPointerMove={onHandleMove}
                                        onPointerUp={onHandleUp}
                                        onPointerCancel={onHandleUp}
                                        aria-hidden="true"
                                    >
                                        <MdDragIndicator size={22} />
                                    </span>
                                    {entry.poster ? (
                                        <img className={styles.thumb} src={entry.poster} alt="" loading="lazy" />
                                    ) : (
                                        <span className={styles.thumb} />
                                    )}
                                    <span className={styles.itemTitle}>
                                        <span>{entry.title}</span>
                                        <small>{entry.kind === 'video' ? 'فيديو' : 'صورة'}</small>
                                    </span>
                                    <button
                                        type="button"
                                        className={styles.icon}
                                        aria-label={isCover ? 'الغلاف الحالي' : `اجعل «${entry.title}» الغلاف`}
                                        aria-pressed={isCover}
                                        onClick={() => setCover(entry.id)}
                                    >
                                        {isCover ? <MdStar size={20} color="#FCD354" /> : <MdStarBorder size={20} />}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.icon}
                                        aria-label={`تحريك «${entry.title}» للأعلى`}
                                        disabled={index === 0}
                                        onClick={() => move(index, index - 1)}
                                    >
                                        <MdArrowUpward size={18} />
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.icon}
                                        aria-label={`تحريك «${entry.title}» للأسفل`}
                                        disabled={index === entries.length - 1}
                                        onClick={() => move(index, index + 1)}
                                    >
                                        <MdArrowDownward size={18} />
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.icon} ${styles.remove}`}
                                        aria-label={`إزالة «${entry.title}» من ${labels.noun}`}
                                        onClick={() => {
                                            setMediaIds((ids) => ids.filter((id) => id !== entry.id))
                                            if (cover === entry.id) setCover(undefined)
                                        }}
                                    >
                                        <MdRemoveCircleOutline size={20} />
                                    </button>
                                </li>
                            )
                        })}
                    </ol>
                )}

                {error && (
                    <p className={styles.error} role="alert">
                        {error}
                    </p>
                )}
            </div>
        </Sheet>
    )
}
