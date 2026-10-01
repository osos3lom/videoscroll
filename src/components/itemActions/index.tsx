import { MdFavorite, MdFileDownload, MdLibraryAdd, MdOutlineBookmark } from 'react-icons/md'
import type { MediaEntry } from '../../hooks/useMedia'
import type { UseReactionsResult } from '../../hooks/useReactions'
import { saveFile } from '../../lib/download'
import styles from './itemActions.module.css'

interface Props {
    entry: MediaEntry
    reactions: UseReactionsResult
    onAddToCollection?: () => void
}

/** Like, save, add to a collection and download, for the item on screen. */
export default function ItemActions({ entry, reactions, onAddToCollection }: Props) {
    const liked = reactions.isLiked(entry.id)
    const saved = reactions.isSaved(entry.id)
    const counts = reactions.counts(entry.id)
    const noun = entry.kind === 'video' ? 'الفيديو' : 'الصورة'

    return (
        <>
            <button
                type="button"
                className={styles.button}
                onClick={() => reactions.toggle('like', entry.id)}
                aria-label={liked ? 'إلغاء الإعجاب' : 'إعجاب'}
                aria-pressed={liked}
            >
                <MdFavorite size={32} color={liked ? '#D65076' : '#ffffff'} />
                {entry.kind === 'video' && <span>{counts.likes}</span>}
            </button>
            <button
                type="button"
                className={styles.button}
                onClick={() => reactions.toggle('save', entry.id)}
                aria-label={saved ? 'إزالة من المحفوظات' : `حفظ ${noun}`}
                aria-pressed={saved}
            >
                <MdOutlineBookmark size={32} color={saved ? '#FCD354' : '#ffffff'} />
                {entry.kind === 'video' && <span>{counts.bookmarks}</span>}
            </button>
            {onAddToCollection && (
                <button type="button" className={styles.button} onClick={onAddToCollection} aria-label="أضف إلى مجموعة">
                    <MdLibraryAdd size={30} />
                </button>
            )}
            {entry.download && (
                <button
                    type="button"
                    className={styles.button}
                    onClick={() => saveFile(entry.download!, entry.title)}
                    aria-label={`تنزيل ${noun}`}
                >
                    <MdFileDownload size={32} />
                </button>
            )}
        </>
    )
}
