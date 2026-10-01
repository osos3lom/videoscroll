import {
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react'
import {
    MdArrowForward,
    MdChevronLeft,
    MdChevronRight,
    MdExpandLess,
    MdExpandMore,
    MdLock,
    MdMoreVert,
    MdPhoto,
    MdPublic,
    MdVideocam,
    MdVolumeOff,
    MdVolumeUp,
} from 'react-icons/md'
import type { MediaEntry } from '../../hooks/useMedia'
import MediaSlide from '../mediaSlide'
import styles from './collectionBrowser.module.css'

export interface BrowserItem {
    /** Stable within the row: the collection item id. */
    key: string
    entry: MediaEntry
}

export interface BrowserRow {
    id: string
    title: string
    visibility?: 'private' | 'public'
    items: BrowserItem[]
}

interface Props {
    rows: BrowserRow[]
    initialRowId: string
    initialItemKey?: string
    /** "Collection 2 of 5" names this, e.g. مجموعة or تصنيف. */
    rowNoun: string
    onPosition?: (rowId: string, itemKey: string | undefined) => void
    onBack: () => void
    /** Opens the row's menu (edit, share, delete). */
    onRowMenu?: (row: BrowserRow) => void
    /** Buttons beside the item on screen: like, save, add, download. */
    renderItemActions?: (row: BrowserRow, item: BrowserItem) => ReactNode
    /** Shown in a row without items. */
    renderEmpty?: (row: BrowserRow) => ReactNode
    onMediaError?: () => void
}

const ARABIC_DIGITS = new Intl.NumberFormat('ar')

/**
 * Browsing collections like a feed, in two directions:
 *
 *   - up/down moves between collections (rows)
 *   - left/right moves between the items of the current collection
 *
 * Both are native scroll-snap containers, the track nested in the row, so the
 * browser locks each swipe to one axis by itself, on touch, trackpad and
 * wheel alike. Directions are physical, as in the feed: the track is
 * left-to-right whatever the page direction, so a swipe to the left (or the
 * right arrow) is "next".
 *
 * Only the rows next to the current one, and in them only the items next to
 * the current one, mount any media.
 */
export default function CollectionBrowser({
    rows,
    initialRowId,
    initialItemKey,
    rowNoun,
    onPosition,
    onBack,
    onRowMenu,
    renderItemActions,
    renderEmpty,
    onMediaError,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null)
    const tracks = useRef(new Map<string, HTMLDivElement>())
    const initialRow = Math.max(0, rows.findIndex((row) => row.id === initialRowId))
    const [activeRow, setActiveRow] = useState(initialRow)
    const [itemIndex, setItemIndex] = useState<Record<string, number>>(() => {
        const row = rows[initialRow]
        const index = row ? row.items.findIndex((item) => item.key === initialItemKey) : -1
        return row ? { [row.id]: Math.max(0, index) } : {}
    })
    const [muted, setMuted] = useState(false)

    const indexOf = useCallback((row: BrowserRow) => Math.min(itemIndex[row.id] ?? 0, Math.max(0, row.items.length - 1)), [itemIndex])

    // Land on the requested row before the first paint.
    useLayoutEffect(() => {
        const container = containerRef.current
        if (!container) return
        container.scrollTop = initialRow * container.clientHeight
        // Only on mount: later changes come from scrolling.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const onScroll = () => {
            const height = container.clientHeight
            if (height > 0) setActiveRow(Math.round(container.scrollTop / height))
        }
        container.addEventListener('scroll', onScroll, { passive: true })
        return () => container.removeEventListener('scroll', onScroll)
    }, [])

    const current = rows[Math.min(activeRow, rows.length - 1)]
    const currentIndex = current ? indexOf(current) : 0
    const currentKey = current?.items[currentIndex]?.key

    useEffect(() => {
        if (current) onPosition?.(current.id, currentKey)
    }, [current, currentKey, onPosition])

    const onTrackScroll = useCallback((rowId: string, track: HTMLDivElement) => {
        const width = track.clientWidth
        if (width <= 0) return
        const index = Math.round(track.scrollLeft / width)
        setItemIndex((prev) => (prev[rowId] === index ? prev : { ...prev, [rowId]: index }))
    }, [])

    const goRow = useCallback(
        (delta: number) => {
            const container = containerRef.current
            if (!container) return
            const target = Math.max(0, Math.min(rows.length - 1, activeRow + delta))
            container.scrollTo({ top: target * container.clientHeight, behavior: 'smooth' })
        },
        [activeRow, rows.length]
    )

    const goItem = useCallback(
        (delta: number) => {
            if (!current) return
            const track = tracks.current.get(current.id)
            if (!track) return
            const target = Math.max(0, Math.min(current.items.length - 1, currentIndex + delta))
            track.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' })
        },
        [current, currentIndex]
    )

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (target && (target.closest('input, textarea, select') || target.isContentEditable)) return
            // A sheet or dialog on top owns the keyboard, Escape included.
            if (document.querySelector('[role="dialog"]')) return
            if (event.altKey || event.ctrlKey || event.metaKey) return
            const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
            const actions: Record<string, () => void> = {
                ArrowDown: () => goRow(1),
                PageDown: () => goRow(1),
                j: () => goRow(1),
                ArrowUp: () => goRow(-1),
                PageUp: () => goRow(-1),
                k: () => goRow(-1),
                // Physical, like the feed: right is forward.
                ArrowRight: () => goItem(1),
                ArrowLeft: () => goItem(-1),
                m: () => setMuted((m) => !m),
                Escape: onBack,
            }
            const action = actions[key]
            if (!action) return
            event.preventDefault()
            action()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [goRow, goItem, onBack])

    const registerTrack = useCallback((rowId: string, el: HTMLDivElement | null) => {
        if (el) tracks.current.set(rowId, el)
        else tracks.current.delete(rowId)
    }, [])

    return (
        <div className={styles.browser}>
            <div ref={containerRef} className={styles.rows} data-testid="collection-rows">
                {rows.map((row, rowIdx) => {
                    const near = Math.abs(rowIdx - activeRow) <= 1
                    if (!near) return <section key={row.id} className={styles.row} aria-hidden="true" />
                    const index = indexOf(row)
                    const item = row.items[index]
                    const isActiveRow = rowIdx === activeRow
                    return (
                        <section
                            key={row.id}
                            className={styles.row}
                            aria-label={row.title}
                            aria-hidden={!isActiveRow}
                            data-row-id={row.id}
                        >
                            {row.items.length === 0 ? (
                                <div className={styles.emptyRow}>{renderEmpty?.(row)}</div>
                            ) : (
                                <Track
                                    row={row}
                                    index={index}
                                    isActiveRow={isActiveRow}
                                    muted={muted}
                                    onMuted={() => setMuted(true)}
                                    register={registerTrack}
                                    onScroll={onTrackScroll}
                                    onMediaError={onMediaError}
                                />
                            )}

                            <header className={styles.top}>
                                <button type="button" className={styles.round} onClick={onBack} aria-label="رجوع">
                                    <MdArrowForward size={22} />
                                </button>
                                <div className={styles.heading}>
                                    <h1 className={styles.title}>
                                        {row.visibility === 'public' ? (
                                            <MdPublic size={16} aria-label="عامة" />
                                        ) : row.visibility === 'private' ? (
                                            <MdLock size={16} aria-label="خاصة" />
                                        ) : null}
                                        <span>{row.title}</span>
                                    </h1>
                                    <p className={styles.meta}>
                                        {item && (
                                            <span className={styles.kind}>
                                                {item.entry.kind === 'video' ? <MdVideocam size={14} /> : <MdPhoto size={14} />}
                                                {item.entry.kind === 'video' ? 'فيديو' : 'صورة'}
                                            </span>
                                        )}
                                        {row.items.length > 0 && (
                                            <span aria-live={isActiveRow ? 'polite' : undefined} data-testid={isActiveRow ? 'item-counter' : undefined}>
                                                {ARABIC_DIGITS.format(index + 1)} / {ARABIC_DIGITS.format(row.items.length)}
                                            </span>
                                        )}
                                        {rows.length > 1 && (
                                            <span className={styles.rowPos}>
                                                {rowNoun} {ARABIC_DIGITS.format(rowIdx + 1)} من {ARABIC_DIGITS.format(rows.length)}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className={styles.round}
                                    onClick={() => setMuted((m) => !m)}
                                    aria-label={muted ? 'تشغيل الصوت' : 'كتم الصوت'}
                                >
                                    {muted ? <MdVolumeOff size={20} /> : <MdVolumeUp size={20} />}
                                </button>
                                {onRowMenu && (
                                    <button
                                        type="button"
                                        className={styles.round}
                                        onClick={() => onRowMenu(row)}
                                        aria-label={`خيارات ${row.title}`}
                                    >
                                        <MdMoreVert size={22} />
                                    </button>
                                )}
                            </header>

                            {row.items.length > 1 && row.items.length <= 20 && (
                                <div className={styles.dots} dir="ltr" aria-hidden="true">
                                    {row.items.map((it, i) => (
                                        <span key={it.key} className={`${styles.dot} ${i === index ? styles.dot_on : ''}`} />
                                    ))}
                                </div>
                            )}

                            {isActiveRow && item && renderItemActions && (
                                <div className={styles.actions}>{renderItemActions(row, item)}</div>
                            )}

                            {isActiveRow && row.items.length > 1 && (
                                <>
                                    <button
                                        type="button"
                                        className={`${styles.chevron} ${styles.chevron_left}`}
                                        onClick={() => goItem(-1)}
                                        disabled={index === 0}
                                        aria-label="العنصر السابق"
                                    >
                                        <MdChevronLeft size={34} />
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.chevron} ${styles.chevron_right}`}
                                        onClick={() => goItem(1)}
                                        disabled={index === row.items.length - 1}
                                        aria-label="العنصر التالي"
                                    >
                                        <MdChevronRight size={34} />
                                    </button>
                                </>
                            )}

                            {isActiveRow && rows.length > 1 && (
                                <div className={styles.rowNav}>
                                    <button
                                        type="button"
                                        className={styles.round}
                                        onClick={() => goRow(-1)}
                                        disabled={rowIdx === 0}
                                        aria-label={`${rowNoun} السابقة`}
                                    >
                                        <MdExpandLess size={26} />
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.round}
                                        onClick={() => goRow(1)}
                                        disabled={rowIdx === rows.length - 1}
                                        aria-label={`${rowNoun} التالية`}
                                    >
                                        <MdExpandMore size={26} />
                                    </button>
                                </div>
                            )}
                        </section>
                    )
                })}
            </div>
        </div>
    )
}

interface TrackProps {
    row: BrowserRow
    index: number
    isActiveRow: boolean
    muted: boolean
    onMuted: () => void
    register: (rowId: string, el: HTMLDivElement | null) => void
    onScroll: (rowId: string, el: HTMLDivElement) => void
    onMediaError?: () => void
}

function Track({ row, index, isActiveRow, muted, onMuted, register, onScroll, onMediaError }: TrackProps) {
    const ref = useRef<HTMLDivElement>(null)

    // A row that mounts again (scrolled away and back) returns to its item.
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        el.scrollLeft = index * el.clientWidth
        register(row.id, el)
        return () => register(row.id, null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div
            ref={ref}
            className={styles.track}
            dir="ltr"
            onScroll={(event) => onScroll(row.id, event.currentTarget)}
            data-testid={isActiveRow ? 'active-track' : undefined}
        >
            {row.items.map((item, i) => (
                <div key={item.key} className={styles.slide} dir="rtl" aria-hidden={i !== index}>
                    {Math.abs(i - index) <= 1 && (
                        <MediaSlide
                            media={item.entry}
                            active={isActiveRow && i === index}
                            muted={muted}
                            onAutoplayBlocked={onMuted}
                            onError={onMediaError}
                        />
                    )}
                </div>
            ))}
        </div>
    )
}
