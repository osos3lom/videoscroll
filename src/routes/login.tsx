import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSessionActions } from '../hooks/useSession'
import styles from './auth.module.css'

const LoginPage = () => {
    useDocumentTitle('Sign in - VideoScroll')
    const { login } = useSessionActions()

    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            // On success the session store updates and the gate re-renders
            // into the app; nothing else to do here.
            await login(username, password)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Sign in failed')
            setPassword('')
            setBusy(false)
        }
    }

    return (
        <div className={styles.page}>
            <form className={styles.panel} onSubmit={submit}>
                <p className={styles.brand}>VideoScroll</p>
                <h1 className={styles.title}>Sign in</h1>
                <p className={styles.hint}>This is a private community. You need an account to watch.</p>

                <label className={styles.label}>
                    Username
                    <input
                        className={styles.input}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        autoFocus
                        required
                    />
                </label>

                <label className={styles.label}>
                    Password
                    <input
                        className={styles.input}
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                    />
                </label>

                {error && <p className={styles.error}>{error}</p>}

                <button
                    type="submit"
                    className={`${styles.button} ${styles.button_primary}`}
                    disabled={busy || !username || !password}
                >
                    {busy ? 'Signing in…' : 'Sign in'}
                </button>

                <p className={styles.footnote}>
                    Got an invite link? <Link to="/join">Join here</Link>
                </p>
            </form>
        </div>
    )
}

export default LoginPage
