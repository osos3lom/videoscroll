import { expect, test, type Page } from '@playwright/test'
import type { CollectionResponse, CollectionsResponse, ImagesResponse, VideosResponse } from '../src/types/api'
import { OWNER_STATE, api, apiFetch, createMember, ownerToken, sessionStorageState, uploadImage, web } from './helpers'

async function videoIds(): Promise<string[]> {
    const { body } = await apiFetch<VideosResponse>('/api/videos', { token: ownerToken() })
    return body.data.map((v) => v.videoId)
}

async function createCollection(token: string, json: Record<string, unknown>) {
    const { status, body } = await apiFetch<CollectionResponse>('/api/collections', { method: 'POST', token, json })
    expect(status).toBe(201)
    return body.collection
}

const counter = (page: Page) => page.getByTestId('item-counter')

test.describe('collections', () => {
    test('create one from existing videos, browse it, and delete it without touching the videos', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'the editor flow runs once, on desktop')
        const before = await videoIds()
        const context = await browser.newContext({ storageState: OWNER_STATE })
        const page = await context.newPage()

        await page.goto('collections')
        await page.getByRole('button', { name: 'مجموعة جديدة' }).click()
        await page.getByLabel('الاسم').fill('مختارات الاختبار')
        await page.getByRole('button', { name: 'إضافة', exact: true }).click()
        await page.getByRole('button', { name: 'كل الفيديوهات' }).click()
        const tiles = page.getByRole('dialog').getByRole('button', { name: /^فيديو: / })
        await tiles.nth(0).click()
        await tiles.nth(1).click()
        await page.getByRole('button', { name: 'إضافة (2)' }).click()
        // Reorder: move the second item up.
        await page.getByRole('button', { name: /للأعلى/ }).nth(1).click()
        await page.getByRole('button', { name: 'حفظ' }).click()

        const card = page.getByRole('link', { name: 'فتح مختارات الاختبار' })
        await expect(card).toBeVisible()
        await expect(card).toContainText('2 عنصر')

        // Browse: the counter follows the arrow keys; the URL follows the item.
        await card.click()
        await expect(counter(page)).toHaveText(/1 \/ 2/)
        await page.keyboard.press('ArrowRight')
        await expect(counter(page)).toHaveText(/2 \/ 2/)
        await expect(page).toHaveURL(/\/collections\/[\w-]+\?item=/)

        // Back returns to the list in one step, however many items were
        // viewed: the button and the browser's own back alike.
        await page.getByRole('button', { name: 'رجوع' }).click()
        await expect(page).toHaveURL(/\/collections$/)
        await card.click()
        await expect(counter(page)).toHaveText(/1 \/ 2/)
        await page.keyboard.press('ArrowRight')
        await expect(counter(page)).toHaveText(/2 \/ 2/)
        await page.goBack()
        await expect(page).toHaveURL(/\/collections$/)
        await card.click()
        await expect(counter(page)).toHaveText(/1 \/ 2/)

        // Opened straight from a link, back goes to the list, not off the app.
        const direct = page.url()
        const fresh = await context.newPage()
        await fresh.goto(direct)
        await fresh.getByRole('button', { name: 'رجوع' }).click()
        await expect(fresh).toHaveURL(/\/collections$/)
        await fresh.close()

        // Delete from the browser's menu; the videos stay.
        await page.getByRole('button', { name: 'خيارات مختارات الاختبار' }).click()
        await page.getByRole('button', { name: 'حذف المجموعة' }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'حذف' }).click()
        await expect(page).toHaveURL(/\/collections$/)
        await expect(page.getByRole('link', { name: 'فتح مختارات الاختبار' })).toHaveCount(0)
        expect(await videoIds()).toEqual(before)
        await context.close()
    })

    test('touch: a sideways swipe changes the item, an upward swipe changes the collection', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'mobile', 'touch gestures run on the mobile project')
        const member = await createMember('uploader')
        const token = member.session.token
        const [a, b, c] = await videoIds()
        const image = await uploadImage(token, 'swipe.png')
        // Lists are newest change first, so "second" is the top row.
        await createCollection(token, { title: 'الأولى', mediaIds: [a, b, image] })
        await createCollection(token, { title: 'الثانية', mediaIds: [c] })

        const context = await browser.newContext({
            storageState: sessionStorageState(member.session),
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
        })
        const page = await context.newPage()
        const list = await apiFetch<CollectionsResponse>('/api/collections?section=collections', { token })
        const first = list.body.collections.find((x) => x.title === 'الأولى')!
        await page.goto(`collections/${first.id}`)
        await expect(counter(page)).toHaveText(/1 \/ 3/)

        // A finger moving by (dx, dy), over the middle of the screen.
        const cdp = await context.newCDPSession(page)
        const swipe = async (dx: number, dy: number) => {
            const start = { x: 195 - dx / 2, y: 420 - dy / 2 }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
            for (let i = 1; i <= 12; i++) {
                const point = { x: start.x + (dx * i) / 12, y: start.y + (dy * i) / 12 }
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        }

        // Swipe left: next item (physical direction, as in the feed).
        await swipe(-260, 0)
        await expect(counter(page)).toHaveText(/2 \/ 3/)
        await swipe(-260, 0)
        await expect(counter(page)).toHaveText(/3 \/ 3/)
        await expect(page.getByText('صورة', { exact: true }).first()).toBeVisible()

        // A sideways swipe did not move between collections...
        await expect(page).toHaveTitle(/الأولى/)
        // ...and a swipe down reveals the collection above.
        await swipe(0, 500)
        await expect(page).toHaveTitle(/الثانية/)
        await expect(counter(page)).toHaveText(/1 \/ 1/)

        // Coming back keeps the place in the first collection.
        await swipe(0, -500)
        await expect(page).toHaveTitle(/الأولى/)
        await expect(counter(page)).toHaveText(/3 \/ 3/)
        await context.close()
    })

    test('a public link opens without an account; private and reset links do not', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'runs once')
        const member = await createMember('uploader')
        const token = member.session.token
        const [video] = await videoIds()
        const image = await uploadImage(token, 'public.png', 'smptebars=size=1200x1600')
        const created = await createCollection(token, {
            title: 'للعامة',
            description: 'مجموعة للمشاركة',
            visibility: 'public',
            mediaIds: [image, video],
        })
        expect(created.shareCode).toBeTruthy()

        const stranger = await browser.newContext()
        const page = await stranger.newPage()
        await page.goto(`collection#${created.shareCode}`)
        await expect(page.getByRole('heading', { name: 'للعامة' })).toBeVisible()
        await expect(page.getByText('مجموعة للمشاركة')).toBeVisible()
        await expect(page.getByTestId('public-counter')).toHaveText(/1 \/ 2/)
        // The image shows, in the owner's order.
        await expect(page.locator('img[alt="public"]')).toBeVisible()
        // Nothing about the community in what the page fetched.
        const body = await (await page.request.get(`${api()}/api/public/collection?s=${encodeURIComponent(created.shareCode!)}`)).text()
        expect(body).not.toContain(video)
        expect(body).not.toContain(image)
        expect(body).not.toContain(member.session.user.id)

        // Making it private closes the link.
        await apiFetch(`/api/collections/${created.id}`, { method: 'PATCH', token, json: { visibility: 'private' } })
        await page.reload()
        await expect(page.getByRole('heading', { name: 'تعذر فتح المجموعة' })).toBeVisible()

        // Public again: the same link works; after a reset it does not.
        await apiFetch(`/api/collections/${created.id}`, { method: 'PATCH', token, json: { visibility: 'public' } })
        await page.reload()
        await expect(page.getByRole('heading', { name: 'للعامة' })).toBeVisible()
        await apiFetch(`/api/collections/${created.id}/share/reset`, { method: 'POST', token })
        await page.reload()
        await expect(page.getByRole('heading', { name: 'تعذر فتح المجموعة' })).toBeVisible()
        await stranger.close()
    })

    test("images are private: another member cannot list or open them", async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'runs once')
        const owner = await createMember('uploader')
        const other = await createMember('viewer')
        const image = await uploadImage(owner.session.token, 'private.png')

        const mine = await apiFetch<ImagesResponse>('/api/images', { token: owner.session.token })
        expect(mine.body.data.map((i) => i.videoId)).toContain(image)
        const theirs = await apiFetch<ImagesResponse>('/api/images', { token: other.session.token })
        expect(theirs.body.data.map((i) => i.videoId)).not.toContain(image)

        // The uploader sees it under "all my images".
        const context = await browser.newContext({ storageState: sessionStorageState(owner.session) })
        const page = await context.newPage()
        await page.goto(`${web()}/videoscroll/images`)
        await expect(page.getByRole('link', { name: 'كل صوري' })).toContainText('1 صورة')
        await page.getByRole('link', { name: 'صورة: private' }).click()
        await expect(page).toHaveURL(/\/images\/all\?item=/)
        await expect(page.locator('img[alt="private"]')).toBeVisible()
        await context.close()
    })
})
