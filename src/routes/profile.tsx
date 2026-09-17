import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import VideoCard from '../components/videoCard'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSession, useSessionActions } from '../hooks/useSession'
import { useSocialStorage } from '../hooks/useSocialStorage'
import { VIDEOS_CHANGED_EVENT, useVideos } from '../hooks/useVideos'
import { apiFetch } from '../lib/session'
import authStyles from './auth.module.css'
import styles from './sharedGrid.module.css'

const ROLE_LABEL = { owner: 'Owner', uploader: 'Uploader', viewer: 'Member' } as const

const ProfilePage = () => {
    useDocumentTitle('My Profile - VideoScroll')

    const session = useSession()
    const { logout, logoutEverywhere, changePassword } = useSessionActions()
    const { videos, social: serverSocial, isDemo } = useVideos()
    const [social] = useSocialStorage(serverSocial)

    const [showPassword, setShowPassword] = useState(false)
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

    const user = session?.user
    const myVideos = isDemo ? videos : videos.filter((v) => v.uploaderId && v.uploaderId === user?.id)
    const canUpload = user?.role === 'owner' || user?.role === 'uploader'

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
            setMessage({ ok: true, text: 'Password changed. Other devices were signed out.' })
        } catch (caught) {
            setMessage({ ok: false, text: caught instanceof Error ? caught.message : 'Could not change password' })
        }
    }

    const signOutEverywhere = async () => {
        try {
            await logoutEverywhere()
        } catch (caught) {
            setMessage({ ok: false, text: caught instanceof Error ? caught.message : 'Could not sign out' })
        }
    }

    const deleteVideo = async (videoId: string, title: string) => {
        if (!window.confirm(`Delete “${title}” for everyone? This cannot be undone.`)) return
        try {
            await apiFetch(`/api/videos/${videoId}`, { method: 'DELETE' })
            window.dispatchEvent(new Event(VIDEOS_CHANGED_EVENT))
        } catch (caught) {
            setMessage({ ok: false, text: caught instanceof Error ? caught.message : 'Could not delete' })
        }
    }

    const name = user?.displayName ?? 'Demo viewer'

    return (
        <div className={styles.container}>
            <header className={styles.profileHeader}>
                <div className={styles.profileHeader__avatar}>
                    <div className={styles.profileHeader__avatarInner}>{name.charAt(0).toUpperCase()}</div>
                </div>

                <div className={styles.profileHeader__info}>
                    <h1>{name}</h1>
                    <p>{user ? `@${user.username} · ${ROLE_LABEL[user.role]}` : 'Sign-in is disabled in demo mode'}</p>
                </div>

                <div className={styles.profileStats}>
                    <div className={styles.profileStat}>
                        <span className={styles.profileStat__value}>{myVideos.length}</span>
                        <span className={styles.profileStat__label}>Uploads</span>
                    </div>
                    <div className={styles.profileStat}>
                        <span className={styles.profileStat__value}>{totalLikes}</span>
                        <span className={styles.profileStat__label}>Likes</span>
                    </div>
                    <div className={styles.profileStat}>
                        <span className={styles.profileStat__value}>{totalSaved}</span>
                        <span className={styles.profileStat__label}>Saved</span>
                    </div>
                </div>

                {user && (
                    <div className={styles.profileActions}>
                        {user.role === 'owner' && (
                            <Link to="/admin" className={styles.profileAction}>
                                Manage community
                            </Link>
                        )}
                        <button type="button" className={styles.profileAction} onClick={() => setShowPassword((v) => !v)}>
                            Change password
                        </button>
                        <button type="button" className={styles.profileAction} onClick={logout}>
                            Sign out
                        </button>
                        <button type="button" className={styles.profileAction} onClick={signOutEverywhere}>
                            Sign out everywhere
                        </button>
                    </div>
                )}

                {showPassword && (
                    <form className={styles.profileForm} onSubmit={submitPassword}>
                        <input
                            className={authStyles.input}
                            type="password"
                            placeholder="Current password"
                            autoComplete="current-password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                        />
                        <input
                            className={authStyles.input}
                            type="password"
                            placeholder="New password (10+ characters)"
                            autoComplete="new-password"
                            minLength={10}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                        />
                        <button type="submit" className={`${authStyles.button} ${authStyles.button_primary}`}>
                            Save
                        </button>
                    </form>
                )}

                {message && <p className={message.ok ? authStyles.success : authStyles.error}>{message.text}</p>}
            </header>

            <main>
                <h2 className={styles.profileSectionTitle}>My Uploads</h2>

                {myVideos.length > 0 ? (
                    <div className={styles.grid}>
                        {myVideos.map((video) => (
                            <VideoCard
                                key={video.videoId}
                                video={video}
                                onDelete={isDemo ? undefined : () => deleteVideo(video.videoId, video.title)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <h2>No uploads yet</h2>
                        <p>
                            {canUpload
                                ? 'Tap the “+” button in the navigation bar to upload your first video.'
                                : 'Your account can watch but not upload. Ask the owner if you want to share videos.'}
                        </p>
                    </div>
                )}
            </main>
        </div>
    )
}

export default ProfilePage
