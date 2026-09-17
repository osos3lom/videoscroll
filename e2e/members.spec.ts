import { expect, test } from '@playwright/test'
import { OWNER_STATE, apiFetch, createMember, randomPassword, sessionStorageState } from './helpers'

test.describe('community membership', () => {
    test('owner invites a viewer who joins through the link and cannot upload or administer', async ({ browser }) => {
        const owner = await browser.newContext({ storageState: OWNER_STATE })
        const ownerPage = await owner.newPage()
        await ownerPage.goto('profile')
        await ownerPage.getByRole('link', { name: 'إدارة المجتمع' }).click()
        await expect(ownerPage.getByRole('heading', { name: 'المجتمع' })).toBeVisible()

        await ownerPage.getByRole('button', { name: 'إنشاء رابط' }).click()
        const link = (await ownerPage.locator('code').textContent())!.trim()
        expect(link).toMatch(/\/videoscroll\/join#[\w-]{22}$/)

        // A brand-new browser, as the invited person.
        const guest = await browser.newContext()
        const guestPage = await guest.newPage()
        await guestPage.goto(link)
        await expect(guestPage.getByRole('heading', { name: 'الانضمام إلى المجتمع' })).toBeVisible()
        // The code came from the fragment, so the field is not shown.
        await expect(guestPage.getByLabel('رمز الدعوة')).toHaveCount(0)

        const username = `guest-${Date.now().toString(36)}`
        const password = randomPassword()
        await guestPage.getByLabel('رقم الهاتف أو اسم المستخدم').fill(username)
        await guestPage.getByLabel('كلمة المرور', { exact: true }).fill(password)
        await guestPage.getByLabel('تأكيد كلمة المرور').fill(password)
        await guestPage.getByRole('button', { name: 'إنشاء حساب' }).click()

        await expect(guestPage.locator('#videos__container video').first()).toBeVisible()
        // The spent code is gone from the address bar.
        expect(guestPage.url()).not.toContain('#')
        await expect(guestPage.getByRole('button', { name: 'رفع فيديو' })).toHaveCount(0)

        await guestPage.goto('admin')
        await expect(guestPage.getByText('المالك فقط هو من يمكنه إدارة المجتمع.')).toBeVisible()

        const token = await guestPage.evaluate(
            () => JSON.parse(localStorage.getItem('videoscroll_session')!).token as string
        )
        expect((await apiFetch('/api/admin/users', { token })).status).toBe(403)
        expect((await apiFetch('/api/uploads', { method: 'POST', token, json: {} })).status).toBe(403)

        // The link works exactly once.
        const other = await browser.newContext()
        const otherPage = await other.newPage()
        await otherPage.goto(link)
        await otherPage.getByLabel('رقم الهاتف أو اسم المستخدم').fill(`${username}-2`)
        await otherPage.getByLabel('كلمة المرور', { exact: true }).fill(password)
        await otherPage.getByLabel('تأكيد كلمة المرور').fill(password)
        await otherPage.getByRole('button', { name: 'إنشاء حساب' }).click()
        await expect(otherPage.getByText(/مستخدم مسبقاً/)).toBeVisible()

        // The owner's list shows the new member and the invite as used.
        await ownerPage.reload()
        const memberRows = ownerPage.locator('li').filter({ has: ownerPage.getByRole('combobox') })
        await expect(memberRows.getByText(`@${username}`, { exact: true })).toBeVisible()
        await expect(ownerPage.getByText(`تم استخدامها بواسطة @${username}`)).toBeVisible()

        await Promise.all([owner.close(), guest.close(), other.close()])
    })

    test('disabling a member signs them out on their next request', async ({ browser }) => {
        const member = await createMember('viewer')

        const memberContext = await browser.newContext({ storageState: sessionStorageState(member.session) })
        const memberPage = await memberContext.newPage()
        await memberPage.goto('')
        await expect(memberPage.locator('#videos__container video').first()).toBeVisible()

        const owner = await browser.newContext({ storageState: OWNER_STATE })
        const ownerPage = await owner.newPage()
        await ownerPage.goto('admin')
        // The member list rows are the ones with a role selector; the invite list
        // also mentions the member, as "used by".
        const row = ownerPage
            .locator('li')
            .filter({ hasText: `@${member.username}` })
            .filter({ has: ownerPage.getByRole('combobox') })
        await row.getByRole('button', { name: 'تعطيل' }).click()
        await expect(row.getByRole('button', { name: 'تفعيل' })).toBeVisible()

        // Their existing token is dead: the app drops them to sign-in.
        await memberPage.reload()
        await expect(memberPage).toHaveURL(/\/login$/)
        expect(await memberPage.evaluate(() => localStorage.getItem('videoscroll_session'))).toBeNull()

        // And the password no longer works either.
        const login = await apiFetch('/api/auth/login', {
            method: 'POST',
            json: { username: member.username, password: member.password },
        })
        expect(login.status).toBe(401)

        await Promise.all([owner.close(), memberContext.close()])
    })
})
