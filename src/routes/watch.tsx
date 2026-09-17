import { useEffect, useState } from 'react'
import { MdFileDownload } from 'react-icons/md'
import { Link } from 'react-router'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { IS_DEMO, publicDownloadUrl, publicPosterUrl, publicShareUrl, publicVideoSrc } from '../lib/apiUrl'
import { messageForCode } from '../lib/errorMessages'
import { expiryText } from '../lib/shares'
import type { PublicShare } from '../types/api'
import styles from './watch.module.css'

type State = { kind: 'loading' } | { kind: 'ready'; share: PublicShare } | { kind: 'error'; message: string }

const NOT_FOUND = messageForCode('share_not_found')!

/**
 * The public page a share link opens: `…/watch#<code>`. It shows one video
 * and nothing else from the community, and works without an account.
 *
 * The code stays in the fragment, which browsers never send to GitHub Pages,
 * and requests go out with plain `fetch`: never the member's token, and a
 * failure here must not sign anyone out.
 */
const WatchPage = () => {
    const [code] = useState(() => decodeURIComponent(window.location.hash.replace(/^#/, '')).trim())
    const [state, setState] = useState<State>(() =>
        IS_DEMO || !code ? { kind: 'error', message: NOT_FOUND } : { kind: 'loading' }
    )
    useDocumentTitle(state.kind === 'ready' ? `${state.share.title} - VideoScroll` : 'VideoScroll')

    useEffect(() => {
        if (IS_DEMO || !code) return
        let cancelled = false
        fetch(publicShareUrl(code), { referrerPolicy: 'no-referrer' })
            .then(async (response) => {
                const body = await response.json().catch(() => ({}))
                if (cancelled) return
                if (response.ok) {
                    setState({ kind: 'ready', share: body as PublicShare })
                } else {
                    setState({ kind: 'error', message: messageForCode(body.code) ?? NOT_FOUND })
                }
            })
            .catch(() => {
                if (!cancelled) setState({ kind: 'error', message: messageForCode('network_error')! })
            })
        return () => {
            cancelled = true
        }
    }, [code])

    return (
        <main className={styles.page}>
            <p className={styles.brand}>VideoScroll</p>

            {state.kind === 'loading' && <p className={styles.muted}>جارٍ التحميل…</p>}

            {state.kind === 'error' && (
                <div className={styles.message} role="alert">
                    <h1 className={styles.title}>تعذر فتح الفيديو</h1>
                    <p className={styles.muted}>{state.message}</p>
                </div>
            )}

            {state.kind === 'ready' && (
                <article className={styles.card}>
                    <video
                        className={styles.video}
                        src={publicVideoSrc(code)}
                        poster={publicPosterUrl(code)}
                        controls
                        playsInline
                        preload="metadata"
                        crossOrigin="anonymous"
                        style={
                            state.share.width && state.share.height
                                ? { aspectRatio: `${state.share.width} / ${state.share.height}` }
                                : undefined
                        }
                    />
                    <h1 className={styles.title}>{state.share.title}</h1>
                    {state.share.expiresAt && <p className={styles.muted}>متاح {expiryText(state.share.expiresAt)}</p>}
                    <a className={styles.download} href={publicDownloadUrl(code)} download>
                        <MdFileDownload size={20} />
                        تنزيل الفيديو
                    </a>
                </article>
            )}

            <footer className={styles.footer}>
                <p>شارك أحد أعضاء مجتمع خاص هذا الفيديو معك.</p>
                <Link to="/login">عضو في المجتمع؟ سجّل الدخول</Link>
            </footer>
        </main>
    )
}

export default WatchPage
