import { useState } from 'react'
import { Link } from 'react-router'
import useSWR from 'swr'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSession } from '../hooks/useSession'
import { apiFetch } from '../lib/session'
import type { InviteView, PublicUser, Role, ServerStatus } from '../types/api'
import styles from './admin.module.css'

const ROLES: Role[] = ['viewer', 'uploader', 'owner']

const fetcher = <T,>(path: string) => apiFetch<T>(path)

function formatBytes(bytes: number): string {
    if (bytes < 0) return 'unknown'
    const gib = bytes / (1 << 30)
    return gib >= 1 ? `${gib.toFixed(1)} GiB` : `${(bytes / (1 << 20)).toFixed(0)} MiB`
}

function inviteLink(code: string): string {
    return `${window.location.origin}${import.meta.env.BASE_URL}join#${code}`
}

/** Owner-only: members, invites and server health. Loaded lazily. */
const AdminPage = () => {
    useDocumentTitle('Community - VideoScroll')
    const session = useSession()

    const status = useSWR<ServerStatus>('/api/admin/status', fetcher, { refreshInterval: 15_000 })
    const members = useSWR<{ users: PublicUser[] }>('/api/admin/users', fetcher)
    const invites = useSWR<{ invites: InviteView[] }>('/api/admin/invites', fetcher)

    const [inviteRole, setInviteRole] = useState<Role>('viewer')
    const [inviteDays, setInviteDays] = useState(7)
    const [newLink, setNewLink] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Captured once per mount; good enough to label invites as expired.
    const [now] = useState(() => Date.now())

    const run = async (action: () => Promise<unknown>) => {
        setError(null)
        try {
            await action()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Something went wrong')
        }
    }

    const createInvite = () =>
        run(async () => {
            const result = await apiFetch<{ code: string }>('/api/admin/invites', {
                method: 'POST',
                json: { role: inviteRole, expiresInDays: inviteDays },
            })
            setNewLink(inviteLink(result.code))
            setCopied(false)
            await invites.mutate()
        })

    const copyLink = async () => {
        if (!newLink) return
        try {
            await navigator.clipboard.writeText(newLink)
            setCopied(true)
        } catch {
            setCopied(false)
        }
    }

    const updateUser = (id: string, patch: Partial<Pick<PublicUser, 'role' | 'disabled'>>) =>
        run(async () => {
            await apiFetch(`/api/admin/users/${id}`, { method: 'PATCH', json: patch })
            await members.mutate()
        })

    const revoke = (id: string) =>
        run(() => apiFetch(`/api/admin/users/${id}/revoke`, { method: 'POST' }))

    const deleteInvite = (id: string) =>
        run(async () => {
            await apiFetch(`/api/admin/invites/${id}`, { method: 'DELETE' })
            await invites.mutate()
        })

    if (session?.user.role !== 'owner') {
        return (
            <div className={styles.page}>
                <p>Only the owner can manage the community.</p>
                <Link to="/profile">Back</Link>
            </div>
        )
    }

    const s = status.data
    const lowDisk = s ? s.diskFreeBytes >= 0 && s.diskFreeBytes < s.minFreeBytes * 1.5 : false

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <Link to="/profile" className={styles.back}>
                    ← Profile
                </Link>
                <h1>Community</h1>
            </header>

            {error && <p className={styles.error}>{error}</p>}

            <section className={styles.section}>
                <h2>Server</h2>
                {s ? (
                    <dl className={styles.stats}>
                        <div>
                            <dt>Videos</dt>
                            <dd>{s.videos}</dd>
                        </div>
                        <div>
                            <dt>Members</dt>
                            <dd>{s.users}</dd>
                        </div>
                        <div className={lowDisk ? styles.warn : ''}>
                            <dt>Free disk</dt>
                            <dd>{formatBytes(s.diskFreeBytes)}</dd>
                        </div>
                        <div>
                            <dt>Processing</dt>
                            <dd>
                                {s.queue.current ? '1 running' : 'idle'}
                                {s.queue.waiting > 0 && `, ${s.queue.waiting} waiting`}
                            </dd>
                        </div>
                        <div className={s.queue.failed > 0 ? styles.warn : ''}>
                            <dt>Failed</dt>
                            <dd>{s.queue.failed}</dd>
                        </div>
                        <div>
                            <dt>Uptime</dt>
                            <dd>{s.uptime}</dd>
                        </div>
                    </dl>
                ) : (
                    <p className={styles.muted}>{status.error ? 'Server unreachable' : 'Loading…'}</p>
                )}
            </section>

            <section className={styles.section}>
                <h2>Invite someone</h2>
                <div className={styles.row}>
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                        {ROLES.map((role) => (
                            <option key={role} value={role}>
                                {role}
                            </option>
                        ))}
                    </select>
                    <select value={inviteDays} onChange={(e) => setInviteDays(Number(e.target.value))}>
                        {[1, 3, 7, 14, 30].map((d) => (
                            <option key={d} value={d}>
                                expires in {d} day{d > 1 ? 's' : ''}
                            </option>
                        ))}
                    </select>
                    <button type="button" className={styles.primary} onClick={createInvite}>
                        Create link
                    </button>
                </div>
                {newLink && (
                    <div className={styles.linkBox}>
                        <code>{newLink}</code>
                        <button type="button" onClick={copyLink}>
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                        <p className={styles.muted}>
                            Shown once. It works for a single account; send it privately.
                        </p>
                    </div>
                )}

                <ul className={styles.list}>
                    {(invites.data?.invites ?? []).map((inv) => {
                        const expired = Date.parse(inv.expiresAt) < now
                        return (
                            <li key={inv.id}>
                                <span>
                                    <strong>{inv.role}</strong> invite ·{' '}
                                    {inv.usedBy
                                        ? `used by @${inv.usedBy}`
                                        : expired
                                          ? 'expired'
                                          : `expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                                </span>
                                {!inv.usedBy && (
                                    <button type="button" onClick={() => deleteInvite(inv.id)}>
                                        {expired ? 'Remove' : 'Revoke'}
                                    </button>
                                )}
                            </li>
                        )
                    })}
                </ul>
            </section>

            <section className={styles.section}>
                <h2>Members</h2>
                <ul className={styles.list}>
                    {(members.data?.users ?? []).map((user) => {
                        const isSelf = user.id === session.user.id
                        return (
                            <li key={user.id} className={user.disabled ? styles.disabled : ''}>
                                <span>
                                    @{user.username}
                                    {isSelf && <em> (you)</em>}
                                </span>
                                <div className={styles.row}>
                                    <select
                                        value={user.role}
                                        onChange={(e) => updateUser(user.id, { role: e.target.value as Role })}
                                        aria-label={`Role for ${user.username}`}
                                    >
                                        {ROLES.map((role) => (
                                            <option key={role} value={role}>
                                                {role}
                                            </option>
                                        ))}
                                    </select>
                                    {!isSelf && (
                                        <>
                                            <button type="button" onClick={() => revoke(user.id)}>
                                                Sign out
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateUser(user.id, { disabled: !user.disabled })}
                                            >
                                                {user.disabled ? 'Enable' : 'Disable'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            </section>
        </div>
    )
}

export default AdminPage
