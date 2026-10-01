import { useMemo, useState } from 'react'
import { type MediaEntry, useMediaLookup } from '../../hooks/useMedia'
import type { CollectionSection } from '../../types/api'
import dialogStyles from '../dialog/dialog.module.css'
import MediaTile from '../mediaTile'
import Sheet from '../sheet'
import styles from './mediaPicker.module.css'

type Source = 'mine' | 'all' | 'saved' | 'liked' | 'images'

const SOURCE_LABEL: Record<Source, string> = {
    mine: 'مرفوعاتي',
    all: 'كل الفيديوهات',
    images: 'صوري',
    saved: 'المحفوظات',
    liked: 'الإعجابات',
}

interface Props {
    section: CollectionSection
    /** Already in the collection: shown, but not pickable again. */
    exclude: Set<string>
    userId?: string
    savedIds: string[]
    likedIds: string[]
    onPick: (mediaIds: string[]) => void
    onCancel: () => void
}

/** Choosing existing media to add to a collection, from a few sources. */
export default function MediaPicker({ section, exclude, userId, savedIds, likedIds, onPick, onCancel }: Props) {
    const { byId, videos, images, isLoading } = useMediaLookup()
    const sources: Source[] = section === 'images' ? ['images', 'saved', 'liked'] : ['mine', 'all', 'images', 'saved', 'liked']
    const [source, setSource] = useState<Source>(sources[0])
    const [picked, setPicked] = useState<string[]>([])

    const list = useMemo<MediaEntry[]>(() => {
        const pick = (ids: string[]) => ids.flatMap((id) => byId.get(id) ?? [])
        let out: MediaEntry[]
        switch (source) {
            case 'mine':
                out = videos.videos.filter((v) => v.uploaderId && v.uploaderId === userId).flatMap((v) => byId.get(v.videoId) ?? [])
                break
            case 'all':
                out = pick(videos.videos.map((v) => v.videoId))
                break
            case 'images':
                // The owner's list holds everyone's images; offer their own here.
                out = pick(images.images.filter((i) => i.uploaderId === userId).map((i) => i.imageId))
                break
            case 'saved':
                out = pick(savedIds)
                break
            case 'liked':
                out = pick(likedIds)
                break
        }
        return section === 'images' ? out.filter((entry) => entry.kind === 'image') : out
    }, [source, byId, videos.videos, images.images, savedIds, likedIds, userId, section])

    const toggle = (id: string) =>
        setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))

    return (
        <Sheet
            title={section === 'images' ? 'إضافة صور' : 'إضافة عناصر'}
            onClose={onCancel}
            tall
            footer={
                <>
                    <button
                        type="button"
                        className={`${dialogStyles.button} ${dialogStyles.primary}`}
                        disabled={picked.length === 0}
                        onClick={() => onPick(picked)}
                    >
                        {picked.length > 0 ? `إضافة (${picked.length})` : 'اختر عناصر'}
                    </button>
                    <button type="button" className={dialogStyles.button} onClick={onCancel}>
                        رجوع
                    </button>
                </>
            }
        >
            <div className={styles.sources} role="group" aria-label="المصدر">
                {sources.map((key) => (
                    <button
                        key={key}
                        type="button"
                        className={`${styles.source} ${source === key ? styles.source_on : ''}`}
                        aria-pressed={source === key}
                        onClick={() => setSource(key)}
                    >
                        {SOURCE_LABEL[key]}
                    </button>
                ))}
            </div>

            {list.length === 0 ? (
                <p className={styles.empty}>{isLoading ? 'جارٍ التحميل…' : 'لا يوجد شيء هنا بعد.'}</p>
            ) : (
                <div className={styles.grid}>
                    {list.map((entry) => {
                        const already = exclude.has(entry.id)
                        return (
                            <MediaTile
                                key={entry.id}
                                media={entry}
                                selected={already || picked.includes(entry.id)}
                                disabled={already}
                                onClick={() => toggle(entry.id)}
                            />
                        )
                    })}
                </div>
            )}
        </Sheet>
    )
}
