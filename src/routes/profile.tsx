import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import useSWR from 'swr'
import { useDialog } from '../hooks/useDialog'
import VideoCard from '../components/videoCard'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSession, useSessionActions } from '../hooks/useSession'
import { useSocialStorage } from '../hooks/useSocialStorage'
import { VIDEOS_CHANGED_EVENT, useVideos } from '../hooks/useVideos'
import { loginHint } from '../lib/accounts'
import { apiFetch } from '../lib/session'
import type { PublicUser } from '../types/api'
import authStyles from './auth.module.css'
import styles from './sharedGrid.module.css'

const ROLE_LABEL = { owner: 'المالك', uploader: 'ناشر', viewer: 'عضو' } as const

const ProfilePage = () => {
    useDocumentTitle('الملف الشخصي - VideoScroll')

    const session = useSession()
    const { logout, logoutEverywhere, changePassword } = useSessionActions()
    const { videos, social: serverSocial, isDemo } = useVideos()
    const [social] = useSocialStorage(serverSocial)
    const dialog = useDialog()

    const [showPassword, setShowPassword] = useState(false)
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

    const user = session?.user
    const isOwner = !isDemo && user?.role === 'owner'
    const canUpload = user?.role === 'owner' || user?.role === 'uploader'
    const myVideos = isDemo ? videos : videos.filter((v) => v.uploaderId && v.uploaderId === user?.id)
    // The owner manages every video from here; everyone else, their own.
    const managedVideos = isOwner ? videos : myVideos

    // Uploader names for the owner's list.
    const members = useSWR<{ users: PublicUser[] }>(isOwner ? '/api/admin/users' : null, (path: string) =>
        apiFetch<{ users: PublicUser[] }>(path)
    )
    const uploaderName = (uploaderId?: string) => {
        if (!uploaderId) return 'أضيف من الخادم'
        if (uploaderId === user?.id) return 'أنت'
        const member = members.data?.users.find((u) => u.id === uploaderId)
        return member ? member.displayName || loginHint(member.username) : 'عضو محذوف'
    }

    const totalLikes = videos.reduce((acc, v) => acc + (social[v.videoId]?.likes ?? 0), 0)
    const totalSaved = videos.reduce((acc, v) => acc + (social[v.videoId]?.bookmarks ?? 0), 0)

    const submitPassword = async (event: FormEvent) => {
        event.preventDefault()
        setMessage(null)
        try {
            await changePassword(currentPassword, newPassword)
            setCurrentPassword('')
            setNewPassword('')
            setShowPassword(false)
            setMessage({ ok: true, text: 'تم تغيير كلمة المرور. تم تسجيل الخروج من الأجهزة الأخرى.' })
        } catch (caught) {
            setMessage({ ok: false, text: caught instanceof Error ? caught.message : 'تعذر تغيير كلمة المرور' })
        }
    }

    const signOutEverywhere = async () => {
        try {
            await logoutEverywhere()
        } catch (caught) {
            setMessage({ ok: false, text: caught instanceof Error ? caught.message : 'تعذر تسجيل الخروج' })
        }
    }

    const deleteVideo = async (videoId: string, title: string) => {
        const confirmed = await dialog.confirm({
            title: 'حذف الفيديو؟',
            message: `سيُحذف «${title}» للجميع، ولا يمكن التراجع عن ذلك.`,
            confirmLabel: 'حذف',
            danger: true,
        })
        if (!confirmed) return
        try {
            await apiFetch(`/api/videos/${videoId}`, { method: 'DELETE' })
            window.dispatchEvent(new Event(VIDEOS_CHANGED_EVENT))
        } catch (caught) {
            setMessage({ ok: false, text: caught instanceof Error ? caught.message : 'تعذر حذف الفيديو' })
        }
    }

    const renameVideo = async (videoId: string, title: string) => {
        const next = await dialog.prompt({
            title: 'تعديل اسم الفيديو',
            label: 'العنوان',
            initial: title,
            confirmLabel: 'حفظ',
            maxLength: 120,
        })
        if (next === null || next.trim() === '' || next.trim() === title) return
        try {
            await apiFetch(`/api/videos/${videoId}`, { method: 'PATCH', json: { title: next.trim() } })
            window.dispatchEvent(new Event(VIDEOS_CHANGED_EVENT))
        } catch (caught) {
            setMessage({ ok: false, text: caught instanceof Error ? caught.message : 'تعذر تعديل الاسم' })
        }
    }

    const name = user?.displayName ?? 'زائر تجريبي'

    return (
        <div className={styles.container}>
            {dialog.element}
            <header className={styles.profileHeader}>
                <div className={styles.profileHeader__avatar}>
                    <div className={styles.profileHeader__avatarInner}>{name.charAt(0).toUpperCase()}</div>
                </div>

                <div className={styles.profileHeader__info}>
                    <h1>{name}</h1>
                    <p>
                        {user ? (
                            <>
                                <bdi>@{user.username}</bdi> · {ROLE_LABEL[user.role]}
                            </>
                        ) : (
                            'تسجيل الدخول معطل في الوضع التجريبي'
                        )}
                    </p>
                </div>

                <div className={styles.profileStats}>
                    <div className={styles.profileStat}>
                        <span className={styles.profileStat__value}>{myVideos.length}</span>
                        <span className={styles.profileStat__label}>المرفوعات</span>
                    </div>
                    <div className={styles.profileStat}>
                        <span className={styles.profileStat__value}>{totalLikes}</span>
                        <span className={styles.profileStat__label}>الإعجابات</span>
                    </div>
                    <div className={styles.profileStat}>
                        <span className={styles.profileStat__value}>{totalSaved}</span>
                        <span className={styles.profileStat__label}>المحفوظات</span>
                    </div>
                </div>

                {user && (
                    <div className={styles.profileActions}>
                        {user.role === 'owner' && (
                            <Link to="/admin" className={styles.profileAction}>
                                إدارة المجتمع
                            </Link>
                        )}
                        <button type="button" className={styles.profileAction} onClick={() => setShowPassword((v) => !v)}>
                            تغيير كلمة المرور
                        </button>
                        <button type="button" className={styles.profileAction} onClick={logout}>
                            تسجيل الخروج
                        </button>
                        <button type="button" className={styles.profileAction} onClick={signOutEverywhere}>
                            تسجيل الخروج من كل الأجهزة
                        </button>
                    </div>
                )}

                {showPassword && (
                    <form className={styles.profileForm} onSubmit={submitPassword}>
                        <input
                            className={authStyles.input}
                            type="password"
                            placeholder="كلمة المرور الحالية"
                            autoComplete="current-password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                        />
                        <input
                            className={authStyles.input}
                            type="password"
                            placeholder="كلمة المرور الجديدة (10 أحرف أو أكثر)"
                            autoComplete="new-password"
                            minLength={10}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                        />
                        <button type="submit" className={`${authStyles.button} ${authStyles.button_primary}`}>
                            حفظ
                        </button>
                    </form>
                )}

                {message && <p className={message.ok ? authStyles.success : authStyles.error}>{message.text}</p>}
            </header>

            <main>
                <h2 className={styles.profileSectionTitle}>
                    {isOwner ? `جميع الفيديوهات (${managedVideos.length})` : 'مرفوعاتي'}
                </h2>
                {isOwner && managedVideos.length > 0 && (
                    <p className={styles.profileSectionHint}>
                        بصفتك المالك يمكنك تعديل اسم أو حذف أي فيديو.
                    </p>
                )}

                {managedVideos.length > 0 ? (
                    <div className={styles.grid}>
                        {managedVideos.map((video) => (
                            <VideoCard
                                key={video.videoId}
                                video={video}
                                subtitle={isOwner ? uploaderName(video.uploaderId) : undefined}
                                onRename={isDemo ? undefined : () => renameVideo(video.videoId, video.title)}
                                onDelete={isDemo ? undefined : () => deleteVideo(video.videoId, video.title)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <h2>{isOwner ? 'لا توجد فيديوهات بعد' : 'لا توجد مرفوعات بعد'}</h2>
                        <p>
                            {canUpload
                                ? 'اضغط على زر "+" في شريط التنقل لرفع أول فيديو لك.'
                                : 'حسابك يتيح المشاهدة فقط دون الرفع. تواصل مع المالك إذا كنت ترغب في نشر فيديوهات.'}
                        </p>
                    </div>
                )}
            </main>
        </div>
    )
}

export default ProfilePage
