import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { UploadStatus, VideosResponse } from '../src/types/api'
import { OWNER_STATE, apiFetch, apiLogin, ownerToken } from './helpers'

async function signIn(page: Page, login: string, password: string) {
    await page.goto('login')
    await page.getByLabel('رقم الهاتف أو اسم المستخدم').fill(login)
    await page.getByLabel('كلمة المرور').fill(password)
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
}

function memberRow(page: Page, username: string) {
    return page
        .locator('li')
        .filter({ hasText: `@${username}` })
        .filter({ has: page.getByRole('combobox') })
}

test('owner adds a member by phone number; they must choose a password at first sign-in', async ({ browser }) => {
    const owner = await browser.newContext({ storageState: OWNER_STATE })
    const ownerPage = await owner.newPage()
    await ownerPage.goto('admin')

    await ownerPage.getByLabel('رقم الهاتف').fill('050 123 4567')
    await ownerPage.getByLabel('الاسم', { exact: true }).fill('Ahmed')
    await ownerPage.getByLabel('الصلاحية', { exact: true }).selectOption('uploader')
    await ownerPage.getByRole('button', { name: 'توليد' }).click()
    const temporary = await ownerPage.getByLabel('كلمة المرور المؤقتة').inputValue()
    expect(temporary).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
    await ownerPage.getByRole('button', { name: 'إنشاء حساب' }).click()

    // The message to send contains everything the person needs.
    const message = await ownerPage.locator('pre').textContent()
    expect(message).toContain('مرحباً Ahmed، حسابك في VideoScroll جاهز.')
    expect(message).toContain('رقم الهاتف: 0501234567')
    expect(message).toContain(`كلمة المرور المؤقتة: ${temporary}`)
    expect(message).toMatch(/تسجيل الدخول: http:\/\/localhost:4175\/videoscroll\/login/)

    const row = memberRow(ownerPage, '+966501234567')
    await expect(row).toContainText('Ahmed')
    await expect(row).toContainText('كلمة مرور مؤقتة')
    await expect(row.getByRole('combobox')).toHaveValue('uploader')

    // Ahmed signs in typing the number his own way.
    const member = await browser.newContext()
    const memberPage = await member.newPage()
    await signIn(memberPage, '+966 50 123 4567', temporary)
    await expect(memberPage.getByRole('heading', { name: 'اختر كلمة المرور الخاصة بك' })).toBeVisible()

    // Nothing else is reachable yet, even by URL.
    await memberPage.goto('profile')
    await expect(memberPage.getByRole('heading', { name: 'اختر كلمة المرور الخاصة بك' })).toBeVisible()

    await memberPage.getByLabel('كلمة المرور المؤقتة').fill(temporary)
    await memberPage.getByLabel('كلمة المرور الجديدة', { exact: true }).fill('ahmeds-own-password')
    await memberPage.getByLabel('تأكيد كلمة المرور الجديدة').fill('ahmeds-own-password')
    await memberPage.getByRole('button', { name: 'حفظ ومتابعة' }).click()

    // Back to the page he had asked for, now as a full member.
    await expect(memberPage.getByRole('heading', { name: 'Ahmed', level: 1 })).toBeVisible()
    await expect(memberPage.getByText('@+966501234567 · ناشر')).toBeVisible()
    await expect(memberPage.getByRole('button', { name: 'رفع فيديو' })).toBeVisible()
    await memberPage.goto('')
    await expect(memberPage.locator('#videos__container video').first()).toBeVisible()
    expect((await apiLogin('0501234567', 'ahmeds-own-password')).user.mustChangePassword).toBeFalsy()

    // --- The owner resets the password: Ahmed is signed out and must choose again.
    await ownerPage.reload()
    await memberRow(ownerPage, '+966501234567').getByRole('button', { name: 'إعادة تعيين كلمة المرور' }).click()
    await ownerPage.getByRole('button', { name: 'توليد' }).last().click()
    const reset = await ownerPage.getByLabel('كلمة المرور المؤقتة').last().inputValue()
    await ownerPage.getByRole('button', { name: 'تعيين كلمة مرور مؤقتة' }).click()
    await expect(ownerPage.locator('pre')).toContainText('تم إعادة تعيين كلمة المرور لحسابك في VideoScroll')

    await memberPage.reload()
    await expect(memberPage).toHaveURL(/\/login$/)
    await signIn(memberPage, '0501234567', reset)
    await expect(memberPage.getByRole('heading', { name: 'اختر كلمة المرور الخاصة بك' })).toBeVisible()

    // --- And finally removes the account.
    ownerPage.once('dialog', (dialog) => dialog.accept())
    await memberRow(ownerPage, '+966501234567').getByRole('button', { name: 'حذف' }).click()
    await expect(memberRow(ownerPage, '+966501234567')).toHaveCount(0)
    const gone = await apiFetch('/api/auth/login', {
        method: 'POST',
        json: { username: '0501234567', password: reset },
    })
    expect(gone.status).toBe(401)

    await Promise.all([owner.close(), member.close()])
})

test('the owner renames and deletes any video from the profile page', async ({ browser }) => {
    // A video of its own to delete, so the other specs keep their clips.
    const bytes = fs.readFileSync('videos/clip3.mp4')
    const created = await apiFetch<UploadStatus>('/api/uploads', {
        method: 'POST',
        token: ownerToken(),
        json: { fileName: 'to-be-deleted.mp4', size: bytes.length, lastModified: Date.now() },
    })
    await apiFetch<UploadStatus>(`/api/uploads/${created.body.uploadId}`, {
        method: 'PUT',
        token: ownerToken(),
        headers: { 'Upload-Offset': '0' },
        body: bytes,
    })
    await expect
        .poll(async () => (await apiFetch<UploadStatus>(`/api/uploads/${created.body.uploadId}`, { token: ownerToken() })).body.state)
        .toBe('ready')

    const owner = await browser.newContext({ storageState: OWNER_STATE })
    const page = await owner.newPage()
    await page.goto('profile')
    await expect(page.getByRole('heading', { name: /^جميع الفيديوهات \(\d+\)$/ })).toBeVisible()

    // Rename.
    page.once('dialog', (dialog) => dialog.accept('Going away soon'))
    await page.getByRole('button', { name: 'تعديل اسم to-be-deleted' }).click()
    await expect(page.getByRole('heading', { name: 'Going away soon' })).toBeVisible()
    const list = await apiFetch<VideosResponse>('/api/videos', { token: ownerToken() })
    expect(list.body.data.some((v) => v.title === 'Going away soon')).toBe(true)

    // Delete.
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'حذف Going away soon' }).click()
    await expect(page.getByRole('heading', { name: 'Going away soon' })).toHaveCount(0)
    const after = await apiFetch<VideosResponse>('/api/videos', { token: ownerToken() })
    expect(after.body.data.some((v) => v.title === 'Going away soon')).toBe(false)

    await owner.close()
})
