import 'server-only'
import type { Account } from '@/types'
import type { Db, ProposalRow, StepRow } from '@/store/db'
import { CrmError, type CrmReader } from '@/crm/read'
import type { CrmWriter } from '@/crm/contracts'
import { sopBranch } from '@/sync/rules'

/*
 * The only code path that writes to the CRM. It runs a proposal's stored steps (never anything
 * from the browser) and only after the proposal has been moved to `approved` by a conditional
 * UPDATE. Existing CRM notes are copied verbatim when a line is appended, never interpreted.
 */

export type Result = { ok: true; message: string } | { ok: false; message: string }
export type Crm = CrmReader & CrmWriter

export const MESSAGES = {
  decided: 'Already decided',
  refreshed: 'This proposal was refreshed since you opened it. Reload to see the latest.',
  changed: 'CRM changed since this proposal was made. Run the pipeline again.',
  sopChanged: 'Billing data changed (revenue/AR); the SOP now applies differently. Run the pipeline again.',
  unknown: 'A previous write may or may not have landed. Check the CRM and mark the step done or failed.',
  applied: 'Applied',
  rejected: 'Rejected',
  notFound: 'Proposal not found',
  invalidRef: 'Invalid reference in step body',
  takenOver: 'Another run took over this proposal. Reload to see the latest.',
} as const

export const INTERRUPTED_AFTER_MS = 5 * 60_000
const REF_FIELDS = new Set(['parent_id', 'chow_current_account', 'duplicate_of_account'])
const ACCOUNT_ID = /^[0-9A-Z]{18}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_COMMENT = 500

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message })
const done = (message: string): Result => ({ ok: true, message })

/** What we record in `steps.response`: the exact body sent, and the created id for a POST. */
type StepRecord = { sent: Record<string, string>; account_id?: string; resolved?: { outcome: string; at: string } }

function readRecord(s: StepRow): StepRecord | null {
  if (!s.response) return null
  try {
    const r = JSON.parse(s.response) as StepRecord
    return r && typeof r.sent === 'object' && r.sent !== null ? r : null
  } catch {
    return null
  }
}

/** The body a step sent (from its write-ahead record), or its stored body if no record survived. */
export function sentBody(s: StepRow): Record<string, string> {
  const rec = readRecord(s)
  if (rec) return rec.sent
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(s.body)) if (typeof v === 'string') out[k] = v
  return out
}

const isRef = (v: unknown): boolean =>
  !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === 1 && (v as Record<string, unknown>).$ref === 'created'

/** Why a step can't run, checked before any write. Null when it's well-formed. */
function stepProblem(s: StepRow, all: StepRow[], p: ProposalRow): string | null {
  for (const [k, v] of Object.entries(s.body)) {
    if (typeof v === 'string') continue
    const earlierPosts = all.filter((x) => x.method === 'POST' && x.idx < s.idx)
    if (isRef(v) && REF_FIELDS.has(k) && s.method === 'PATCH' && earlierPosts.length === 1) continue
    return MESSAGES.invalidRef
  }
  if ('note' in s.body) return 'Step body must not set the note'
  if (s.method === 'POST') return s.accountId === null ? null : 'Invalid step'
  if (s.method === 'PATCH') {
    if (!s.accountId || !(s.accountId in p.snapshot)) return 'Step targets an account outside this proposal'
    return null
  }
  return 'Invalid step'
}

/** The account as it should be now: snapshot, plus what our done steps sent to it. */
function expectedState(p: ProposalRow, steps: StepRow[], accountId: string): Partial<Account> {
  const exp: Record<string, unknown> = { ...p.snapshot[accountId] }
  for (const s of steps) {
    if (s.status !== 'done' || s.method !== 'PATCH' || s.accountId !== accountId) continue
    // A done step with no record can't be accounted for; leave the snapshot, which then mismatches.
    const rec = readRecord(s)
    if (rec) Object.assign(exp, rec.sent)
  }
  return exp as Partial<Account>
}

function sameAsExpected(actual: Account, snapshot: Partial<Account>, expected: Partial<Account>): boolean {
  return Object.keys(snapshot).every(
    (k) => String(actual[k as keyof Account] ?? '') === String(expected[k as keyof Account] ?? ''),
  )
}

/**
 * Whether an `approved` proposal is stuck: approved (or last claimed) more than 5 minutes ago.
 * That includes one whose steps are all done but that never reached `applied` (a crash before the
 * final transition). Such a proposal can be resumed with `retry`.
 */
export function isInterrupted(p: ProposalRow, _steps: StepRow[], now: Date = new Date()): boolean {
  if (p.status !== 'approved') return false
  if (p.decidedAt === null) return true
  const at = Date.parse(p.decidedAt)
  return Number.isNaN(at) || at < now.getTime() - INTERRUPTED_AFTER_MS
}

