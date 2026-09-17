import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import Layout from './components/layout'
import { useSession } from './hooks/useSession'
import { IS_DEMO } from './lib/apiUrl'
import ChoosePasswordPage from './routes/choosePassword'
import FeedPage from './routes/feed'
import JoinPage from './routes/join'
import LikesPage from './routes/likes'
import LoginPage from './routes/login'
import ProfilePage from './routes/profile'
import SavedPage from './routes/saved'
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
                <Route path="/likes" element={<LikesPage />} />
                <Route path="/saved" element={<SavedPage />} />
                <Route path="/profile" element={<ProfilePage />} />
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
