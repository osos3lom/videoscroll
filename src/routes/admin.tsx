import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import useSWR from 'swr'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSession } from '../hooks/useSession'
import { accountMessage, generateTemporaryPassword, loginHint } from '../lib/accounts'
import { apiFetch } from '../lib/session'
import type { InviteView, PublicUser, Role, ServerStatus } from '../types/api'
import styles from './admin.module.css'

const ROLES: Role[] = ['viewer', 'uploader', 'owner']

const ROLE_TITLE: Record<Role, string> = {
    viewer: 'عضو',
    uploader: 'ناشر',
    owner: 'المالك',
}

const ROLE_HELP: Record<Role, string> = {
    viewer: 'يمكنه المشاهدة فقط',
    uploader: 'يمكنه المشاهدة والرفع وتعديل أو حذف فيديوهاته الخاصة',
    owner: 'لديه كافة الصلاحيات، بما في ذلك إدارة الأعضاء وجميع الفيديوهات',
}

const fetcher = <T,>(path: string) => apiFetch<T>(path)

function formatBytes(bytes: number): string {
    if (bytes < 0) return 'غير معروف'
    const gib = bytes / (1 << 30)
    return gib >= 1 ? `${gib.toFixed(1)} ج.ب` : `${(bytes / (1 << 20)).toFixed(0)} م.ب`
}

function inviteLink(code: string): string {
    return `${window.location.origin}${import.meta.env.BASE_URL}join#${code}`
}

/** A ready-to-send message with a copy button. */
function ShareBox({ text, onClose }: { text: string; onClose: () => void }) {
    const [copied, setCopied] = useState(false)
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
        } catch {
            setCopied(false)
        }
    }
    return (
        <div className={styles.shareBox} role="status">
            <pre>{text}</pre>
            <div className={styles.row}>
                <button type="button" className={styles.primary} onClick={copy}>
                    {copied ? 'تم النسخ' : 'نسخ الرسالة'}
                </button>
                <button type="button" onClick={onClose}>
                    تم
                </button>
            </div>
            <p className={styles.muted}>
                أرسلها عبر وسيلة خاصة (واتساب، رسالة نصية). تُعرض كلمة المرور هذه المرة فقط.
            </p>
        </div>
    )
}

/** Password field with a Generate button, used for new accounts and resets. */
function TemporaryPasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className={styles.row}>
            <input
                className={styles.input}
                aria-label="كلمة المرور المؤقتة"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="كلمة مرور مؤقتة (10 أحرف أو أكثر)"
                autoComplete="off"
                spellCheck={false}
                minLength={10}
                required
            />
            <button type="button" onClick={() => onChange(generateTemporaryPassword())}>
                توليد
            </button>
        </div>
    )
}

