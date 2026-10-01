import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MdClose } from 'react-icons/md'
import styles from './sheet.module.css'

interface SheetProps {
    title: string
    onClose: () => void
    children: ReactNode
    /** Pinned under the content, e.g. the save button. */
    footer?: ReactNode
    /** Full height on phones, for editors; otherwise it fits its content. */
    tall?: boolean
}

/**
 * A bottom sheet on phones and a centred panel on wider screens. Portaled to
 * <body>, since the navbar's transform would trap a fixed child.
 */
export default function Sheet({ title, onClose, children, footer, tall = false }: SheetProps) {
    const titleId = useId()
    const panelRef = useRef<HTMLDivElement>(null)
    const onCloseRef = useRef(onClose)
    useEffect(() => {
        onCloseRef.current = onClose
    }, [onClose])

    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null
        panelRef.current?.focus()
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCloseRef.current()
        }
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('keydown', onKey)
            previous?.focus?.()
        }
    }, [])

    return createPortal(
        <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && onClose()}>
            <div
                ref={panelRef}
                className={`${styles.panel} ${tall ? styles.panel_tall : ''}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                // Keys typed here are not the feed's or the viewer's shortcuts.
                onKeyDown={(event) => event.key !== 'Escape' && event.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id={titleId} className={styles.title}>
                        {title}
                    </h2>
                    <button type="button" className={styles.close} onClick={onClose} aria-label="إغلاق">
                        <MdClose size={22} />
                    </button>
                </header>
                <div className={styles.body}>{children}</div>
                {footer && <footer className={styles.footer}>{footer}</footer>}
            </div>
        </div>,
        document.body
    )
}

interface Action {
    label: string
    icon?: ReactNode
    onSelect: () => void
    danger?: boolean
}

/** A sheet of actions, e.g. a card's "⋯" menu. */
export function ActionSheet({ title, actions, onClose }: { title: string; actions: Action[]; onClose: () => void }) {
    return (
        <Sheet title={title} onClose={onClose}>
            <ul className={styles.actions}>
                {actions.map((action) => (
                    <li key={action.label}>
                        <button
                            type="button"
                            className={`${styles.action} ${action.danger ? styles.action_danger : ''}`}
                            onClick={() => {
                                onClose()
                                action.onSelect()
                            }}
                        >
                            {action.icon}
                            <span>{action.label}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </Sheet>
    )
}
