import type { ReactNode } from 'react'
import { MdCheckCircle, MdPhoto, MdPlayArrow } from 'react-icons/md'
import { Link } from 'react-router'
import type { MediaEntry } from '../../hooks/useMedia'
import styles from './mediaTile.module.css'

interface MediaTileProps {
    media: MediaEntry
    /** A link, a toggle (with `selected`), or nothing. */
    to?: string
    onClick?: () => void
    selected?: boolean
    disabled?: boolean
    /** Corner buttons, e.g. download or delete. */
    actions?: ReactNode
    /** 9:16, to line up with video cards. */
    tall?: boolean
}

/**
 * A square-ish grid tile for a video or an image: its poster or thumbnail,
 * the title, and which kind it is. Never mounts a <video>, so a grid of a
 * thousand stays cheap.
 */
export default function MediaTile({ media, to, onClick, selected, disabled, actions, tall }: MediaTileProps) {
    const body = (
        <>
            {media.poster ? (
                <img
                    className={styles.image}
                    src={media.poster}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                />
            ) : (
                <div className={styles.image} />
            )}
            <span className={styles.kind} aria-hidden="true">
                {media.kind === 'video' ? <MdPlayArrow size={18} /> : <MdPhoto size={16} />}
            </span>
            <span className={styles.title}>{media.title}</span>
            {selected !== undefined && (
                <span className={`${styles.check} ${selected ? styles.check_on : ''}`} aria-hidden="true">
                    {selected && <MdCheckCircle size={26} />}
                </span>
            )}
        </>
    )

    const label = `${media.kind === 'video' ? 'فيديو' : 'صورة'}: ${media.title}`

    return (
        <div
            className={`${styles.tile} ${tall ? styles.tile_tall : ''} ${selected ? styles.tile_selected : ''} ${disabled ? styles.tile_disabled : ''}`}
        >
            {to ? (
                <Link to={to} className={styles.hit} aria-label={label}>
                    {body}
                </Link>
            ) : onClick ? (
                <button
                    type="button"
                    className={styles.hit}
                    onClick={onClick}
                    disabled={disabled}
                    aria-label={label}
                    aria-pressed={selected}
                >
                    {body}
                </button>
            ) : (
                <div className={styles.hit} aria-label={label}>
                    {body}
                </div>
            )}
            {actions && <div className={styles.actions}>{actions}</div>}
        </div>
    )
}
