import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { CollectionsResponse, ImagesResponse } from '../src/types/api'
import { E2E_DIR, apiFetch, createMember, sessionStorageState } from './helpers'

const dir = path.join(E2E_DIR, 'batch')

/** `count` copies of a file under distinct names, so each is its own upload. */
function copies(source: string, prefix: string, ext: string, count: number): string[] {
    fs.mkdirSync(dir, { recursive: true })
    return Array.from({ length: count }, (_, i) => {
        const file = path.join(dir, `${prefix}-${i + 1}${ext}`)
        fs.copyFileSync(source, file)
        return file
    })
}

let photo: string

test.beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true })
    photo = path.join(dir, 'source.jpg')
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1', photo])
})

test.describe('batch uploads', () => {
    test('six videos picked at once: five are queued, and the limit is explained', async ({ browser }) => {
        const member = await createMember('uploader')
        const context = await browser.newContext({ storageState: sessionStorageState(member.session) })
        const page = await context.newPage()
        // Hold every upload open, so nothing reaches the shared feed.
        await page.route('**/api/uploads', () => undefined)

        await page.goto('profile')
        const files = copies('videos/clip1.mp4', 'six', '.mp4', 6)
        await page.getByLabel('اختيار فيديوهات').setInputFiles(files)

        const queue = page.getByRole('region', { name: 'قائمة الرفع' })
        await expect(queue.getByRole('listitem')).toHaveCount(5)
        await expect(queue.getByRole('alert')).toContainText('الحد 5 فيديوهات في الدفعة الواحدة')
        await expect(queue.getByText('six-6.mp4')).toHaveCount(0)
        // Two go at once; the rest wait their turn.
        await expect(queue.getByText('في الانتظار')).toHaveCount(3)

        // Cancel removes items, waiting or not.
        for (const name of ['six-5.mp4', 'six-1.mp4']) {
            await queue.getByRole('button', { name: `إلغاء ${name}` }).click()
        }
        await expect(queue.getByRole('listitem')).toHaveCount(3)
        await context.close()
    })

    test('twenty-one photos: twenty upload with progress, and can go into a new category', async ({ browser }) => {
        const member = await createMember('uploader')
        const token = member.session.token
        const context = await browser.newContext({ storageState: sessionStorageState(member.session) })
        const page = await context.newPage()

        await page.goto('images')
        await page.getByLabel('اختيار صور').setInputFiles(copies(photo, 'p', '.jpg', 21))

        const queue = page.getByRole('region', { name: 'قائمة الرفع' })
        await expect(queue.getByRole('listitem')).toHaveCount(20)
        await expect(queue.getByRole('alert')).toContainText('أُضيف أول 20')
        await expect(queue.getByText('تم النشر بنجاح')).toHaveCount(20, { timeout: 60_000 })

        // They are in "all my images" without doing anything else.
        await expect(page.getByRole('link', { name: 'كل صوري' })).toContainText('20 صورة')
        const images = await apiFetch<ImagesResponse>('/api/images', { token })
        expect(images.body.data).toHaveLength(20)

        // One tap offers to file the new photos.
        await queue.getByRole('button', { name: 'أضف الصور الجديدة (20) إلى تصنيف' }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'تصنيف جديد' }).click()
        await page.getByLabel('الاسم').fill('دفعة الاختبار')
        await page.getByRole('button', { name: 'حفظ' }).click()
        await expect
            .poll(async () => {
                const list = await apiFetch<CollectionsResponse>('/api/collections?section=images', { token })
                return list.body.collections.find((c) => c.title === 'دفعة الاختبار')?.itemCount
            })
            .toBe(20)
        await context.close()
    })

    test('a failed upload shows its error and succeeds on retry', async ({ browser }) => {
        const member = await createMember('uploader')
        const context = await browser.newContext({ storageState: sessionStorageState(member.session) })
        const page = await context.newPage()
        let failing = true
        await page.route('**/api/uploads/*', async (route) => {
            if (failing && route.request().method() === 'PUT') {
                await route.fulfill({ status: 400, json: { error: 'chunk too large', code: 'upload_invalid' } })
                return
            }
            await route.continue()
        })

        await page.goto('images')
        await page.getByLabel('اختيار صور').setInputFiles(copies(photo, 'retry', '.jpg', 1))
        const queue = page.getByRole('region', { name: 'قائمة الرفع' })
        await expect(queue.getByText('حدث خطأ أثناء الرفع')).toBeVisible()

        failing = false
        await queue.getByRole('button', { name: 'إعادة محاولة retry-1.jpg' }).click()
        await expect(queue.getByText('تم النشر بنجاح')).toBeVisible({ timeout: 30_000 })
        await context.close()
    })
})
