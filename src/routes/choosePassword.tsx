import { type FormEvent, useState } from 'react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSession, useSessionActions } from '../hooks/useSession'
import { loginHint } from '../lib/accounts'
import styles from './auth.module.css'

/**
 * Shown instead of the app while the owner-set temporary password is still
 * in use. The server refuses everything else until this is done.
 */
const ChoosePasswordPage = () => {
    useDocumentTitle('تعيين كلمة المرور - VideoScroll')
    const session = useSession()
    const { changePassword, logout } = useSessionActions()

    const [current, setCurrent] = useState('')
    const [next, setNext] = useState('')
    const [confirm, setConfirm] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (busy) return
        if (next !== confirm) {
            setError('كلمتا المرور الجديدتان غير متطابقتين')
            return
        }
        setBusy(true)
        setError(null)
        try {
            // On success the session is replaced with one that no longer
            // needs a change, and the app renders normally.
            await changePassword(current, next)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'تعذر تغيير كلمة المرور')
            setBusy(false)
        }
    }

    const user = session?.user

    return (
        <div className={styles.page}>
            <form className={styles.panel} onSubmit={submit}>
                <p className={styles.brand}>VideoScroll</p>
                <h1 className={styles.title}>اختر كلمة المرور الخاصة بك</h1>
                <p className={styles.hint}>
                    {user ? `مرحباً ${user.displayName}. ` : ''}
                    لقد سجلت الدخول بكلمة مرور مؤقتة
                    {user ? ` لحساب ${loginHint(user.username)}` : ''}. يرجى اختيار كلمة مرور خاصة بك للمتابعة
                    (10 أحرف على الأقل).
                </p>

                <label className={styles.label}>
                    كلمة المرور المؤقتة
                    <input
                        className={styles.input}
                        type="password"
                        value={current}
                        onChange={(e) => setCurrent(e.target.value)}
                        autoComplete="current-password"
                        autoFocus
                        required
                    />
                </label>

                <label className={styles.label}>
                    كلمة المرور الجديدة
                    <input
                        className={styles.input}
                        type="password"
                        value={next}
                        onChange={(e) => setNext(e.target.value)}
                        autoComplete="new-password"
                        minLength={10}
                        required
                    />
                </label>

                <label className={styles.label}>
                    تأكيد كلمة المرور الجديدة
                    <input
                        className={styles.input}
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                        minLength={10}
                        required
                    />
                </label>

                {error && <p className={styles.error}>{error}</p>}

                <button
                    type="submit"
                    className={`${styles.button} ${styles.button_primary}`}
                    disabled={busy || !current || !next || !confirm}
                >
                    {busy ? 'جارٍ الحفظ…' : 'حفظ ومتابعة'}
                </button>
                <button type="button" className={styles.button} onClick={logout}>
                    تسجيل الخروج
                </button>
            </form>
        </div>
    )
}

export default ChoosePasswordPage