const cutoffIso = (now: Date) => new Date(now.getTime() - INTERRUPTED_AFTER_MS).toISOString()

/**
 * Runs an `approved` proposal's remaining steps (architecture §4 "Apply algorithm").
 * Leaves the proposal `applied` or `failed`, or `superseded` when the CRM changed before any of
 * its steps landed (the next pipeline run then revives it with a fresh snapshot or replaces it).
 *
 * `claim` is the `decided_at` value the caller wrote when it claimed the proposal. Every status
 * change and every write-ahead is conditional on it, so a run that another run took over (an
 * Interrupted retry) stops without writing anything.
 */
export async function applyProposal(db: Db, crm: Crm, id: string, today: string, claim: string): Promise<Result> {
  if (!DATE.test(today)) return fail('Invalid date')
  const p = db.getProposal(id)
  if (!p) return fail(MESSAGES.notFound)
  if (p.status !== 'approved') return fail('Proposal is not approved')
  if (p.decidedAt !== claim) return fail(MESSAGES.takenOver)
  const steps = db.getSteps(id)
  const owned = { ifMatch: { decidedAtIs: claim } }
  /** Moves the proposal to `failed` while this run still owns it; otherwise reports the take-over. */
  const stop = (message: string, markStep?: () => void): Result => {
    if (!db.transition(id, ['approved'], 'failed', owned)) return fail(MESSAGES.takenOver)
    markStep?.()
    return fail(message)
  }
  /**
   * The CRM no longer matches what the proposal was built on. With nothing written yet the proposal
   * is `superseded`, so the next run can propose it again; once a step has landed it stays `failed`.
   */
  const stopChanged = (message: string): Result => {
    if (steps.some((s) => s.status === 'done')) return stop(message)
    if (!db.transition(id, ['approved'], 'superseded', owned)) return fail(MESSAGES.takenOver)
    return fail(message)
  }

  // 1. A step whose outcome is unknown must be checked by hand first.
  if (steps.some((s) => s.status === 'unknown')) return stop(MESSAGES.unknown)

  const remaining = steps.filter((s) => s.status !== 'done')
  for (const s of remaining) {
    const problem = stepProblem(s, steps, p)
    if (problem) {
      return stop(`Step ${s.idx + 1} failed: ${problem}`, () =>
        db.updateStep(id, s.idx, { status: 'failed', error: problem, attemptedAt: new Date().toISOString() }),
      )
    }
  }

  // 2. Re-read every involved account and compare with what it should be now.
  const current = new Map<string, Account>()
  for (const accountId of Object.keys(p.snapshot)) {
    let a: Account
    try {
      a = await crm.getAccount(accountId)
    } catch (e) {
      const detail = e instanceof CrmError ? e.detail : 'request failed'
      return stop(`Could not re-read account ${accountId}: ${detail}`)
    }
    if (!sameAsExpected(a, p.snapshot[accountId], expectedState(p, steps, accountId))) {
      return stopChanged(MESSAGES.changed)
    }
    current.set(accountId, a)
  }

  // 2b. Revenue/AR are not in the snapshot, so re-check the SOP branch on the fresh accounts.
  for (const s of remaining) {
    if (s.method !== 'PATCH' || !s.accountId) continue
    const fresh = current.get(s.accountId)!
    if ('parent_id' in s.body && sopBranch(fresh) === 'chow') return stopChanged(MESSAGES.sopChanged)
    if (
      (p.type === 'chow' || p.type === 'sold') &&
      'chow_current_account' in s.body &&
      sopBranch(fresh) !== 'chow'
    ) {
      return stopChanged(MESSAGES.sopChanged)
    }
  }

  // 3–4. Run remaining steps in order; each result is stored before the next starts.
  let createdId = steps.find((s) => s.method === 'POST' && s.status === 'done')?.resultAccountId ?? null
  const notes = new Map([...current].map(([k, a]) => [k, a.note]))

  for (const s of remaining) {
    const body: Record<string, string> = {}
    for (const [k, v] of Object.entries(s.body)) {
      if (typeof v === 'string') body[k] = v
      else if (isRef(v) && createdId) body[k] = createdId
      else {
        // Unreachable after the pre-check (the earlier POST must be done to get here); fail safe.
        return stop(`Step ${s.idx + 1} failed: ${MESSAGES.invalidRef}`, () =>
          db.updateStep(id, s.idx, { status: 'failed', error: MESSAGES.invalidRef, attemptedAt: new Date().toISOString() }),
        )
      }
    }
    if (s.noteReason) {
      const line = `[bellhaven-sync ${today} ${id}] ${s.noteReason}`
      const existing = s.method === 'PATCH' ? (notes.get(s.accountId!) ?? '') : ''
      body.note = existing ? `${existing}\n${line}` : line
    }

    // Write-ahead in one conditional UPDATE: the step becomes `unknown` only while this run still
    // owns the proposal. If the process dies during the call, the step stays `unknown` and is never
    // re-sent; if another run took over, nothing is sent.
    const record: StepRecord = { sent: body }
    const mine = db.claimStep(id, s.idx, claim, {
      attemptedAt: new Date().toISOString(),
      response: JSON.stringify(record),
      error: 'Outcome unknown: the write was started but no response was recorded',
    })
    if (!mine) return fail(MESSAGES.takenOver)

    try {
      if (s.method === 'POST') {
        const r = await crm.createAccount(body)
        if (typeof r?.account_id !== 'string' || !ACCOUNT_ID.test(r.account_id)) {
          throw new Error('create returned no valid account id')
        }
        createdId = r.account_id
        db.updateStep(id, s.idx, {
          status: 'done',
          resultAccountId: r.account_id,
          response: JSON.stringify({ ...record, account_id: r.account_id }),
          error: null,
        })
      } else {
        await crm.patchAccount(s.accountId!, body)
        if (body.note !== undefined) notes.set(s.accountId!, body.note)
        db.updateStep(id, s.idx, { status: 'done', error: null })
      }
    } catch (e) {
      // A 4xx, or a 5xx on a PATCH, means the CRM refused it: safe to retry later. A 5xx on a POST
      // may still have created the account, so it is handled like a network error.
      if (e instanceof CrmError && !(s.method === 'POST' && e.status >= 500)) {
        db.updateStep(id, s.idx, { status: 'failed', error: e.message })
        return stop(`Step ${s.idx + 1} failed: ${e.message}`)
      }
      // Network error, timeout, POST 5xx, unreadable response or anything unexpected: may have landed.
      const why =
        e instanceof CrmError
          ? `Outcome unknown: ${e.message}`
          : 'Outcome unknown: network error, timeout or unreadable response'
      db.updateStep(id, s.idx, { status: 'unknown', error: why })
      return stop(MESSAGES.unknown)
    }
  }

  if (!db.transition(id, ['approved'], 'applied', owned)) return fail(MESSAGES.takenOver)
  return done(MESSAGES.applied)
}