/** Owner-only: members, invites and server health. Loaded lazily. */
const AdminPage = () => {
    useDocumentTitle('إدارة المجتمع - VideoScroll')
    const session = useSession()

    const status = useSWR<ServerStatus>('/api/admin/status', fetcher, { refreshInterval: 15_000 })
    const members = useSWR<{ users: PublicUser[] }>('/api/admin/users', fetcher)
    const invites = useSWR<{ invites: InviteView[] }>('/api/admin/invites', fetcher)

    const [error, setError] = useState<string | null>(null)
    const [share, setShare] = useState<string | null>(null)

    // Add-member form
    const [phone, setPhone] = useState('')
    const [name, setName] = useState('')
    const [newRole, setNewRole] = useState<Role>('viewer')
    const [tempPassword, setTempPassword] = useState('')
    const [creating, setCreating] = useState(false)

    // Per-member password reset
    const [resetFor, setResetFor] = useState<string | null>(null)
    const [resetPassword, setResetPassword] = useState('')

    // Invites
    const [inviteRole, setInviteRole] = useState<Role>('viewer')
    const [inviteDays, setInviteDays] = useState(7)
    const [newLink, setNewLink] = useState<string | null>(null)
    const [linkCopied, setLinkCopied] = useState(false)
    // Captured once per mount; good enough to label invites as expired.
    const [now] = useState(() => Date.now())

    const run = async (action: () => Promise<unknown>) => {
        setError(null)
        try {
            await action()
            return true
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'حدث خطأ ما')
            return false
        }
    }

    const createMember = async (event: FormEvent) => {
        event.preventDefault()
        setCreating(true)
        await run(async () => {
            const { user } = await apiFetch<{ user: PublicUser }>('/api/admin/users', {
                method: 'POST',
                json: { username: phone, displayName: name, password: tempPassword, role: newRole },
            })
            setShare(
                accountMessage({ name: user.displayName, username: user.username, password: tempPassword, isNew: true })
            )
            setPhone('')
            setName('')
            setTempPassword('')
            setNewRole('viewer')
            await members.mutate()
        })
        setCreating(false)
    }

    const saveReset = (user: PublicUser) =>
        run(async () => {
            await apiFetch(`/api/admin/users/${user.id}/password`, {
                method: 'POST',
                json: { password: resetPassword },
            })
            setShare(
                accountMessage({ name: user.displayName, username: user.username, password: resetPassword, isNew: false })
            )
            setResetFor(null)
            setResetPassword('')
            await members.mutate()
        })

    const updateUser = (id: string, patch: Partial<Pick<PublicUser, 'role' | 'disabled' | 'displayName'>>) =>
        run(async () => {
            await apiFetch(`/api/admin/users/${id}`, { method: 'PATCH', json: patch })
            await members.mutate()
        })

    const renameUser = (user: PublicUser) => {
        const next = window.prompt(`الاسم الجديد لحساب ${loginHint(user.username)}`, user.displayName)
        if (next !== null && next.trim() !== '' && next !== user.displayName) {
            void updateUser(user.id, { displayName: next })
        }
    }

    const deleteUser = (user: PublicUser) => {
        if (!window.confirm(`هل تريد بالتأكيد حذف حساب ${user.displayName} (${loginHint(user.username)})؟ ستبقى فيديوهاته كما هي.`)) {
            return
        }
        void run(async () => {
            await apiFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
            await members.mutate()
        })
    }

    const revoke = (id: string) => run(() => apiFetch(`/api/admin/users/${id}/revoke`, { method: 'POST' }))

    const createInvite = () =>
        run(async () => {
            const result = await apiFetch<{ code: string }>('/api/admin/invites', {
                method: 'POST',
                json: { role: inviteRole, expiresInDays: inviteDays },
            })
            setNewLink(inviteLink(result.code))
            setLinkCopied(false)
            await invites.mutate()
        })

    const copyLink = async () => {
        if (!newLink) return
        try {
            await navigator.clipboard.writeText(newLink)
            setLinkCopied(true)
        } catch {
            setLinkCopied(false)
        }
    }

    const deleteInvite = (id: string) =>
        run(async () => {
            await apiFetch(`/api/admin/invites/${id}`, { method: 'DELETE' })
            await invites.mutate()
        })

    if (session?.user.role !== 'owner') {
        return (
            <div className={styles.page}>
                <p>المالك فقط هو من يمكنه إدارة المجتمع.</p>
                <Link to="/profile">رجوع</Link>
            </div>
        )
    }

    const s = status.data
    const lowDisk = s ? s.diskFreeBytes >= 0 && s.diskFreeBytes < s.minFreeBytes * 1.5 : false

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <Link to="/profile" className={styles.back}>
                    → الملف الشخصي
                </Link>
                <h1>المجتمع</h1>
                <p className={styles.muted}>
                    إضافة أشخاص، وتعديل صلاحياتهم، وإعادة تعيين كلمات المرور. تتم إدارة الفيديوهات
                    من صفحة <Link to="/profile">الملف الشخصي</Link>.
                </p>
            </header>

            {error && <p className={styles.error}>{error}</p>}
            {share && <ShareBox text={share} onClose={() => setShare(null)} />}

            <section className={styles.section}>
                <h2>إضافة عضو</h2>
                <form className={styles.form} onSubmit={createMember}>
                    <input
                        className={styles.input}
                        aria-label="رقم الهاتف"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="رقم الهاتف، مثل 05XXXXXXXX"
                        inputMode="tel"
                        autoComplete="off"
                        required
                    />
                    <input
                        className={styles.input}
                        aria-label="الاسم"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="الاسم (اختياري)"
                        autoComplete="off"
                        maxLength={48}
                    />
                    <label className={styles.row}>
                        <span>الصلاحية</span>
                        <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} aria-label="الصلاحية">
                            {ROLES.map((role) => (
                                <option key={role} value={role}>
                                    {ROLE_TITLE[role]}
                                </option>
                            ))}
                        </select>
                        <span className={styles.inlineHelp}>{ROLE_HELP[newRole]}</span>
                    </label>
                    <TemporaryPasswordInput value={tempPassword} onChange={setTempPassword} />
                    <button
                        type="submit"
                        className={styles.primary}
                        disabled={creating || !phone || tempPassword.length < 10}
                    >
                        {creating ? 'جارٍ الإنشاء…' : 'إنشاء حساب'}
                    </button>
                    <p className={styles.muted}>
                        يسجل العضو دخوله برقم الهاتف هذا وكلمة المرور المؤقتة، ثم يختار كلمة المرور
                        الخاصة به.
                    </p>
                </form>
            </section>

            <section className={styles.section}>
                <h2>الأعضاء</h2>
                <ul className={styles.list}>
                    {(members.data?.users ?? []).map((user) => {
                        const isSelf = user.id === session.user.id
                        return (
                            <li key={user.id} className={user.disabled ? styles.disabled : ''}>
                                <div className={styles.who}>
                                    <strong>{user.displayName}</strong>
                                    <span>
                                        <bdi>@{user.username}</bdi>
                                    </span>
                                    {isSelf && <em> (أنت)</em>}
                                    {user.mustChangePassword && (
                                        <span className={styles.badge}>كلمة مرور مؤقتة</span>
                                    )}
                                    {user.disabled && <span className={styles.badge}>معطل</span>}
                                </div>
                                <div className={styles.row}>
                                    <select
                                        value={user.role}
                                        onChange={(e) => updateUser(user.id, { role: e.target.value as Role })}
                                        aria-label={`صلاحية ${user.username}`}
                                    >
                                        {ROLES.map((role) => (
                                            <option key={role} value={role}>
                                                {ROLE_TITLE[role]}
                                            </option>
                                        ))}
                                    </select>
                                    <button type="button" onClick={() => renameUser(user)}>
                                        تعديل الاسم
                                    </button>
                                    {!isSelf && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setResetFor(resetFor === user.id ? null : user.id)
                                                    setResetPassword('')
                                                }}
                                            >
                                                إعادة تعيين كلمة المرور
                                            </button>
                                            <button type="button" onClick={() => revoke(user.id)}>
                                                تسجيل الخروج
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateUser(user.id, { disabled: !user.disabled })}
                                            >
                                                {user.disabled ? 'تفعيل' : 'تعطيل'}
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.danger}
                                                onClick={() => deleteUser(user)}
                                            >
                                                حذف
                                            </button>
                                        </>
                                    )}
                                </div>
                                {resetFor === user.id && (
                                    <form
                                        className={styles.form}
                                        onSubmit={(e) => {
                                            e.preventDefault()
                                            void saveReset(user)
                                        }}
                                    >
                                        <TemporaryPasswordInput value={resetPassword} onChange={setResetPassword} />
                                        <button
                                            type="submit"
                                            className={styles.primary}
                                            disabled={resetPassword.length < 10}
                                        >
                                            تعيين كلمة مرور مؤقتة
                                        </button>
                                        <p className={styles.muted}>
                                            يتم تسجيل خروجهم من كافة الأجهزة؛ ويختارون كلمة مرور جديدة عند
                                            تسجيل دخولهم التالي.
                                        </p>
                                    </form>
                                )}
                            </li>
                        )
                    })}
                </ul>
            </section>

            <section className={styles.section}>
                <h2>روابط الدعوة</h2>
                <p className={styles.muted}>
                    طريقة بديلة لإضافة عضو: يختار رقم هاتفه أو اسم المستخدم وكلمة المرور بنفسه.
                </p>
                <div className={styles.row}>
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                        {ROLES.map((role) => (
                            <option key={role} value={role}>
                                {ROLE_TITLE[role]}
                            </option>
                        ))}
                    </select>
                    <select value={inviteDays} onChange={(e) => setInviteDays(Number(e.target.value))}>
                        {[1, 3, 7, 14, 30].map((d) => (
                            <option key={d} value={d}>
                                ينتهي خلال {d} {d === 1 ? 'يوم' : d === 2 ? 'يومين' : d <= 10 ? 'أيام' : 'يوماً'}
                            </option>
                        ))}
                    </select>
                    <button type="button" className={styles.primary} onClick={createInvite}>
                        إنشاء رابط
                    </button>
                </div>
                {newLink && (
                    <div className={styles.linkBox}>
                        <code>{newLink}</code>
                        <button type="button" onClick={copyLink}>
                            {linkCopied ? 'تم النسخ' : 'نسخ'}
                        </button>
                        <p className={styles.muted}>
                            يُعرض مرة واحدة ويعمل لإنشاء حساب واحد فقط؛ أرسله في رسالة خاصة.
                        </p>
                    </div>
                )}

                <ul className={styles.list}>
                    {(invites.data?.invites ?? []).map((inv) => {
                        const expired = Date.parse(inv.expiresAt) < now
                        return (
                            <li key={inv.id}>
                                <span>
                                    دعوة بصلاحية <strong>{ROLE_TITLE[inv.role] || inv.role}</strong> ·{' '}
                                    {inv.usedBy
                                        ? <>تم استخدامها بواسطة <bdi>@{inv.usedBy}</bdi></>
                                        : expired
                                          ? 'منتهية الصلاحية'
                                          : `تنتهي في ${new Date(inv.expiresAt).toLocaleDateString('ar-SA')}`}
                                </span>
                                {!inv.usedBy && (
                                    <button type="button" onClick={() => deleteInvite(inv.id)}>
                                        {expired ? 'إزالة' : 'إلغاء'}
                                    </button>
                                )}
                            </li>
                        )
                    })}
                </ul>
            </section>

            <section className={styles.section}>
                <h2>الخادم</h2>
                {s ? (
                    <dl className={styles.stats}>
                        <div>
                            <dt>الفيديوهات</dt>
                            <dd>{s.videos}</dd>
                        </div>
                        <div>
                            <dt>الأعضاء</dt>
                            <dd>{s.users}</dd>
                        </div>
                        <div className={lowDisk ? styles.warn : ''}>
                            <dt>المساحة المتاحة</dt>
                            <dd>{formatBytes(s.diskFreeBytes)}</dd>
                        </div>
                        <div>
                            <dt>قيد المعالجة</dt>
                            <dd>
                                {s.queue.current ? '1 قيد التشغيل' : 'خامل'}
                                {s.queue.waiting > 0 && `، ${s.queue.waiting} في الانتظار`}
                            </dd>
                        </div>
                        <div className={s.queue.failed > 0 ? styles.warn : ''}>
                            <dt>فشل</dt>
                            <dd>{s.queue.failed}</dd>
                        </div>
                        <div>
                            <dt>مدة التشغيل</dt>
                            <dd>{s.uptime}</dd>
                        </div>
                    </dl>
                ) : (
                    <p className={styles.muted}>{status.error ? 'تعذر الاتصال بالخادم' : 'جارٍ التحميل…'}</p>
                )}
            </section>
        </div>
    )
}

export default AdminPage
