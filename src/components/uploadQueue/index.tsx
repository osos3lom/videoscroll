import { useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
    MdCheckCircle,
    MdClose,
    MdErrorOutline,
    MdExpandLess,
    MdExpandMore,
    MdImage,
    MdLibraryAdd,
    MdMovie,
    MdRefresh,
} from 'react-icons/md'
import { type QueueItem, cancel, clearFinished, getQueue, remove, retry, subscribeQueue } from '../../lib/uploadQueue'
import AddToCollection from '../addToCollection'
import styles from './uploadQueue.module.css'

function sizeText(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ج.ب`
}

function statusText(item: QueueItem): string {
    switch (item.state) {
        case 'waiting':
            return 'في الانتظار'
        case 'uploading':
            return `${item.resumed ? 'استئناف الرفع' : 'جارٍ الرفع'}… ${item.percent}%`
        case 'processing':
            return 'جارٍ المعالجة على الخادم…'
        case 'done':
            return 'تم النشر بنجاح'
        case 'error':
            return item.error ?? 'فشل الرفع'
    }
}

interface Props {
    notice: string | null
    onDismissNotice: () => void
}

/**
 * The upload queue, above the navbar: one row per file with its thumbnail,
 * name, state and progress, and retry, cancel or remove. Collapses to a pill
 * so it never hides the feed for long.
 */
export default function UploadQueue({ notice, onDismissNotice }: Props) {
    const items = useSyncExternalStore(subscribeQueue, getQueue, getQueue)
    const [collapsed, setCollapsed] = useState(false)
    const [organizing, setOrganizing] = useState<string[] | null>(null)

    if (items.length === 0 && !notice) return null

    const moving = items.filter((item) => item.state === 'waiting' || item.state === 'uploading' || item.state === 'processing')
    const done = items.filter((item) => item.state === 'done')
    const failed = items.filter((item) => item.state === 'error')
    const total = items.reduce((sum, item) => sum + item.size, 0)
    const sent = items.reduce(
        (sum, item) => sum + (item.state === 'done' || item.state === 'processing' ? item.size : (item.size * item.percent) / 100),
        0
    )
    const overall = total > 0 ? Math.floor((sent / total) * 100) : 0
    const newImages = done.filter((item) => item.kind === 'image' && item.mediaId).map((item) => item.mediaId!)
    const summary =
        moving.length > 0
            ? `جارٍ الرفع: اكتمل ${done.length} من ${items.length} · ${overall}%`
            : failed.length > 0
              ? `اكتمل ${done.length} من ${items.length}، فشل ${failed.length}`
              : `اكتمل رفع ${done.length} ${done.length === 1 ? 'ملف' : 'ملفات'}`

    return createPortal(
        <section className={`${styles.panel} ${collapsed ? styles.panel_collapsed : ''}`} aria-label="قائمة الرفع">
            <header className={styles.header}>
                <button
                    type="button"
                    className={styles.toggle}
                    onClick={() => setCollapsed((c) => !c)}
                    aria-expanded={!collapsed}
                >
                    <span className={styles.summary} role="status">
                        {summary}
                    </span>
                    {collapsed ? <MdExpandLess size={22} /> : <MdExpandMore size={22} />}
                </button>
                {moving.length === 0 && (
                    <button
                        type="button"
                        className={styles.icon}
                        onClick={() => {
                            clearFinished()
                            onDismissNotice()
                        }}
                        aria-label="إغلاق قائمة الرفع"
                    >
                        <MdClose size={20} />
                    </button>
                )}
                <div className={styles.overall} aria-hidden="true">
                    <div className={styles.overallFill} style={{ width: `${moving.length > 0 ? overall : 100}%` }} />
                </div>
            </header>

            {!collapsed && (
                <>
                    {notice && (
                        <p className={styles.notice} role="alert">
                            <span>{notice}</span>
                            <button type="button" className={styles.icon} onClick={onDismissNotice} aria-label="إخفاء التنبيه">
                                <MdClose size={16} />
                            </button>
                        </p>
                    )}
                    <ol className={styles.list}>
                        {items.map((item, index) => (
                            <li key={item.id} className={styles.row} data-state={item.state}>
                                <span className={styles.index}>{index + 1}</span>
                                {item.thumb ? (
                                    <img className={styles.thumb} src={item.thumb} alt="" />
                                ) : (
                                    <span className={styles.thumb} aria-hidden="true">
                                        {item.kind === 'video' ? <MdMovie size={20} /> : <MdImage size={20} />}
                                    </span>
                                )}
                                <div className={styles.body}>
                                    <bdi className={styles.name} title={item.name}>
                                        {item.name}
                                    </bdi>
                                    <span className={styles.status}>
                                        {item.state === 'done' && <MdCheckCircle size={14} />}
                                        {item.state === 'error' && <MdErrorOutline size={14} />}
                                        {statusText(item)}
                                        <span className={styles.size}>· {sizeText(item.size)}</span>
                                    </span>
                                    {(item.state === 'uploading' || item.state === 'processing') && (
                                        <div
                                            className={styles.bar}
                                            role="progressbar"
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={item.percent}
                                            aria-label={`تقدم ${item.name}`}
                                        >
                                            <div
                                                className={`${styles.fill} ${item.state === 'processing' ? styles.fill_processing : ''}`}
                                                style={{ width: `${item.percent}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className={styles.actions}>
                                    {item.state === 'error' && (
                                        <button
                                            type="button"
                                            className={styles.icon}
                                            onClick={() => retry(item.id)}
                                            aria-label={`إعادة محاولة ${item.name}`}
                                        >
                                            <MdRefresh size={20} />
                                        </button>
                                    )}
                                    {(item.state === 'waiting' || item.state === 'uploading') && (
                                        <button
                                            type="button"
                                            className={styles.icon}
                                            onClick={() => cancel(item.id)}
                                            aria-label={`إلغاء ${item.name}`}
                                        >
                                            <MdClose size={20} />
                                        </button>
                                    )}
                                    {(item.state === 'done' || item.state === 'error') && (
                                        <button
                                            type="button"
                                            className={styles.icon}
                                            onClick={() => remove(item.id)}
                                            aria-label={`إزالة ${item.name} من القائمة`}
                                        >
                                            <MdClose size={18} />
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ol>
                    {moving.length === 0 && newImages.length > 0 && (
                        <button type="button" className={styles.organize} onClick={() => setOrganizing(newImages)}>
                            <MdLibraryAdd size={20} />
                            أضف الصور الجديدة ({newImages.length}) إلى تصنيف
                        </button>
                    )}
                </>
            )}

            {organizing && (
                <AddToCollection mediaIds={organizing} kind="image" onClose={() => setOrganizing(null)} />
            )}
        </section>,
        document.body
    )
}