function checkComment(comment: string | undefined): { comment?: string; error?: string } {
  const c = comment?.trim()
  if (!c) return {}
  if (c.length > MAX_COMMENT) return { error: `Comment must be at most ${MAX_COMMENT} characters` }
  return { comment: c }
}

/** `pending → approved` only if the reviewer saw the current version, then apply. Single-shot. */
export async function approve(
  db: Db,
  crm: Crm,
  input: { id: string; fingerprint: string; lastRun: number; comment?: string },
  today: string,
  now: Date = new Date(),
): Promise<Result> {
  if (!DATE.test(today)) return fail('Invalid date')
  const c = checkComment(input.comment)
  if (c.error) return fail(c.error)
  const p = db.getProposal(input.id)
  if (!p) return fail(MESSAGES.notFound)
  if (p.status === 'info') return fail('Nothing to approve: this location needs no change')
  if (p.status !== 'pending') return fail(MESSAGES.decided)
  if (p.fingerprint !== input.fingerprint || p.lastRun !== input.lastRun) return fail(MESSAGES.refreshed)

  const claim = now.toISOString()
  const claimed = db.transition(p.id, ['pending'], 'approved', {
    comment: c.comment,
    decidedAt: claim,
    ifMatch: { fingerprint: input.fingerprint, lastRun: input.lastRun },
  })
  if (!claimed) {
    // Lost a race: either another approval/rejection, or a pipeline refresh.
    return fail(db.getProposal(p.id)?.status === 'pending' ? MESSAGES.refreshed : MESSAGES.decided)
  }
  return applyProposal(db, crm, p.id, today, claim)
}

/** `pending → rejected`. Writes nothing to the CRM. */
export function reject(db: Db, input: { id: string; comment?: string }, now: Date = new Date()): Result {
  const c = checkComment(input.comment)
  if (c.error) return fail(c.error)
  const p = db.getProposal(input.id)
  if (!p) return fail(MESSAGES.notFound)
  if (p.status === 'info') return fail('Nothing to reject: this location needs no change')
  if (!db.transition(p.id, ['pending'], 'rejected', { comment: c.comment, decidedAt: now.toISOString() })) {
    return fail(MESSAGES.decided)
  }
  return done(MESSAGES.rejected)
}

