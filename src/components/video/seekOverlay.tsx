import type { ScrubFeedback, SkipFeedback } from '../../hooks/useVideoGestures'
import styles from './seekOverlay.module.css'

function formatTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = String(total % 60).padStart(2, '0')
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** What a skip or a scrub looks like while it happens. Never takes input. */
export default function SeekOverlay({ skip, scrub }: { skip: SkipFeedback | null; scrub: ScrubFeedback | null }) {
    const label = scrub ? `${formatTime(scrub.time)} / ${formatTime(scrub.duration)}` : null

    return (
        <div className={styles.overlay} aria-hidden={!skip && !scrub}>
            {skip && (
                <div key={skip.key} className={`${styles.skip} ${styles[`skip_${skip.side}`]}`}>
                    <span dir="ltr">
                        {skip.side === 'forward' ? '+' : '−'}
                        {skip.seconds}
                    </span>
                    <small>ثانية</small>
                </div>
            )}

            {scrub && (
                <div className={styles.scrub}>
                    <p className={styles.scrub__time} dir="ltr">
                        {label}
                    </p>
                    <div className={styles.scrub__bar} dir="ltr">
                        <div
                            className={styles.scrub__fill}
                            style={{ width: `${scrub.duration ? (scrub.time / scrub.duration) * 100 : 0}%` }}
                        />
                    </div>
                </div>
            )}

            <p className={styles.visuallyHidden} aria-live="polite">
                {skip ? `${skip.side === 'forward' ? 'تقديم' : 'ترجيع'} ${skip.seconds} ثانية` : ''}
            </p>
        </div>
    )
}
