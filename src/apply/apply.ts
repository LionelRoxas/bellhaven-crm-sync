import 'server-only'
import type { Account } from '@/types'
import type { Db, ProposalRow, StepRow } from '@/store/db'
import { CrmError, type CrmReader } from '@/crm/read'
import type { CrmWriter } from '@/crm/contracts'

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
  unknown: 'A previous write may or may not have landed. Check the CRM and mark the step done or failed.',
  applied: 'Applied',
  rejected: 'Rejected',
  notFound: 'Proposal not found',
  invalidRef: 'Invalid reference in step body',
} as const

export const INTERRUPTED_AFTER_MS = 5 * 60_000
const REF_FIELDS = new Set(['parent_id', 'chow_current_account', 'duplicate_of_account'])
const ACCOUNT_ID = /^[0-9A-Z]{18}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_COMMENT = 500

const fail = (message: string): Result => ({ ok: false, message })
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
 * Whether an `approved` proposal is stuck: steps not all done and approved (or last claimed)
 * more than 5 minutes ago. Such a proposal can be resumed with `retry`.
 */
export function isInterrupted(p: ProposalRow, steps: StepRow[], now: Date = new Date()): boolean {
  if (p.status !== 'approved') return false
  if (steps.every((s) => s.status === 'done')) return false
  if (p.decidedAt === null) return true
  const at = Date.parse(p.decidedAt)
  return Number.isNaN(at) || at < now.getTime() - INTERRUPTED_AFTER_MS
}

const cutoffIso = (now: Date) => new Date(now.getTime() - INTERRUPTED_AFTER_MS).toISOString()

/**
 * Runs an `approved` proposal's remaining steps (architecture §4 "Apply algorithm").
 * Leaves the proposal `applied` or `failed`.
 */
export async function applyProposal(db: Db, crm: Crm, id: string, today: string): Promise<Result> {
  if (!DATE.test(today)) return fail('Invalid date')
  const p = db.getProposal(id)
  if (!p) return fail(MESSAGES.notFound)
  if (p.status !== 'approved') return fail('Proposal is not approved')
  const steps = db.getSteps(id)
  const toFailed = () => db.transition(id, ['approved'], 'failed')

  // 1. A step whose outcome is unknown must be checked by hand first.
  if (steps.some((s) => s.status === 'unknown')) {
    toFailed()
    return fail(MESSAGES.unknown)
  }

  const remaining = steps.filter((s) => s.status !== 'done')
  for (const s of remaining) {
    const problem = stepProblem(s, steps, p)
    if (problem) {
      db.updateStep(id, s.idx, { status: 'failed', error: problem, attemptedAt: new Date().toISOString() })
      toFailed()
      return fail(`Step ${s.idx + 1} failed: ${problem}`)
    }
  }

  // 2. Re-read every involved account and compare with what it should be now.
  const current = new Map<string, Account>()
  for (const accountId of Object.keys(p.snapshot)) {
    let a: Account
    try {
      a = await crm.getAccount(accountId)
    } catch (e) {
      toFailed()
      const detail = e instanceof CrmError ? e.detail : 'request failed'
      return fail(`Could not re-read account ${accountId}: ${detail}`)
    }
    if (!sameAsExpected(a, p.snapshot[accountId], expectedState(p, steps, accountId))) {
      toFailed()
      return fail(MESSAGES.changed)
    }
    current.set(accountId, a)
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
        db.updateStep(id, s.idx, { status: 'failed', error: MESSAGES.invalidRef, attemptedAt: new Date().toISOString() })
        toFailed()
        return fail(`Step ${s.idx + 1} failed: ${MESSAGES.invalidRef}`)
      }
    }
    if (s.noteReason) {
      const line = `[bellhaven-sync ${today} ${id}] ${s.noteReason}`
      const existing = s.method === 'PATCH' ? (notes.get(s.accountId!) ?? '') : ''
      body.note = existing ? `${existing}\n${line}` : line
    }

    // Write-ahead: if the process dies during the call, the step stays `unknown` and is never re-sent.
    const record: StepRecord = { sent: body }
    db.updateStep(id, s.idx, {
      status: 'unknown',
      attemptedAt: new Date().toISOString(),
      response: JSON.stringify(record),
      error: 'Outcome unknown: the write was started but no response was recorded',
    })

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
      if (e instanceof CrmError) {
        // The CRM answered with an error: nothing landed, safe to retry later.
        db.updateStep(id, s.idx, { status: 'failed', error: e.message })
        toFailed()
        return fail(`Step ${s.idx + 1} failed: ${e.message}`)
      }
      // Network error, timeout, unreadable response or anything unexpected: the write may have landed.
      db.updateStep(id, s.idx, { status: 'unknown', error: 'Outcome unknown: network error, timeout or unreadable response' })
      toFailed()
      return fail(MESSAGES.unknown)
    }
  }

  if (!db.transition(id, ['approved'], 'applied')) return fail('Proposal changed state during apply')
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

  const claimed = db.transition(p.id, ['pending'], 'approved', {
    comment: c.comment,
    decidedAt: now.toISOString(),
    ifMatch: { fingerprint: input.fingerprint, lastRun: input.lastRun },
  })
  if (!claimed) {
    // Lost a race: either another approval/rejection, or a pipeline refresh.
    return fail(db.getProposal(p.id)?.status === 'pending' ? MESSAGES.refreshed : MESSAGES.decided)
  }
  return applyProposal(db, crm, p.id, today)
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

  // Claim it with a conditional UPDATE so two retries can't run the same steps.
  const claimed =
    p.status === 'failed'
      ? db.transition(id, ['failed'], 'approved', { decidedAt: now.toISOString() })
      : db.transition(id, ['approved'], 'approved', {
          decidedAt: now.toISOString(),
          ifMatch: { decidedBefore: cutoffIso(now) },
        })
  if (!claimed) return fail('This proposal is already being applied')
  return applyProposal(db, crm, id, today)
}

/**
 * After checking the CRM by hand, the reviewer records whether an `unknown` step landed.
 * A create step marked done needs the id of the account it created. The proposal stays (or
 * becomes) `failed`, so `retry` can then run what's left.
 */
export function resolveUnknownStep(
  db: Db,
  id: string,
  idx: number,
  outcome: 'done' | 'failed',
  createdAccountId?: string,
  now: Date = new Date(),
): Result {
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

  if (p.status === 'approved') {
    const moved = db.transition(id, ['approved'], 'failed', { ifMatch: { decidedBefore: cutoffIso(now) } })
    if (!moved) return fail('This proposal is still being applied')
  }

  const rec = readRecord(s)
  const resolved = { outcome, at: now.toISOString() }
  const response = JSON.stringify(rec ? { ...rec, resolved } : { resolved })
  if (outcome === 'done') {
    db.updateStep(id, idx, {
      status: 'done',
      response,
      error: null,
      ...(needsId ? { resultAccountId: createdAccountId } : {}),
    })
    return done('Step marked done')
  }
  db.updateStep(id, idx, { status: 'failed', response, error: 'Marked failed by the reviewer after checking the CRM' })
  return done('Step marked failed')
}
