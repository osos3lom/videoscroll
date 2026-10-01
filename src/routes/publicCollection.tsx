import { useEffect, useRef, useState } from 'react'
import { MdIosShare, MdPhoto, MdVideocam, MdVolumeOff, MdVolumeUp } from 'react-icons/md'
import { Link } from 'react-router'
import MediaSlide from '../components/mediaSlide'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { IS_DEMO, publicCollectionMediaUrl, publicCollectionPosterUrl, publicCollectionUrl } from '../lib/apiUrl'
import { messageForCode } from '../lib/errorMessages'
import type { PublicCollection } from '../types/api'
import { shareUrl } from '../utils/share'
import styles from './publicCollection.module.css'

type State = { kind: 'loading' } | { kind: 'ready'; collection: PublicCollection } | { kind: 'error'; message: string }

const NOT_FOUND = messageForCode('share_not_found')!
const DIGITS = new Intl.NumberFormat('ar')

/**
 * The page a public collection link opens: `…/collection#<code>`. Its items
 * as a vertical feed, in the owner's order, for anyone with the link.
 *
 * Like /watch, the code stays in the fragment (GitHub Pages never sees it),
 * and requests use plain `fetch`: never a member's token, and a failure here
 * must not sign anyone out.
 */
export default function PublicCollectionPage() {
    const [code] = useState(() => decodeURIComponent(window.location.hash.replace(/^#/, '')).trim())
    const [state, setState] = useState<State>(() =>
        IS_DEMO || !code ? { kind: 'error', message: NOT_FOUND } : { kind: 'loading' }
    )
    const [active, setActive] = useState(0)
    const [muted, setMuted] = useState(false)
    const [note, setNote] = useState<string | null>(null)
    const feedRef = useRef<HTMLDivElement>(null)
    useDocumentTitle(state.kind === 'ready' ? `${state.collection.title} - VideoScroll` : 'VideoScroll')

    useEffect(() => {
        if (IS_DEMO || !code) return
        let cancelled = false
        fetch(publicCollectionUrl(code), { referrerPolicy: 'no-referrer' })
            .then(async (response) => {
                const body = await response.json().catch(() => ({}))
                if (cancelled) return
                if (response.ok) setState({ kind: 'ready', collection: body as PublicCollection })
                else setState({ kind: 'error', message: messageForCode(body.code) ?? NOT_FOUND })
            })
            .catch(() => {
                if (!cancelled) setState({ kind: 'error', message: messageForCode('network_error')! })
            })
        return () => {
            cancelled = true
        }
    }, [code])

    useEffect(() => {
        const feed = feedRef.current
        if (!feed) return
        const onScroll = () => {
            if (feed.clientHeight > 0) setActive(Math.round(feed.scrollTop / feed.clientHeight))
        }
        feed.addEventListener('scroll', onScroll, { passive: true })
        return () => feed.removeEventListener('scroll', onScroll)
    }, [state.kind])

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const feed = feedRef.current
            if (!feed) return
            if (event.key.toLowerCase() === 'm') setMuted((m) => !m)
            const down = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'ArrowRight'
            const up = event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'ArrowLeft'
            if (!down && !up) return
            event.preventDefault()
            feed.scrollBy({ top: down ? feed.clientHeight : -feed.clientHeight, behavior: 'smooth' })
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    if (state.kind !== 'ready') {
        return (
            <main className={styles.message}>
                <p className={styles.brand}>VideoScroll</p>
                {state.kind === 'loading' ? (
                    <p>جارٍ التحميل…</p>
                ) : (
                    <div role="alert">
                        <h1>تعذر فتح المجموعة</h1>
                        <p>{state.message}</p>
                    </div>
                )}
                <Link to="/login" className={styles.login}>
                    عضو في المجتمع؟ سجّل الدخول
                </Link>
            </main>
        )
    }

    const { collection } = state
    const item = collection.items[active]
    const share = async () => {
        const result = await shareUrl(collection.title, window.location.href)
        if (result === 'copied') setNote('تم نسخ الرابط.')
        if (result === 'failed') setNote('تعذر المشاركة.')
    }

    return (
        <main className={styles.page}>
            <div ref={feedRef} className={styles.feed} data-testid="public-feed">
                {collection.items.length === 0 && (
                    <div className={styles.slide}>
                        <p className={styles.empty}>هذه المجموعة فارغة الآن.</p>
                    </div>
                )}
                {collection.items.map((it, index) => (
                    <section key={it.key} className={styles.slide} aria-label={it.title} aria-hidden={index !== active}>
                        {Math.abs(index - active) <= 1 && (
                            <MediaSlide
                                media={{
                                    kind: it.kind,
                                    title: it.title,
                                    src: publicCollectionMediaUrl(code, it.key),
                                    poster: publicCollectionPosterUrl(code, it.key),
                                }}
                                active={index === active}
                                muted={muted}
                                onAutoplayBlocked={() => setMuted(true)}
                            />
                        )}
                    </section>
                ))}
            </div>

            <header className={styles.top}>
                <div className={styles.heading}>
                    <p className={styles.brand}>VideoScroll</p>
                    <h1 className={styles.title}>{collection.title}</h1>
                    {collection.description && <p className={styles.description}>{collection.description}</p>}
                    {item && (
                        <p className={styles.meta}>
                            <span className={styles.kind}>
                                {item.kind === 'video' ? <MdVideocam size={14} /> : <MdPhoto size={14} />}
                                {item.kind === 'video' ? 'فيديو' : 'صورة'}
                            </span>
                            <span data-testid="public-counter">
                                {DIGITS.format(active + 1)} / {DIGITS.format(collection.items.length)}
                            </span>
                        </p>
                    )}
                </div>
                <button type="button" className={styles.round} onClick={() => setMuted((m) => !m)} aria-label={muted ? 'تشغيل الصوت' : 'كتم الصوت'}>
                    {muted ? <MdVolumeOff size={20} /> : <MdVolumeUp size={20} />}
                </button>
                <button type="button" className={styles.round} onClick={() => void share()} aria-label="مشاركة المجموعة">
                    <MdIosShare size={20} />
                </button>
            </header>
            {note && (
                <p className={styles.note} role="status">
                    {note}
                </p>
            )}
            <footer className={styles.footer}>
                <span>شارك أحد أعضاء مجتمع خاص هذه المجموعة معك.</span>
            </footer>
        </main>
    )
}
