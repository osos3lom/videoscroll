import { useState } from 'react'
import { MdAdd, MdCheckBox, MdCheckBoxOutlineBlank, MdPhotoLibrary } from 'react-icons/md'
import { collectionApi, useCollections } from '../../hooks/useCollections'
import { imageThumbUrl, posterUrl } from '../../lib/apiUrl'
import type { Collection, CollectionSection, MediaKind } from '../../types/api'
import CollectionEditor from '../collectionEditor'
import Sheet from '../sheet'
import styles from './addToCollection.module.css'

interface Props {
    mediaId: string
    kind: MediaKind
    onClose: () => void
}

/**
 * Putting one video or image into collections, or taking it out. A video
 * goes into collections; an image into collections or image categories.
 */
export default function AddToCollection({ mediaId, kind, onClose }: Props) {
    const collections = useCollections('collections')
    const categories = useCollections('images')
    const [creating, setCreating] = useState<CollectionSection | null>(null)
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    if (creating) {
        return (
            <CollectionEditor
                section={creating}
                initialMediaIds={[mediaId]}
                onClose={() => setCreating(null)}
            />
        )
    }

    const toggle = async (c: Collection) => {
        if (busy) return
        setBusy(c.id)
        setError(null)
        try {
            const item = c.items?.find((it) => it.mediaId === mediaId)
            if (item) await collectionApi.removeItem(c.id, item.id)
            else await collectionApi.addItems(c.id, [mediaId])
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'تعذر الحفظ')
        } finally {
            setBusy(null)
        }
    }

    const groups: { section: CollectionSection; title: string; data: typeof collections }[] = [
        { section: 'collections', title: 'المجموعات', data: collections },
    ]
    if (kind === 'image') groups.push({ section: 'images', title: 'تصنيفات الصور', data: categories })

    return (
        <Sheet title="أضف إلى مجموعة" onClose={onClose}>
            {groups.map(({ section, title, data }) => (
                <section key={section} className={styles.group}>
                    {groups.length > 1 && <h3 className={styles.groupTitle}>{title}</h3>}
                    <ul className={styles.list}>
                        {data.collections.map((c) => {
                            const inside = Boolean(c.items?.some((it) => it.mediaId === mediaId))
                            const cover =
                                c.cover && data.mediaToken
                                    ? c.cover.kind === 'video'
                                        ? posterUrl(c.cover.mediaId, data.mediaToken)
                                        : imageThumbUrl(c.cover.mediaId, data.mediaToken)
                                    : undefined
                            return (
                                <li key={c.id}>
                                    <button
                                        type="button"
                                        className={styles.row}
                                        aria-pressed={inside}
                                        disabled={busy === c.id}
                                        onClick={() => void toggle(c)}
                                    >
                                        {cover ? (
                                            <img className={styles.cover} src={cover} alt="" loading="lazy" />
                                        ) : (
                                            <span className={styles.cover}>
                                                <MdPhotoLibrary size={20} />
                                            </span>
                                        )}
                                        <span className={styles.name}>
                                            <span>{c.title}</span>
                                            <small>{c.itemCount} عنصر</small>
                                        </span>
                                        {inside ? (
                                            <MdCheckBox size={24} color="#01feff" />
                                        ) : (
                                            <MdCheckBoxOutlineBlank size={24} />
                                        )}
                                    </button>
                                </li>
                            )
                        })}
                        <li>
                            <button type="button" className={`${styles.row} ${styles.new}`} onClick={() => setCreating(section)}>
                                <span className={styles.cover}>
                                    <MdAdd size={22} />
                                </span>
                                <span className={styles.name}>
                                    <span>{section === 'images' ? 'تصنيف جديد' : 'مجموعة جديدة'}</span>
                                </span>
                            </button>
                        </li>
                    </ul>
                </section>
            ))}
            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}
        </Sheet>
    )
}
