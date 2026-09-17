import { expect, test, type Locator, type Page } from '@playwright/test'
import { OWNER_STATE, expectPlaying, feedIds } from './helpers'

test.use({ storageState: OWNER_STATE })

const time = (video: Locator) => video.evaluate((el: HTMLVideoElement) => el.currentTime)
const paused = (video: Locator) => video.evaluate((el: HTMLVideoElement) => el.paused)

async function setTime(video: Locator, seconds: number) {
    await video.evaluate(
        (el: HTMLVideoElement, t) =>
            new Promise<void>((resolve) => {
                el.addEventListener('seeked', () => resolve(), { once: true })
                el.currentTime = t
            }),
        seconds
    )
}

/** The first feed video, playing, with its tap target's box. */
async function firstVideo(page: Page) {
    await page.goto('')
    const [id] = await feedIds(page)
    await expectPlaying(page, id)
    const item = page.locator(`[id="${id}"]`)
    const video = item.locator('video')
    const target = item.getByRole('button', { name: /^(تشغيل الفيديو|إيقاف الفيديو مؤقتاً)$/ })
    const box = (await target.boundingBox())!
    // Away from the sidebar (left, middle height) and the top buttons.
    const at = (fx: number, fy = 0.3) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })
    const duration = await video.evaluate((el: HTMLVideoElement) => el.duration)
    return { id, video, box, at, duration }
}

test('touch: double tap skips, tap pauses, horizontal drag scrubs, vertical swipe still scrolls', async ({
    page,
}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'touch gestures run on the mobile project')
    const { video, at, duration } = await firstVideo(page)
    expect(duration).toBeGreaterThan(11)
    const cdp = await page.context().newCDPSession(page)

    const touch = async (points: { x: number; y: number }[]) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] })
        for (const point of points.slice(1)) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const doubleTap = async (point: { x: number; y: number }) => {
        await touch([point])
        await touch([point])
    }

    // Double tap on the right third: +10 s, with feedback.
    await setTime(video, 1)
    await doubleTap(at(0.85))
    await expect(page.getByText('+10', { exact: true })).toBeVisible()
    expect(await time(video)).toBeGreaterThan(10.5)
    expect(await paused(video)).toBe(false)

    // Double tap on the left third: −10 s.
    const before = await time(video)
    await doubleTap(at(0.15))
    await expect(page.getByText('−10', { exact: true })).toBeVisible()
    const after = await time(video)
    expect(after).toBeLessThan(before - 8)
    expect(after).toBeGreaterThanOrEqual(0)

    // A tap in the middle pauses at once; another resumes.
    await touch([at(0.5)])
    await expect.poll(() => paused(video)).toBe(true)
    await touch([at(0.5)])
    await expect.poll(() => paused(video)).toBe(false)

    // A single tap on a side pauses too, just after the double-tap window.
    await page.waitForTimeout(700)
    await touch([at(0.85)])
    await expect.poll(() => paused(video)).toBe(true)
    await touch([at(0.5)])
    await expect.poll(() => paused(video)).toBe(false)

    // Horizontal drag from 20% to 80% of the width: 60% of the video later.
    await setTime(video, 0)
    const steps = Array.from({ length: 13 }, (_, i) => at(0.2 + (0.6 * i) / 12, 0.5))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [steps[0]] })
    for (const point of steps.slice(1)) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
    }
    // The time readout shows while dragging, and the video holds still.
    await expect(page.getByText(/^\d+:\d{2} \/ \d+:\d{2}$/)).toBeVisible()
    expect(await paused(video)).toBe(true)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const scrubbed = await time(video)
    expect(scrubbed).toBeGreaterThan(duration * 0.6 - 1.5)
    expect(scrubbed).toBeLessThan(duration * 0.6 + 1.5)
    await expect(page.getByText(/^\d+:\d{2} \/ \d+:\d{2}$/)).toHaveCount(0)
    await expect.poll(() => paused(video)).toBe(false)

    // A vertical swipe (with a little sideways wobble) moves the feed and never
    // turns into a scrub.
    const container = page.locator('#videos__container')
    const swipe = Array.from({ length: 10 }, (_, i) => at(0.5 + (i % 2) * 0.01, 0.8 - i * 0.06))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [swipe[0]] })
    for (const point of swipe.slice(1)) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
    }
    await expect(page.getByText(/^\d+:\d{2} \/ \d+:\d{2}$/)).toHaveCount(0)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => container.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    // It left the screen, so the feed stopped it as usual.
    await expect.poll(() => paused(video)).toBe(true)
})

test('mouse and keyboard: double click skips, arrow keys seek', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'mouse and keyboard run on the desktop project')
    const { video, at } = await firstVideo(page)

    await setTime(video, 1)
    const right = at(0.85)
    await page.mouse.dblclick(right.x, right.y)
    await expect.poll(() => time(video)).toBeGreaterThan(10.5)
    expect(await paused(video)).toBe(false)

    const before = await time(video)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => time(video)).toBeLessThan(before - 4)
    const mid = await time(video)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => time(video)).toBeGreaterThan(mid + 4)

    // A single click in the middle still pauses.
    const middle = at(0.5)
    await page.mouse.click(middle.x, middle.y)
    await expect.poll(() => paused(video)).toBe(true)
})
