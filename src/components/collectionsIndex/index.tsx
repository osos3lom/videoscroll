import { useState } from 'react'
import {
    MdAdd,
    MdDeleteOutline,
    MdEdit,
    MdLock,
    MdMoreVert,
    MdOpenInFull,
    MdPhotoLibrary,
    MdPublic,
    MdShare,
} from 'react-icons/md'
import { Link, useNavigate } from 'react-router'
import { collectionApi, useCollections } from '../../hooks/useCollections'
import { useDialog } from '../../hooks/useDialog'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useImages } from '../../hooks/useImages'
import { imageEntry } from '../../hooks/useMedia'
import { useSession } from '../../hooks/useSession'
import { imageThumbUrl, posterUrl } from '../../lib/apiUrl'
import type { Collection, CollectionSection } from '../../types/api'
import CollectionEditor from '../collectionEditor'
import CollectionShare from '../collectionShare'
import MediaTile from '../mediaTile'
import { ActionSheet } from '../sheet'
import styles from './collectionsIndex.module.css'

const TEXT: Record<CollectionSection, { title: string; subtitle: string; create: string; empty: string; noun: string }> = {
    collections: {
        title: 'المجموعات',
        subtitle: 'نظّم الفيديوهات والصور في مجموعات خاصة بك، وشارك ما تشاء منها برابط.',
        create: 'مجموعة جديدة',
        empty: 'لا توجد مجموعات بعد. أنشئ أول مجموعة واختر لها فيديوهات أو صوراً.',
        noun: 'المجموعة',
    },
    images: {
        title: 'الصور',
        subtitle: 'صورك خاصة بك. رتّبها في تصنيفات، وشارك أي تصنيف برابط.',
        create: 'تصنيف جديد',
        empty: 'لا توجد تصنيفات بعد. أنشئ تصنيفاً واختر له صوراً.',
        noun: 'التصنيف',
    },
}

function countText(c: Collection): string {
    if (c.itemCount === 0) return 'فارغة'
    const parts = [`${c.itemCount} عنصر`]
    if (c.videoCount && c.imageCount) parts.push(`${c.videoCount} فيديو · ${c.imageCount} صورة`)
    return parts.join(' · ')
}

