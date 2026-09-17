import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import Layout from './components/layout'
import { useSession } from './hooks/useSession'
import { IS_DEMO } from './lib/apiUrl'
import FeedPage from './routes/feed'
import JoinPage from './routes/join'
import LikesPage from './routes/likes'
import LoginPage from './routes/login'
import ProfilePage from './routes/profile'
import SavedPage from './routes/saved'

// Owner-only, so kept out of the bundle every member downloads.
const AdminPage = lazy(() => import('./routes/admin'))

/**
 * Nothing but the sign-in and join screens is reachable without a session.
 * This is a convenience, not the security boundary: every API route and every
 * media byte is authorized by the server.
 */
export default function App() {
    const session = useSession()

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
