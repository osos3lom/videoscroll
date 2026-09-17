import fs from 'node:fs'
import { E2E_DIR, OWNER_STATE, apiLogin, sessionStorageState } from './helpers'

/**
 * Starts a fresh simulation for the run and signs the owner in once through
 * the API. Tests reuse that session via storage state, so the login rate
 * limit is only spent by the tests that exercise the login form itself.
 */
export default async function globalSetup() {
    // Dynamic import: Playwright compiles this file to CommonJS, which cannot
    // require() the ES module.
    const { startSimulation } = await import('../scripts/simulate.mjs')
    const sim = await startSimulation({
        dir: E2E_DIR,
        apiPort: 3101,
        webPort: 4175,
        fresh: true,
        quiet: !process.env.E2E_VERBOSE,
    })

    process.env.E2E_API = sim.apiOrigin
    process.env.E2E_WEB = sim.webOrigin
    process.env.E2E_OWNER_USERNAME = sim.credentials.username
    process.env.E2E_OWNER_PASSWORD = sim.credentials.password

    const session = await apiLogin(sim.credentials.username, sim.credentials.password)
    process.env.E2E_OWNER_TOKEN = session.token
    fs.writeFileSync(OWNER_STATE, JSON.stringify(sessionStorageState(session)))

    // Returned function is Playwright's global teardown.
    return async () => {
        await sim.stop()
    }
}
