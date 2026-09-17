import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSessionActions } from '../hooks/useSession'
import styles from './auth.module.css'

/**
 * Account creation from an invite link, `…/join#<code>`.
 *
 * The code travels in the URL fragment, which browsers never send to any
 * server — so it cannot end up in GitHub Pages' or Caddy's access logs.
 */
const JoinPage = () => {
    useDocumentTitle('Join - VideoScroll')
    const { join } = useSessionActions()

    const [code, setCode] = useState(() => decodeURIComponent(window.location.hash.replace(/^#/, '')))
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (busy) return
        if (password !== confirm) {
            setError('Passwords do not match')
            return
        }
        setBusy(true)
        setError(null)
        try {
            await join(code.trim(), username, password)
            // Drop the spent code from the address bar and history.
            window.history.replaceState(null, '', window.location.pathname)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not join')
            setBusy(false)
        }
    }

    return (
        <div className={styles.page}>
            <form className={styles.panel} onSubmit={submit}>
                <p className={styles.brand}>VideoScroll</p>
                <h1 className={styles.title}>Join the community</h1>
                <p className={styles.hint}>Choose a username and a password of at least 10 characters.</p>

                {!window.location.hash && (
                    <label className={styles.label}>
                        Invite code
                        <input
                            className={styles.input}
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            autoCapitalize="none"
                            spellCheck={false}
                            required
                        />
                    </label>
                )}

                <label className={styles.label}>
                    Username
                    <input
                        className={styles.input}
                        value={username}
                        onChange={(e) => setUsername(e.target.value.toLowerCase())}
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        pattern="[a-z0-9_.\-]{3,32}"
                        title="3-32 characters: letters, digits, dot, dash or underscore"
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
                        autoComplete="new-password"
                        minLength={10}
                        required
                    />
                </label>

                <label className={styles.label}>
                    Repeat password
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
                    disabled={busy || !code || !username || !password || !confirm}
                >
                    {busy ? 'Creating account…' : 'Create account'}
                </button>

                <p className={styles.footnote}>
                    Already a member? <Link to="/login">Sign in</Link>
                </p>
            </form>
        </div>
    )
}

export default JoinPage
