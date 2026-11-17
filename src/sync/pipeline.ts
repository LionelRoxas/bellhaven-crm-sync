import type { Db } from '@/store/db'
import type { CrmReader } from '@/crm/read'
import { scrapeLocations } from './scrape'
import { classify } from './classify'
import type { Account, Location, ProposalDraft } from '@/types'

export type RunSummary = {
  runId: number
  locations: number
  accounts: number
  created: number
  refreshed: number
  suppressed: number
  superseded: number
  held: number
}

export type PipelineDeps = {
  fetchText: (path: string) => Promise<string>
  crm: CrmReader
  db: Db
  siteBase: string
  parentName: string
  now?: () => Date
  /** Optional advisory annotator. Runs after classify; a failure never fails the run. */
  secondOpinion?: (drafts: ProposalDraft[], ctx: { locations: Location[]; accounts: Account[] }) => Promise<void>
}

/** Abort on 0 locations, or when at least 20% fewer than the last good run (<= 80%). */
export function isShortScrape(found: number, lastGood: number | null): boolean {
  return found === 0 || (lastGood !== null && found <= 0.8 * lastGood)
}

/** Read-only toward the CRM. All network I/O happens before the DB transaction. */
export async function runPipeline(deps: PipelineDeps): Promise<RunSummary> {
  const now = deps.now ?? (() => new Date())
  const { db } = deps
  const runId = db.startRun(now())
  let written = false
  try {
    const locations = await scrapeLocations(deps.fetchText, deps.siteBase)
    const accounts = await deps.crm.listAccounts()

    const parents = accounts.filter((a) => a.name === deps.parentName)
    if (parents.length !== 1) {
      throw new Error(`Expected exactly one parent account named "${deps.parentName}", found ${parents.length}`)
    }

    const last = db.lastGoodRun()
    if (isShortScrape(locations.length, last?.locations ?? null)) {
      throw new Error(`Short scrape: ${locations.length} locations vs ${last?.locations ?? 0} last run`)
    }

    const drafts = classify(locations, accounts, parents[0].account_id, deps.siteBase)
    if (deps.secondOpinion) {
      try {
        await deps.secondOpinion(drafts, { locations, accounts })
      } catch {
        // Advisory only: carry on without opinions.
      }
    }
    const counts = db.upsertDrafts(runId, drafts)
    written = true
    const summary: RunSummary = { runId, locations: locations.length, accounts: accounts.length, ...counts }
    db.finishRun(runId, summary, now())
    return summary
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (written) {
      // The upsert committed; only closing the run row failed.
      throw new Error(`Proposals were written but the run row could not be closed: ${message}`)
    }
    try {
      db.finishRun(runId, { error: message }, now())
    } catch {
      // Never mask the original error.
    }
    throw e
  }
}
