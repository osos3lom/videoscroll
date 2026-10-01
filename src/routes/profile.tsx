import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { MdBookmarkBorder, MdFavoriteBorder, MdOutlineVideoLibrary } from 'react-icons/md'
import useSWR from 'swr'
import { useDialog } from '../hooks/useDialog'
import ShareList from '../components/shareList'
import VideoCard from '../components/videoCard'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import MediaTile from '../components/mediaTile'
import { type MediaEntry, useMediaLookup, videoEntry } from '../hooks/useMedia'
import { useReactions } from '../hooks/useReactions'
import { useSession, useSessionActions } from '../hooks/useSession'
import { VIDEOS_CHANGED_EVENT } from '../hooks/useVideos'
import { loginHint } from '../lib/accounts'
import { downloadVideo } from '../lib/download'
import { apiFetch } from '../lib/session'
import type { PublicUser } from '../types/api'
import authStyles from './auth.module.css'
import profileStyles from './profile.module.css'
import styles from './sharedGrid.module.css'

const ROLE_LABEL = { owner: 'المالك', uploader: 'ناشر', viewer: 'عضو' } as const

const PROFILE_TABS = ['videos', 'saved', 'liked'] as const
type ProfileTab = (typeof PROFILE_TABS)[number]

const TAB_LABEL: Record<ProfileTab, string> = { videos: 'الفيديوهات', saved: 'المحفوظات', liked: 'الإعجابات' }
const TAB_ICON = { videos: MdOutlineVideoLibrary, saved: MdBookmarkBorder, liked: MdFavoriteBorder }

/** Media in the order of `ids`, skipping any that is gone or hidden. */
function pick(byId: Map<string, MediaEntry>, ids: string[]): MediaEntry[] {
    return ids.flatMap((id) => byId.get(id) ?? [])
}

