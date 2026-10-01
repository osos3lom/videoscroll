import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import Layout from './components/layout'
import { useSession } from './hooks/useSession'
import { IS_DEMO } from './lib/apiUrl'
import ChoosePasswordPage from './routes/choosePassword'
import FeedPage from './routes/feed'
import JoinPage from './routes/join'
import LoginPage from './routes/login'
import ProfilePage from './routes/profile'
import WatchPage from './routes/watch'

// Owner-only, so kept out of the bundle every member downloads.
const AdminPage = lazy(() => import('./routes/admin'))

/**
 * A shared video's public page is outside every gate: it is meant for people
 * without an account, and members who open a link see the same page.
 */
export default function App() {
    return (
        <Routes>
            <Route path="/watch" element={<WatchPage />} />
            <Route path="*" element={<MemberApp />} />
        </Routes>
    )
}

/**
 * Nothing but the sign-in and join screens is reachable without a session.
 * This is a convenience, not the security boundary: every API route and every
 * media byte is authorized by the server.
 */
function MemberApp() {
    const session = useSession()

    // An owner-set temporary password must be replaced before anything else;
    // the server refuses every other request until then.
    if (!IS_DEMO && session?.user.mustChangePassword) {
        return <ChoosePasswordPage />
    }

    if (!IS_DEMO && !session) {
        return (
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/join" element={<JoinPage />} />
                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        )
    }

    return (
        <Layout>
            <Routes>
                <Route path="/" element={<FeedPage />} />
                <Route path="/profile/:tab?" element={<ProfilePage />} />
                {/* Saved and Liked moved into the profile; old links keep working. */}
                <Route path="/likes" element={<Navigate to="/profile/liked" replace />} />
                <Route path="/saved" element={<Navigate to="/profile/saved" replace />} />
                {!IS_DEMO && (
                    <Route
                        path="/admin"
                        element={
                            <Suspense fallback={null}>
                                <AdminPage />
                            </Suspense>
                        }
                    />
                )}
                {/*
                 * Covers /login and /join after signing in, and the paths Pages
                 * serves through 404.html. Redirect rather than render the feed
                 * in place, so the URL and the content never disagree.
                 */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Layout>
    )
}
