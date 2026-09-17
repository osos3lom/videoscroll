import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { registerServiceWorker } from './lib/serviceWorker'
import './styles/globals.css'

const container = document.getElementById('root')
if (!container) {
    throw new Error('index.html is missing its #root element')
}

/**
 * Vite's `base`, so the same bundle works both at the root (development) and
 * under /videoscroll/ (GitHub Pages).
 *
 * The trailing slash has to go: with `basename="/videoscroll/"`, react-router
 * strips the prefix down to `likes` rather than `/likes`, which matches no route
 * and silently falls through to the catch-all.
 */
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

registerServiceWorker()

createRoot(container).render(
    <StrictMode>
        <BrowserRouter basename={basename}>
            <App />
        </BrowserRouter>
    </StrictMode>
)
