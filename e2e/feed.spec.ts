import { expect, test } from '@playwright/test'
import { OWNER_STATE, collectErrors, expectPlaying, feedIds } from './helpers'

test.use({ storageState: OWNER_STATE })

test('the feed plays and pages through videos from the cross-origin API', async ({ page }) => {
    const errors = collectErrors(page)
    const mediaStatuses: number[] = []
    page.on('response', (response) => {
        if (response.url().includes('/api/video/')) mediaStatuses.push(response.status())
    })

    await page.goto('')
    const ids = await feedIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(3)

    // Media URLs carry the media token and point at the API origin.
    const src = await page.locator(`[id="${ids[0]}"] video`).getAttribute('src')
    expect(src).toMatch(/^http:\/\/localhost:3101\/api\/video\/v-[\w-]+\?t=/)

    await expectPlaying(page, ids[0])

    // Next video: keyboard on desktop, swipe-equivalent scroll on mobile.
    await page.locator('#videos__container').evaluate((el) => el.scrollBy({ top: el.clientHeight }))
    await expectPlaying(page, ids[1])

    // Only one video plays at a time.
    const playing = await page.$$eval('video', (videos) => videos.filter((v) => !v.paused).length)
    expect(playing).toBe(1)

    // Posters load through the media token too.
    const poster = await page.locator(`[id="${ids[0]}"] video`).getAttribute('poster')
    const posterStatus = await page.evaluate(async (url) => (await fetch(url!)).status, poster)
    expect(posterStatus).toBe(200)

    expect(mediaStatuses.every((status) => status === 200 || status === 206)).toBe(true)
    expect(errors).toEqual([])
})
