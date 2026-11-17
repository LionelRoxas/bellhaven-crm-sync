import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '@/store/db'
import { fingerprint } from '@/store/fingerprint'
import { runPipeline } from '@/sync/pipeline'
import { classify } from '@/sync/classify'
import { FakeCrm } from './fake-crm'
import { fixtureFetcher } from './helpers/site'
import { BELLHAVEN_ID, SITE_BASE, loadAccounts, loadLocations } from './helpers/data'

const LIMA = 'bellhaven-crossings-of-lima'
const LIMA_ID = '001LGFPBJY4N9MB6KL'

let dir: string
let db: Db
let crm: FakeCrm

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bellhaven-'))
  db = openDb(join(dir, 'sync.db'))
  crm = new FakeCrm()
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const deps = (over: Record<string, unknown> = {}) => ({
  fetchText: fixtureFetcher().fetchText,
  crm,
  db,
  siteBase: SITE_BASE,
  parentName: 'Bellhaven Senior Living (Parent Account)',
  ...over,
})
const run = (over: Record<string, unknown> = {}) => runPipeline(deps(over))
const limaRow = (status?: string) =>
  db.listProposals({ status: status as never }).find((p) => p.locationSlug === LIMA && p.type === 'reparent')

describe('pipeline', () => {
  test('first run stores 38 rows, second run refreshes them all', async () => {
    const a = await run()
    expect(a).toMatchObject({ locations: 35, accounts: 121, created: 38, refreshed: 0, suppressed: 0, superseded: 0 })
    expect(db.listProposals({ status: 'pending' })).toHaveLength(26)
    expect(db.listProposals({ status: 'info' })).toHaveLength(12)
    const b = await run()
    expect(b).toMatchObject({ created: 0, suppressed: 0, refreshed: 38, superseded: 0 })
    expect(db.listProposals()).toHaveLength(38)
  })

  test('steps are stored and ids are p_ + 6 hex', async () => {
    await run()
    const rows = db.listProposals()
    for (const r of rows) expect(r.id).toBe(`p_${r.fingerprint.slice(0, 6)}`)
    const create = rows.find((r) => r.type === 'create')!
    expect(db.getSteps(create.id)).toMatchObject([{ idx: 0, method: 'POST', accountId: null, status: 'pending' }])
  })

  test('fingerprint is stable across runs on different dates', async () => {
    await run({ now: () => new Date('2026-11-16T08:00:00Z') })
    const before = db.listProposals().map((p) => p.fingerprint).sort()
    const s = await run({ now: () => new Date('2026-12-25T08:00:00Z') })
    expect(db.listProposals().map((p) => p.fingerprint).sort()).toEqual(before)
    expect(s.created).toBe(0)
    expect(s.refreshed).toBe(38)
  })

  test('fingerprint ignores key order and evidence', async () => {
    const [d] = classify(await loadLocations(), loadAccounts(), BELLHAVEN_ID)
    const flipped = { ...d, title: 'other', evidence: { ...d.evidence, accounts: [] } }
    expect(fingerprint(flipped)).toBe(fingerprint(d))
    expect(fingerprint({ ...d, accountIds: [...d.accountIds].reverse() })).toBe(fingerprint(d))
  })

  test('rejected and approved rows are suppressed, not re-created', async () => {
    await run()
    const [one, two] = db.listProposals({ status: 'pending' })
    expect(db.transition(one.id, ['pending'], 'rejected', { comment: 'no' })).toBe(true)
    expect(db.transition(two.id, ['pending'], 'approved', { decidedAt: '2026-11-16T00:00:00Z' })).toBe(true)
    expect(db.transition(one.id, ['pending'], 'approved')).toBe(false)
    const s = await run()
    expect(s).toMatchObject({ created: 0, suppressed: 2, refreshed: 36, superseded: 0 })
    expect(db.getProposal(one.id)).toMatchObject({ status: 'rejected', comment: 'no' })
    expect(db.listProposals()).toHaveLength(38)
  })

  test('revenue drift keeps the fingerprint; street drift supersedes and re-creates', async () => {
    await run()
    const first = limaRow('pending')!
    expect(first).toBeTruthy()

    crm.accounts.find((a) => a.account_id === LIMA_ID)!.lifetime_revenue = 0
    const s2 = await run()
    expect(s2.created).toBe(0)
    expect(limaRow('pending')!.fingerprint).toBe(first.fingerprint)

    crm.accounts.find((a) => a.account_id === LIMA_ID)!.billing_street = '1 Moved Street'
    const s3 = await run()
    expect(s3.superseded).toBeGreaterThanOrEqual(1)
    expect(s3.created).toBeGreaterThanOrEqual(1)
    expect(db.getProposal(first.id)!.status).toBe('superseded')
    const current = db.listProposals({ status: 'pending' }).filter((p) => p.locationSlug === LIMA)
    expect(current.length).toBeGreaterThanOrEqual(1)
    expect(current.every((p) => p.fingerprint !== first.fingerprint)).toBe(true)
  })

  test('short scrape throws, leaves proposals alone and records the error', async () => {
    await run()
    const before = JSON.stringify(db.listProposals())
    const full = fixtureFetcher().fetchText
    const page1Only = (path: string) => full(path.startsWith('/communities?page=') ? '/communities?page=1' : path)
    await expect(run({ fetchText: page1Only })).rejects.toThrow(/Short scrape: 1[67] locations vs 35/)
    expect(JSON.stringify(db.listProposals())).toBe(before)
    expect(db.lastRunInfo()!.error).toMatch(/Short scrape/)
    expect(db.lastGoodRun()!.locations).toBe(35)
  })

  test('refresh never touches an approved row', async () => {
    await run()
    const row = limaRow('pending')!
    const evidenceBefore = JSON.stringify(row.evidence)
    db.transition(row.id, ['pending'], 'approved')
    crm.accounts.find((a) => a.account_id === LIMA_ID)!.lifetime_revenue = 0
    await run()
    const after = db.getProposal(row.id)!
    expect(after.status).toBe('approved')
    expect(JSON.stringify(after.evidence)).toBe(evidenceBefore)
    expect(after.lastRun).toBe(row.lastRun)
  })

  test('a missing parent account throws and records the error', async () => {
    await expect(run({ parentName: 'No Such Parent' })).rejects.toThrow(/exactly one parent/)
    expect(db.lastRunInfo()!.error).toMatch(/parent/)
    expect(db.listProposals()).toHaveLength(0)
  })
})