const ProfilePage = () => {
    useDocumentTitle('الملف الشخصي - VideoScroll')

    const params = useParams()
    const navigate = useNavigate()
    const tab = (params.tab ?? 'videos') as ProfileTab
    const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

    const session = useSession()
    const { logout, logoutEverywhere, changePassword } = useSessionActions()
    const { byId, videos: videoList } = useMediaLookup()
    const { videos, social: serverSocial, isDemo, isLoading } = videoList
    const reactions = useReactions(serverSocial)
    const dialog = useDialog()

    // The owner starts on every video, as before tabs: imported videos have
    // no uploader, and this is where the owner manages them.
    const [showAllChoice, setShowAll] = useState<boolean | null>(null)
    const [showPassword, setShowPassword] = useState(false)
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

    const user = session?.user
    const isOwner = !isDemo && user?.role === 'owner'
    const showAll = isOwner && (showAllChoice ?? true)
    const canUpload = user?.role === 'owner' || user?.role === 'uploader'
    const myVideos = isDemo ? videos : videos.filter((v) => v.uploaderId && v.uploaderId === user?.id)
    // The owner can switch to every video, to manage them from here.
    const listedVideos = isOwner && showAll ? videos : myVideos
    const savedMedia = pick(byId, reactions.savedIds)
    const likedMedia = pick(byId, reactions.likedIds)

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

    if (!PROFILE_TABS.includes(tab)) return <Navigate to="/profile" replace />

    const selectTab = (next: ProfileTab) => {
        navigate(next === 'videos' ? '/profile' : `/profile/${next}`, { replace: true })
    }

    // Arrow keys move between tabs. The page is right-to-left, so the next
    // tab is to the left.
    const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        const index = PROFILE_TABS.indexOf(tab)
        let next = -1
        if (event.key === 'ArrowLeft') next = (index + 1) % PROFILE_TABS.length
        if (event.key === 'ArrowRight') next = (index - 1 + PROFILE_TABS.length) % PROFILE_TABS.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = PROFILE_TABS.length - 1
        if (next < 0) return
        event.preventDefault()
        selectTab(PROFILE_TABS[next])
        tabRefs.current[PROFILE_TABS[next]]?.focus()
    }

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
    const counts: Record<ProfileTab, number> = {
        videos: myVideos.length,
        saved: savedMedia.length,
        liked: likedMedia.length,
    }

    const emptyText: Record<ProfileTab, { title: string; text: string }> = {
        videos: {
            title: isOwner && showAll ? 'لا توجد فيديوهات بعد' : 'لا توجد مرفوعات بعد',
            text: canUpload
                ? 'اضغط على زر "+" في شريط التنقل لرفع أول فيديو لك.'
                : 'حسابك يتيح المشاهدة فقط دون الرفع. تواصل مع المالك إذا كنت ترغب في نشر فيديوهات.',
        },
        saved: {
            title: 'لا توجد عناصر محفوظة بعد',
            text: 'اضغط على رمز الحفظ في أي فيديو أو صورة ليظهر هنا.',
        },
        liked: {
            title: 'لا توجد إعجابات بعد',
            text: 'اضغط على رمز القلب في أي فيديو أو صورة ليظهر هنا.',
        },
    }

    const shown: MediaEntry[] =
        tab === 'videos' ? listedVideos.map(videoEntry) : tab === 'saved' ? savedMedia : likedMedia

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
                    {PROFILE_TABS.map((key) => (
                        <div key={key} className={styles.profileStat}>
                            <span className={styles.profileStat__value}>{counts[key]}</span>
                            <span className={styles.profileStat__label}>{TAB_LABEL[key]}</span>
                        </div>
                    ))}
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

            <div className={profileStyles.tabs} role="tablist" aria-label="محتوى الملف الشخصي">
                {PROFILE_TABS.map((key) => {
                    const Icon = TAB_ICON[key]
                    const selected = key === tab
                    return (
                        <button
                            key={key}
                            ref={(el) => {
                                tabRefs.current[key] = el
                            }}
                            type="button"
                            role="tab"
                            id={`profile-tab-${key}`}
                            aria-selected={selected}
                            aria-controls="profile-panel"
                            tabIndex={selected ? 0 : -1}
                            className={`${profileStyles.tab} ${selected ? profileStyles.tab_selected : ''}`}
                            onClick={() => selectTab(key)}
                            onKeyDown={onTabKeyDown}
                        >
                            <Icon size={20} aria-hidden="true" />
                            <span>{TAB_LABEL[key]}</span>
                        </button>
                    )
                })}
            </div>

            <main id="profile-panel" role="tabpanel" aria-labelledby={`profile-tab-${tab}`}>
                {tab === 'videos' && isOwner && (
                    <div className={profileStyles.chips}>
                        <button
                            type="button"
                            className={`${profileStyles.chip} ${!showAll ? profileStyles.chip_selected : ''}`}
                            aria-pressed={!showAll}
                            onClick={() => setShowAll(false)}
                        >
                            مرفوعاتي
                        </button>
                        <button
                            type="button"
                            className={`${profileStyles.chip} ${showAll ? profileStyles.chip_selected : ''}`}
                            aria-pressed={showAll}
                            onClick={() => setShowAll(true)}
                        >
                            كل الفيديوهات ({videos.length})
                        </button>
                    </div>
                )}
                {tab === 'videos' && (
                    <h2 className={`${styles.profileSectionTitle} ${profileStyles.sectionTitle}`}>
                        {showAll ? `جميع الفيديوهات (${videos.length})` : 'مرفوعاتي'}
                    </h2>
                )}
                {tab === 'videos' && showAll && shown.length > 0 && (
                    <p className={styles.profileSectionHint}>بصفتك المالك يمكنك تعديل اسم أو حذف أي فيديو.</p>
                )}

                {shown.length > 0 ? (
                    <div className={styles.grid}>
                        {shown.map((entry) => {
                            if (!entry.video) {
                                return (
                                    <MediaTile
                                        key={entry.id}
                                        media={entry}
                                        tall
                                        to={`/images/all?item=${encodeURIComponent(entry.id)}`}
                                    />
                                )
                            }
                            const video = entry.video
                            const manage = tab === 'videos' && !isDemo
                            return (
                                <VideoCard
                                    key={video.videoId}
                                    video={video}
                                    subtitle={isOwner && showAll && tab === 'videos' ? uploaderName(video.uploaderId) : undefined}
                                    onDownload={() => downloadVideo(video)}
                                    onRename={manage ? () => renameVideo(video.videoId, video.title) : undefined}
                                    onDelete={manage ? () => deleteVideo(video.videoId, video.title) : undefined}
                                />
                            )
                        })}
                    </div>
                ) : isLoading || (tab !== 'videos' && reactions.mode === 'loading') ? (
                    <div className={styles.empty}>
                        <p>جارٍ التحميل…</p>
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <h2>{emptyText[tab].title}</h2>
                        <p>{emptyText[tab].text}</p>
                    </div>
                )}

                {tab === 'videos' && !isDemo && (
                    <>
                        <h2 className={styles.profileSectionTitle}>روابط المشاركة</h2>
                        <p className={styles.profileSectionHint}>
                            {isOwner
                                ? 'الروابط العامة التي أنشأها جميع الأعضاء. أوقف أي رابط لم يعد مطلوباً.'
                                : 'الروابط العامة التي أنشأتها لمشاركة الفيديوهات. أوقف أي رابط لم يعد مطلوباً.'}
                        </p>
                        <div className={styles.profileShares}>
                            <ShareList showCreator={isOwner} />
                        </div>
                    </>
                )}
            </main>
        </div>
    )
}

export default ProfilePage
