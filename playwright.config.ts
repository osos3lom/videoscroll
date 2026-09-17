import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests against a local copy of the production topology (see
 * scripts/simulate.mjs): the Pages build on :4175 and the Go API on :3101.
 *
 * Tests run serially in one worker: they share one server, and its upload
 * queue processes one job at a time by design.
 *
 * The installed Google Chrome is used rather than Playwright's bundled
 * Chromium, which ships without the H.264 decoder the videos need. Override
 * with E2E_CHANNEL=msedge.
 */
export default defineConfig({
    testDir: 'e2e',
    globalSetup: './e2e/global-setup.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: 'http://localhost:4175/videoscroll/',
        channel: process.env.E2E_CHANNEL ?? 'chrome',
        trace: 'retain-on-failure',
        // Failure videos need Playwright's own ffmpeg download; traces suffice.
        video: 'off',
    },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
        {
            name: 'mobile',
            testMatch: /feed\.spec\.ts/,
            use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
        },
    ],
})
