import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { VideosResponse } from '../src/types/api'
import { OWNER_STATE, apiFetch, ownerToken } from './helpers'

test('a member shares one video publicly, a stranger watches and downloads it, then the link is stopped', async ({
    browser,
}) => {
    const { body } = await apiFetch<VideosResponse>('/api/videos', { token: ownerToken() })
    const first = body.data[0]

    // --- The member creates a 1-day link from the feed.
    const member = await browser.newContext({ storageState: OWNER_STATE })
    const memberPage = await member.newPage()
    await memberPage.goto('')
    await expect(memberPage.locator('#videos__container video').first()).toBeVisible()
    await memberPage.getByRole('button', { name: 'مشاركة الفيديو' }).first().click()

    const dialog = memberPage.getByRole('dialog', { name: 'مشاركة الفيديو' })
    await expect(dialog).toContainText(first.title)
    await dialog.getByText('يوم', { exact: true }).click()
    await expect(dialog.getByRole('radio', { name: 'يوم', exact: true })).toBeChecked()
    await dialog.getByRole('button', { name: 'إنشاء الرابط' }).click()
    const link = await dialog.getByLabel('رابط المشاركة').inputValue()
    expect(link).toMatch(/\/videoscroll\/watch#[\w-]{22}$/)
    await dialog.getByRole('button', { name: 'تم' }).click()
    await expect(dialog).toHaveCount(0)

    // --- A stranger, with no account and no stored session, opens it.
    const stranger = await browser.newContext({ acceptDownloads: true })
    const page = await stranger.newPage()
    await page.goto(link)
    await expect(page.getByRole('heading', { name: first.title })).toBeVisible()
    await expect(page.getByText(/^متاح حتى /)).toBeVisible()
    // Only this video: no navigation, no feed, no sign-in wall.
    await expect(page.getByRole('link', { name: 'الرئيسية' })).toHaveCount(0)
    await expect(page.locator('#videos__container')).toHaveCount(0)
    await expect(page).toHaveURL(/\/watch#/)

    const video = page.locator('video')
    await video.evaluate((el: HTMLVideoElement) => {
        el.muted = true
        return el.play()
    })
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0.2)

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('link', { name: 'تنزيل الفيديو' }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`${first.title}.mp4`)
    expect(fs.statSync(await download.path()).size).toBe(first.size)

    // The stranger has no way into the community.
    expect(await page.evaluate(() => localStorage.getItem('videoscroll_session'))).toBeNull()

    // --- The member stops the link from the profile page.
    await memberPage.goto('profile')
    await memberPage
        .getByRole('button', { name: `إيقاف رابط ${first.title}` })
        .first()
        .click()
    await memberPage.getByRole('dialog', { name: 'إيقاف الرابط؟' }).getByRole('button', { name: 'إيقاف' }).click()
    await expect(memberPage.getByRole('button', { name: `إيقاف رابط ${first.title}` })).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'تعذر فتح الفيديو' })).toBeVisible()
    await expect(page.getByText('هذا الرابط غير صالح، أو انتهت صلاحيته، أو أوقفه صاحبه.')).toBeVisible()
    await expect(page.locator('video')).toHaveCount(0)

    await Promise.all([member.close(), stranger.close()])
})