/** The /collections and /images pages: the member's own collections as cards. */
export default function CollectionsIndex({ section }: { section: CollectionSection }) {
    const text = TEXT[section]
    useDocumentTitle(`${text.title} - VideoScroll`)
    const navigate = useNavigate()
    const dialog = useDialog()
    const session = useSession()
    const { collections, mediaToken, isLoading, unsupported, error } = useCollections(section)
    const images = useImages()
    const myImages = images.images.filter((image) => image.uploaderId === session?.user.id)

    const [editing, setEditing] = useState<Collection | 'new' | null>(null)
    const [sharing, setSharing] = useState<Collection | null>(null)
    const [menu, setMenu] = useState<Collection | null>(null)
    const [message, setMessage] = useState<string | null>(null)

    const base = section === 'images' ? '/images' : '/collections'

    const coverUrl = (c: Collection) => {
        if (!c.cover || !mediaToken) return undefined
        return c.cover.kind === 'video' ? posterUrl(c.cover.mediaId, mediaToken) : imageThumbUrl(c.cover.mediaId, mediaToken)
    }

    const remove = async (c: Collection) => {
        const confirmed = await dialog.confirm({
            title: `حذف «${c.title}»؟`,
            message: `يُحذف ${text.noun} فقط. ${section === 'images' ? 'الصور' : 'الفيديوهات والصور'} التي بداخله تبقى كما هي.`,
            confirmLabel: 'حذف',
            danger: true,
        })
        if (!confirmed) return
        try {
            await collectionApi.remove(c.id)
        } catch (caught) {
            setMessage(caught instanceof Error ? caught.message : 'تعذر الحذف')
        }
    }

    if (unsupported) {
        return (
            <div className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>{text.title}</h1>
                </header>
                <div className={styles.empty}>
                    <p>هذه الميزة تحتاج إلى تحديث خادم المجتمع. أخبر المالك.</p>
                </div>
            </div>
        )
    }

    return (
        <div className={styles.page}>
            {dialog.element}
            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>{text.title}</h1>
                    <p className={styles.subtitle}>{text.subtitle}</p>
                </div>
                <button type="button" className={styles.create} onClick={() => setEditing('new')}>
                    <MdAdd size={20} />
                    {text.create}
                </button>
            </header>

            {message && (
                <p className={styles.error} role="alert">
                    {message}
                </p>
            )}

            <div className={styles.cards}>
                {section === 'images' && (
                    <Link to="/images/all" className={styles.card}>
                        <div className={`${styles.cover} ${styles.cover_all}`}>
                            {myImages[0] ? (
                                <img src={myImages[0].thumb} alt="" loading="lazy" />
                            ) : (
                                <MdPhotoLibrary size={40} />
                            )}
                        </div>
                        <div className={styles.cardText}>
                            <h2 className={styles.cardTitle}>كل صوري</h2>
                            <p className={styles.cardMeta}>{myImages.length} صورة</p>
                        </div>
                    </Link>
                )}

                {collections.map((c) => {
                    const cover = coverUrl(c)
                    return (
                        <article key={c.id} className={styles.card}>
                            <Link to={`${base}/${c.id}`} className={styles.cardLink} aria-label={`فتح ${c.title}`}>
                                <div className={styles.cover}>
                                    {cover ? <img src={cover} alt="" loading="lazy" /> : <MdPhotoLibrary size={40} />}
                                </div>
                                <div className={styles.cardText}>
                                    <h2 className={styles.cardTitle}>{c.title}</h2>
                                    <p className={styles.cardMeta}>
                                        {c.visibility === 'public' ? (
                                            <MdPublic size={14} aria-label="عامة" />
                                        ) : (
                                            <MdLock size={14} aria-label="خاصة" />
                                        )}
                                        <span>{countText(c)}</span>
                                    </p>
                                </div>
                            </Link>
                            <button
                                type="button"
                                className={styles.more}
                                aria-label={`خيارات ${c.title}`}
                                onClick={() => setMenu(c)}
                            >
                                <MdMoreVert size={22} />
                            </button>
                        </article>
                    )
                })}
            </div>

            {collections.length === 0 && (
                <div className={styles.empty}>
                    {isLoading ? <p>جارٍ التحميل…</p> : error ? <p>تعذر التحميل. حاول مرة أخرى.</p> : <p>{text.empty}</p>}
                </div>
            )}

            {section === 'images' && myImages.length > 0 && (
                <section className={styles.recent}>
                    <h2 className={styles.recentTitle}>أحدث الصور</h2>
                    <div className={styles.grid}>
                        {myImages.slice(0, 30).map((image) => (
                            <MediaTile
                                key={image.imageId}
                                media={imageEntry(image)}
                                to={`/images/all?item=${encodeURIComponent(image.imageId)}`}
                            />
                        ))}
                    </div>
                </section>
            )}

            {menu && (
                <ActionSheet
                    title={menu.title}
                    onClose={() => setMenu(null)}
                    actions={[
                        { label: 'فتح', icon: <MdOpenInFull size={20} />, onSelect: () => navigate(`${base}/${menu.id}`) },
                        { label: 'تعديل', icon: <MdEdit size={20} />, onSelect: () => setEditing(menu) },
                        { label: 'مشاركة', icon: <MdShare size={20} />, onSelect: () => setSharing(menu) },
                        {
                            label: `حذف ${text.noun}`,
                            icon: <MdDeleteOutline size={20} />,
                            danger: true,
                            onSelect: () => void remove(menu),
                        },
                    ]}
                />
            )}

            {editing && (
                <CollectionEditor
                    section={section}
                    collection={editing === 'new' ? undefined : editing}
                    onClose={() => setEditing(null)}
                />
            )}
            {sharing && <CollectionShare collection={sharing} onClose={() => setSharing(null)} />}
        </div>
    )
}
