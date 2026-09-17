import fs from 'node:fs'
import { expect, test, type Download } from '@playwright/test'
import type { VideosResponse } from '../src/types/api'
import { OWNER_STATE, apiFetch, ownerToken } from './helpers'

/** The whole published file arrived. */
async function expectComplete(download: Download, size: number) {
    expect(fs.statSync(await download.path()).size).toBe(size)
}

test('members download the original file from the feed and from the profile page', async ({ browser }) => {
    const { body } = await apiFetch<VideosResponse>('/api/videos', { token: ownerToken() })
    const first = body.data[0]

    const owner = await browser.newContext({ storageState: OWNER_STATE, acceptDownloads: true })
    const page = await owner.newPage()

    // Feed: the button next to like, save and share.
    await page.goto('')
    await expect(page.locator('#videos__container video').first()).toBeVisible()
    const [fromFeed] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'تنزيل الفيديو' }).first().click(),
    ])
    // Named after the title, with the original extension.
    expect(fromFeed.suggestedFilename()).toBe(`${first.title}.mp4`)
    await expectComplete(fromFeed, first.size)
    // The app did not navigate away.
    await expect(page.locator('#videos__container video').first()).toBeVisible()

    // Profile: the button next to rename and delete.
    await page.goto('profile')
    const [fromProfile] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: `تنزيل ${first.title}` }).click(),
    ])
    expect(fromProfile.suggestedFilename()).toBe(`${first.title}.mp4`)
    await expectComplete(fromProfile, first.size)
    await expect(page).toHaveURL(/\/profile$/)

    await owner.close()
})