/** Re-runs the remaining steps of a `failed` or Interrupted proposal. Refuses while a step is `unknown`. */
export async function retry(db: Db, crm: Crm, id: string, today: string, now: Date = new Date()): Promise<Result> {
  if (!DATE.test(today)) return fail('Invalid date')
  const p = db.getProposal(id)
  if (!p) return fail(MESSAGES.notFound)
  const steps = db.getSteps(id)
  const interrupted = isInterrupted(p, steps, now)
  if (p.status !== 'failed' && !interrupted) return fail('Only failed or interrupted proposals can be retried')
  if (steps.some((s) => s.status === 'unknown')) return fail(MESSAGES.unknown)

  // Claim it with a conditional UPDATE; the new decided_at is this run's claim token.
  const claim = now.toISOString()
  const claimed =
    p.status === 'failed'
      ? db.transition(id, ['failed'], 'approved', { decidedAt: claim })
      : db.transition(id, ['approved'], 'approved', {
          decidedAt: claim,
          ifMatch: { decidedBefore: cutoffIso(now) },
        })
  if (!claimed) return fail('This proposal is already being applied')
  return applyProposal(db, crm, id, today, claim)
}

type Resolvable = { ok: true; p: ProposalRow; s: StepRow; needsId: boolean } | { ok: false; message: string }

function checkResolvable(
  db: Db,
  id: string,
  idx: number,
  outcome: 'done' | 'failed',
  createdAccountId: string | undefined,
  now: Date,
): Resolvable {
  const p = db.getProposal(id)
  if (!p) return fail(MESSAGES.notFound)
  if (outcome !== 'done' && outcome !== 'failed') return fail('Outcome must be done or failed')
  const steps = db.getSteps(id)
  const s = steps.find((x) => x.idx === idx)
  if (!s || s.status !== 'unknown') return fail('This step is not waiting for a check')
  if (p.status !== 'failed' && !isInterrupted(p, steps, now)) return fail('This proposal is still being applied')
  const needsId = outcome === 'done' && s.method === 'POST'
  if (needsId && (typeof createdAccountId !== 'string' || !ACCOUNT_ID.test(createdAccountId))) {
    return fail('Enter the id of the account the create step made (18 characters, 0-9 and A-Z)')
  }
  if (!needsId && createdAccountId !== undefined) return fail('Only a create step marked done takes an account id')
  return { ok: true, p, s, needsId }
}

/**
 * After checking the CRM by hand, the reviewer records whether an `unknown` step landed.
 * A create step marked done needs the id of the account it created: it must exist in the CRM, must
 * not be one of the proposal's own accounts, and its name, zip and parent must equal what was sent.
 * The proposal stays (or becomes) `failed`, so `retry` can then run what's left.
 */
export async function resolveUnknownStep(
  db: Db,
  crm: CrmReader,
  id: string,
  idx: number,
  outcome: 'done' | 'failed',
  createdAccountId?: string,
  now: Date = new Date(),
): Promise<Result> {
  const first = checkResolvable(db, id, idx, outcome, createdAccountId, now)
  if (!first.ok) return first

  if (first.needsId) {
    if (createdAccountId! in first.p.snapshot) {
      return fail("That is one of this proposal's existing accounts, not the one this step created.")
    }
    let found: Account
    try {
      found = await crm.getAccount(createdAccountId!)
    } catch (e) {
      if (e instanceof CrmError && e.status === 404) return fail(`Account ${createdAccountId} not found in the CRM.`)
      const detail = e instanceof CrmError ? e.detail : 'request failed'
      return fail(`Could not check account ${createdAccountId}: ${detail}`)
    }
    const sent = sentBody(first.s)
    const same = (k: 'name' | 'billing_zip' | 'parent_id') => String(found[k] ?? '').trim() === String(sent[k] ?? '').trim()
    if (!same('name') || !same('billing_zip') || !same('parent_id')) {
      return fail(`Account ${createdAccountId} doesn't match what this step sent (name, zip, parent).`)
    }
  }

  // State may have changed while we waited on the CRM: check again before writing.
  const r = checkResolvable(db, id, idx, outcome, createdAccountId, now)
  if (!r.ok) return r
  if (r.p.status === 'approved') {
    const moved = db.transition(id, ['approved'], 'failed', { ifMatch: { decidedBefore: cutoffIso(now) } })
    if (!moved) return fail('This proposal is still being applied')
  }

  const rec = readRecord(r.s)
  const resolved = { outcome, at: now.toISOString() }
  const response = JSON.stringify(rec ? { ...rec, resolved } : { resolved })
  if (outcome === 'done') {
    db.updateStep(id, idx, {
      status: 'done',
      response,
      error: null,
      ...(r.needsId ? { resultAccountId: createdAccountId } : {}),
    })
    return done('Step marked done')
  }
  db.updateStep(id, idx, { status: 'failed', response, error: 'Marked failed by the reviewer after checking the CRM' })
  return done('Step marked failed')
}
