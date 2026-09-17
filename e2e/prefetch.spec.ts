import { expect, test } from '@playwright/test'
import { OWNER_STATE, cachedEntries, expectPlaying, feedIds } from './helpers'

test.use({ storageState: OWNER_STATE })

test('upcoming videos are prefetched and served by the service worker, and sign-out wipes them', async ({ page }) => {
    await page.goto('')
    // The service worker takes control on first install; reload so the app
    // starts with a controller, which is when prefetching switches on.
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

    const ids = await feedIds(page)
    const next = ids[1]

    // The head of the next video lands in IndexedDB.
    await expect
        .poll(async () => (await cachedEntries(page)).find((e) => e.key === next)?.headChunks ?? 0, {
            timeout: 20_000,
        })
        .toBeGreaterThan(0)
    // The current video is not prefetched: the player is already loading it.
    expect((await cachedEntries(page)).some((e) => e.key === ids[0])).toBe(false)

    // A fresh page load: the next video's opening range must now come from the
    // service worker, not the network.
    const fromWorker = page.waitForResponse(
        (response) => response.url().includes(`/api/video/${next}`) && response.fromServiceWorker()
    )
    await page.reload()
    const response = await fromWorker
    expect(response.status()).toBe(206)
    expect(response.headers()['content-range']).toMatch(/^bytes 0-\d+\/\d+$/)

    // And the spliced cache+network response is actually playable.
    await page.locator('#videos__container').evaluate((el) => el.scrollBy({ top: el.clientHeight }))
    await expectPlaying(page, next)

    // Signing out leaves nothing from the community on the device.
    await page.goto('profile')
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect.poll(async () => (await cachedEntries(page)).length).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('videoscroll_session'))).toBeNull()
})
