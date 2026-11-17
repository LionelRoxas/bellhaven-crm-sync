import type { Db } from '@/store/db'
import type { CrmReader } from '@/crm/read'
import { scrapeLocations } from './scrape'
import { classify } from './classify'

export type RunSummary = {
  runId: number
  locations: number
  accounts: number
  created: number
  refreshed: number
  suppressed: number
  superseded: number
}

export type PipelineDeps = {
  fetchText: (path: string) => Promise<string>
  crm: CrmReader
  db: Db
  siteBase: string
  parentName: string
  now?: () => Date
}

/** Read-only toward the CRM. All network I/O happens before the DB transaction. */
export async function runPipeline(deps: PipelineDeps): Promise<RunSummary> {
  const now = deps.now ?? (() => new Date())
  const { db } = deps
  const runId = db.startRun(now())
  try {
    const locations = await scrapeLocations(deps.fetchText, deps.siteBase)
    const accounts = await deps.crm.listAccounts()

    const parents = accounts.filter((a) => a.name === deps.parentName)
    if (parents.length !== 1) {
      throw new Error(`Expected exactly one parent account named "${deps.parentName}", found ${parents.length}`)
    }

    const last = db.lastGoodRun()
    if (locations.length === 0 || (last && locations.length < 0.8 * last.locations)) {
      throw new Error(`Short scrape: ${locations.length} locations vs ${last?.locations ?? 0} last run`)
    }

    const drafts = classify(locations, accounts, parents[0].account_id, deps.siteBase)
    const counts = db.upsertDrafts(runId, drafts)
    const summary: RunSummary = { runId, locations: locations.length, accounts: accounts.length, ...counts }
    db.finishRun(runId, summary, now())
    return summary
  } catch (e) {
    db.finishRun(runId, { error: e instanceof Error ? e.message : String(e) }, now())
    throw e
  }
}
