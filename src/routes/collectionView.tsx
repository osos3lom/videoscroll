import { useCallback, useMemo, useState } from 'react'
import { MdDeleteOutline, MdEdit, MdShare } from 'react-icons/md'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import AddToCollection from '../components/addToCollection'
import CollectionBrowser, { type BrowserItem, type BrowserRow } from '../components/collectionBrowser'
import CollectionEditor from '../components/collectionEditor'
import CollectionShare from '../components/collectionShare'
import ItemActions from '../components/itemActions'
import { ActionSheet } from '../components/sheet'
import { collectionApi, refreshCollections, useCollections } from '../hooks/useCollections'
import { useDialog } from '../hooks/useDialog'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { IMAGES_CHANGED_EVENT } from '../hooks/useImages'
import { type MediaEntry, imageEntry, useMediaLookup } from '../hooks/useMedia'
import { useReactions } from '../hooks/useReactions'
import { useSession } from '../hooks/useSession'
import { VIDEOS_CHANGED_EVENT } from '../hooks/useVideos'
import type { Collection, CollectionSection } from '../types/api'
import styles from './collectionView.module.css'

/** The virtual first row of /images: every image of mine. */
const ALL_IMAGES = 'all'

/**
 * /collections/:id and /images/:id: the collection browser, opened on one
 * collection, with the member's other collections of the section above and
 * below it. The URL follows the item on screen (?item=), so a reload or a
 * shared link within the app lands on the same place.
 */
export default function CollectionViewPage({ section }: { section: CollectionSection }) {
    const { id = '' } = useParams()
    const [search] = useSearchParams()
    const navigate = useNavigate()
    const location = useLocation()
    const session = useSession()
    const dialog = useDialog()
    const base = section === 'images' ? '/images' : '/collections'

    const { collections, isLoading, unsupported } = useCollections(section)
    const { byId, videos, images, isLoading: mediaLoading } = useMediaLookup()
    const reactions = useReactions(videos.social)

    const [menu, setMenu] = useState<Collection | null>(null)
    const [editing, setEditing] = useState<Collection | null>(null)
    const [sharing, setSharing] = useState<Collection | null>(null)
    const [adding, setAdding] = useState<MediaEntry | null>(null)

    const userId = session?.user.id
    const rows = useMemo<BrowserRow[]>(() => {
        const toItems = (c: Collection): BrowserItem[] =>
            (c.items ?? []).flatMap((item) => {
                const entry = byId.get(item.mediaId)
                return entry ? [{ key: item.id, entry }] : []
            })
        const out: BrowserRow[] = collections.map((c) => ({ id: c.id, title: c.title, visibility: c.visibility, items: toItems(c) }))
        if (section === 'images') {
            const mine = images.images.filter((image) => image.uploaderId === userId)
            out.unshift({
                id: ALL_IMAGES,
                title: 'كل صوري',
                items: mine.map((image) => ({ key: image.imageId, entry: imageEntry(image) })),
            })
        }
        return out
    }, [collections, byId, images.images, section, userId])

    const current = rows.find((row) => row.id === id)
    useDocumentTitle(`${current?.title ?? 'المجموعات'} - VideoScroll`)

    const onPosition = useCallback(
        (rowId: string, itemKey: string | undefined) => {
            const next = `${base}/${rowId}${itemKey ? `?item=${encodeURIComponent(itemKey)}` : ''}`
            if (next !== `${location.pathname}${location.search}`) navigate(next, { replace: true })
        },
        [base, location.pathname, location.search, navigate]
    )

    // Back is history back, so the button and the phone's back gesture agree:
    // moving through items replaces the entry, so one step returns to where
    // the collection was opened from. Opened from a link, there is nothing to
    // go back to inside the app, so go to the list instead.
    const openedInApp = location.key !== 'default'
    const onBack = useCallback(() => {
        if (openedInApp) navigate(-1)
        else navigate(base, { replace: true })
    }, [navigate, base, openedInApp])

    // An expired media token is the usual cause; refetching issues a new one.
    const onMediaError = useCallback(() => {
        window.dispatchEvent(new Event(VIDEOS_CHANGED_EVENT))
        window.dispatchEvent(new Event(IMAGES_CHANGED_EVENT))
        void refreshCollections()
    }, [])

    const remove = async (c: Collection) => {
        const confirmed = await dialog.confirm({
            title: `حذف «${c.title}»؟`,
            message: 'تُحذف المجموعة فقط، وتبقى الفيديوهات والصور التي بداخلها كما هي.',
            confirmLabel: 'حذف',
            danger: true,
        })
        if (!confirmed) return
        await collectionApi.remove(c.id)
        navigate(base, { replace: true })
    }

    const waiting = isLoading || mediaLoading
    if (unsupported || (!waiting && !current)) {
        return (
            <div className={styles.message}>
                <h1>{unsupported ? 'هذه الميزة تحتاج إلى تحديث الخادم' : 'المجموعة غير موجودة'}</h1>
                <button type="button" className={styles.back} onClick={onBack}>
                    رجوع
                </button>
            </div>
        )
    }
    // Items need both the collections and the media they name; the browser
    // picks its starting item once, so it mounts only when both are here.
    if (waiting || !current) {
        return (
            <div className={styles.message}>
                <p>جارٍ التحميل…</p>
            </div>
        )
    }

    const collectionOf = (rowId: string) => collections.find((c) => c.id === rowId)

    return (
        <>
            {dialog.element}
            <CollectionBrowser
                rows={rows}
                initialRowId={id}
                initialItemKey={search.get('item') ?? undefined}
                rowNoun={section === 'images' ? 'تصنيف' : 'مجموعة'}
                onPosition={onPosition}
                onBack={onBack}
                onRowMenu={(row) => {
                    const c = collectionOf(row.id)
                    if (c) setMenu(c)
                }}
                renderItemActions={(_row, item) => (
                    <ItemActions entry={item.entry} reactions={reactions} onAddToCollection={() => setAdding(item.entry)} />
                )}
                renderEmpty={(row) => {
                    const c = collectionOf(row.id)
                    return (
                        <>
                            <p>{row.id === ALL_IMAGES ? 'لم ترفع أي صورة بعد.' : 'لا توجد عناصر في هذه المجموعة بعد.'}</p>
                            {c && (
                                <button type="button" className={styles.back} onClick={() => setEditing(c)}>
                                    إضافة عناصر
                                </button>
                            )}
                        </>
                    )
                }}
                onMediaError={onMediaError}
            />

            {menu && (
                <ActionSheet
                    title={menu.title}
                    onClose={() => setMenu(null)}
                    actions={[
                        { label: 'تعديل', icon: <MdEdit size={20} />, onSelect: () => setEditing(menu) },
                        { label: 'مشاركة', icon: <MdShare size={20} />, onSelect: () => setSharing(menu) },
                        {
                            label: section === 'images' ? 'حذف التصنيف' : 'حذف المجموعة',
                            icon: <MdDeleteOutline size={20} />,
                            danger: true,
                            onSelect: () => void remove(menu),
                        },
                    ]}
                />
            )}
            {editing && <CollectionEditor section={section} collection={editing} onClose={() => setEditing(null)} />}
            {sharing && <CollectionShare collection={sharing} onClose={() => setSharing(null)} />}
            {adding && <AddToCollection mediaIds={[adding.id]} kind={adding.kind} onClose={() => setAdding(null)} />}
        </>
    )
}
