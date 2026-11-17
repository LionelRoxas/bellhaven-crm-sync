import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Page } from '@playwright/test'

const CRM = `http://127.0.0.1:${process.env.E2E_CRM_PORT}`
const BELLHAVEN_ID = '0015QAPLGS3FVYEEEM'
const OLD_TIFFIN_ID = '001U6RW32TY0WSXZZB'

test.describe.configure({ mode: 'serial' })

async function openFromQueue(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

test('queue shows pending counts and the Tiffin CHOW row', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('count-pending')).toHaveText('26')
  const row = page.getByRole('row').filter({ hasText: 'Bellhaven of Tiffin' })
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('cell', { name: 'CHOW', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/queue.png', fullPage: true })
})

test('approving Tiffin applies both steps to the CRM', async ({ page, request }) => {
  await openFromQueue(page, 'Bellhaven of Tiffin')
  const evidence = page.getByRole('table', { name: 'Evidence' })
  await expect(evidence).toContainText('$84,000')
  await expect(evidence).toContainText('$12,400')
  await expect(page.getByTestId('sop')).toContainText('A new account will be created')
  await page.screenshot({ path: 'test-results/tiffin-detail.png', fullPage: true })

  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByTestId('status')).toHaveText('Applied', { timeout: 30_000 })
  const log = page.getByRole('table', { name: 'Step log' })
  await expect(log.getByRole('cell', { name: 'Done', exact: true })).toHaveCount(2)

  const res = await request.get(`${CRM}/accounts?page=1&page_size=500`, { headers: { Authorization: 'Bearer test' } })
  const { data } = (await res.json()) as { data: { account_id: string; name: string; parent_id: string; chow_current_account: string }[] }
  const created = data.filter((a) => a.name === 'Bellhaven of Tiffin' && a.parent_id === BELLHAVEN_ID)
  expect(created).toHaveLength(1)
  expect(data.find((a) => a.account_id === OLD_TIFFIN_ID)?.chow_current_account).toBe(created[0].account_id)
})

test('rejecting Union Square records the comment and writes nothing', async ({ page }) => {
  await openFromQueue(page, 'Bellhaven at Union Square')
  await expect(page.getByRole('region', { name: 'Not linked' })).toContainText('Union Square Senior Living')
  await page.getByLabel('Comment').fill('Testing reject')
  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(page.getByTestId('status')).toHaveText('Rejected')
})

test('decisions persist across reloads and leave the default queue', async ({ page }) => {
  await page.goto('/?status=applied')
  await page.getByRole('link', { name: 'Bellhaven of Tiffin', exact: true }).click()
  await page.waitForURL(/\/proposals\/p_/)
  await page.reload()
  await expect(page.getByTestId('status')).toHaveText('Applied')

  await page.goto('/?status=rejected')
  await page.getByRole('link', { name: 'Bellhaven at Union Square', exact: true }).click()
  await page.waitForURL(/\/proposals\/p_/)
  await page.reload()
  await expect(page.getByTestId('status')).toHaveText('Rejected')
  await expect(page.getByText('Testing reject')).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('row').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Bellhaven of Tiffin', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Bellhaven at Union Square', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('count-pending')).toHaveText('24')
})

test('requests with a foreign Host header are refused', async ({ request }) => {
  const res = await request.get('/', { headers: { Host: 'evil.test:3100' } })
  expect(res.status()).toBe(403)
})

test('detail page has no horizontal page scroll at 375px', async ({ page }) => {
  await page.goto('/?status=applied')
  const href = await page.getByRole('link', { name: 'Bellhaven of Tiffin', exact: true }).getAttribute('href')
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto(href!)
  await expect(page.getByTestId('status')).toHaveText('Applied')
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(375)
})

/** Puts a proposal into `failed` with step 0 `unknown`, as after a write whose outcome was lost. */
function markUnknown(title: string): string {
  const db = new DatabaseSync(process.env.E2E_DB_PATH!)
  try {
    const row = db.prepare("SELECT id FROM proposals WHERE title = ? AND status = 'pending'").get(title) as { id: string }
    const step = db.prepare('SELECT body FROM steps WHERE proposal_id = ? AND idx = 0').get(row.id) as { body: string }
    db.prepare("UPDATE proposals SET status = 'failed', decided_at = ? WHERE id = ?").run('2026-01-01T00:00:00.000Z', row.id)
    db.prepare("UPDATE steps SET status = 'unknown', response = ?, error = ?, attempted_at = ? WHERE proposal_id = ? AND idx = 0").run(
      JSON.stringify({ sent: JSON.parse(step.body) }),
      'Outcome unknown: network error, timeout or unreadable response',
      '2026-01-01T00:00:00.000Z',
      row.id,
    )
    return row.id
  } finally {
    db.close()
  }
}

test('an unknown step can be resolved by hand, then retried', async ({ page }) => {
  const id = markUnknown('Bellhaven of Ashtabula')
  await page.goto(`/proposals/${id}`)
  await expect(page.getByTestId('status')).toHaveText('Failed')
  await expect(page.getByRole('table', { name: 'Step log' })).toContainText('Unknown outcome')
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0)

  await page.getByRole('button', { name: 'It didn’t land' }).click()
  await expect(page.getByRole('status')).toHaveText('Step marked failed')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByTestId('status')).toHaveText('Applied')
  await expect(page.getByRole('status')).toHaveText('Applied')
})

test('marking a create step as landed checks the account id in the CRM', async ({ page }) => {
  const id = markUnknown('Bellhaven of Batavia')
  await page.goto(`/proposals/${id}`)
  await page.getByLabel('Created account id').fill('001ZZZZZZZZZZZZZZZ')
  await page.getByRole('button', { name: 'It landed' }).click()
  await expect(page.getByRole('status')).toHaveText('Account 001ZZZZZZZZZZZZZZZ not found in the CRM.')
  await expect(page.getByTestId('status')).toHaveText('Failed')
})
