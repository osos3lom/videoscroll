import { expect, test } from '@playwright/test'

test.describe('sign-in gate', () => {
    test('a signed-out visitor only ever sees the sign-in screen', async ({ page }) => {
        for (const path of ['', 'likes', 'profile', 'admin']) {
            await page.goto(path)
            await expect(page).toHaveURL(/\/videoscroll\/login$/)
            await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
        }
        // No video data leaks into a signed-out page.
        await expect(page.locator('video')).toHaveCount(0)
    })

    test('wrong password is refused, right password opens the feed', async ({ page }) => {
        const username = process.env.E2E_OWNER_USERNAME!
        const password = process.env.E2E_OWNER_PASSWORD!

        await page.goto('login')
        await page.getByLabel('Username').fill(username)
        await page.getByLabel('Password').fill('definitely-not-the-password')
        await page.getByRole('button', { name: 'Sign in' }).click()
        await expect(page.getByText('incorrect username or password')).toBeVisible()

        await page.getByLabel('Password').fill(password)
        await page.getByRole('button', { name: 'Sign in' }).click()

        await expect(page).toHaveURL(/\/videoscroll\/?$/)
        await expect(page.locator('#videos__container video').first()).toBeVisible()
        await expect(page.getByRole('button', { name: 'Upload video' })).toBeVisible()
    })
})
