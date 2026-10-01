import { expect, test } from '@playwright/test'
import type { Reactions, VideosResponse } from '../src/types/api'
import { OWNER_STATE, apiFetch, createMember, ownerToken, sessionStorageState, web } from './helpers'

test('old Likes and Saved links open the profile tabs', async ({ browser }) => {
    const context = await browser.newContext({ storageState: OWNER_STATE })
    const page = await context.newPage()

    await page.goto('likes')
    await expect(page).toHaveURL(/\/profile\/liked$/)
    await expect(page.getByRole('tab', { name: 'الإعجابات' })).toHaveAttribute('aria-selected', 'true')

    await page.goto('saved')
    await expect(page).toHaveURL(/\/profile\/saved$/)
    await expect(page.getByRole('tab', { name: 'المحفوظات' })).toHaveAttribute('aria-selected', 'true')

    // Tabs are keyboard reachable; in right-to-left the next tab is to the left.
    await page.getByRole('tab', { name: 'المحفوظات' }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page).toHaveURL(/\/profile\/liked$/)

    // The bottom bar no longer carries Likes or Saved.
    await expect(page.getByRole('navigation').getByRole('link', { name: 'الإعجابات' })).toHaveCount(0)
    await context.close()
})

test('a like follows the account: it shows in the Liked tab and on the server', async ({ browser }) => {
    const member = await createMember('viewer')
    const context = await browser.newContext({ storageState: sessionStorageState(member.session) })
    const page = await context.newPage()

    await page.goto('')
    await expect(page.locator('#videos__container video').first()).toBeVisible()
    const firstId = await page.locator('#videos__container > *').first().getAttribute('id')
    await page.getByRole('button', { name: 'إعجاب', exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'إلغاء الإعجاب' }).first()).toBeVisible()

    await expect
        .poll(async () => (await apiFetch<Reactions>('/api/me/reactions', { token: member.session.token })).body.likes.map((e) => e.mediaId))
        .toContain(firstId)

    await page.goto('profile/liked')
    await expect(page.locator(`a[href$="#${firstId}"]`)).toBeVisible()

    // Unliking from the feed empties the tab again.
    await page.goto('')
    await page.getByRole('button', { name: 'إلغاء الإعجاب' }).first().click()
    await page.goto('profile/liked')
    await expect(page.getByText('لا توجد إعجابات بعد')).toBeVisible()
    await context.close()
})

test("a device's old local saves are imported into the account once", async ({ browser }) => {
    const { body } = await apiFetch<VideosResponse>('/api/videos', { token: ownerToken() })
    const saved = body.data[1].videoId
    const member = await createMember('viewer')

    const state = sessionStorageState(member.session)
    state.origins[0].localStorage.push({
        name: 'videoscroll_social',
        value: JSON.stringify({ [saved]: { likes: 0, bookmarks: 1 }, 'v-Z29uZS5tcDQ': { likes: 1, bookmarks: 0 } }),
    })
    const context = await browser.newContext({ storageState: state })
    const page = await context.newPage()

    await page.goto('profile/saved')
    await expect(page.locator(`a[href$="#${saved}"]`)).toBeVisible()
    await expect
        .poll(async () => (await apiFetch<Reactions>('/api/me/reactions', { token: member.session.token })).body.saves.length)
        .toBe(1)

    // A fresh device for the same account sees the save without any local data.
    const other = await browser.newContext({ storageState: sessionStorageState(member.session) })
    const otherPage = await other.newPage()
    await otherPage.goto(`${web()}/videoscroll/profile/saved`)
    await expect(otherPage.locator(`a[href$="#${saved}"]`)).toBeVisible()

    await context.close()
    await other.close()
})
