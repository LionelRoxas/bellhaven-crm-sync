'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { approve, reject, resolveUnknownStep, retry, type Result } from '@/apply/apply'
import { getCrm, getDb } from '@/server/deps'

const Id = z.string().regex(/^p_[0-9a-f]{6,}$/)
const Comment = z.string().max(500).optional()

const ApproveInput = z.object({
  id: Id,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  lastRun: z.coerce.number().int(),
  comment: Comment,
})
const RejectInput = z.object({ id: Id, comment: Comment })
const RetryInput = z.object({ id: Id })
const ResolveInput = z.object({
  id: Id,
  idx: z.coerce.number().int().min(0),
  outcome: z.enum(['done', 'failed']),
  accountId: z.string().regex(/^[0-9A-Z]{18}$/).optional(),
})

const INVALID: Result = { ok: false, message: 'Invalid request' }
const LONG_COMMENT: Result = { ok: false, message: 'Comment must be at most 500 characters' }

const invalid = (e: z.ZodError): Result => (e.issues.some((i) => i.path[0] === 'comment') ? LONG_COMMENT : INVALID)
const UNEXPECTED: Result = { ok: false, message: 'Something went wrong. Reload the page and check the step log.' }

/** UTC date for the note line. */
const today = () => new Date().toISOString().slice(0, 10)

/** Reads only the named text fields; empty strings count as absent. */
function fields(fd: FormData, names: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const n of names) {
    const v = fd.get(n)
    out[n] = typeof v === 'string' && v.trim() !== '' ? v : undefined
  }
  return out
}

function refresh(id: string) {
  revalidatePath('/')
  revalidatePath(`/proposals/${id}`)
}

async function run(id: string, fn: () => Promise<Result> | Result): Promise<Result> {
  try {
    return await fn()
  } catch (e) {
    console.error(`action failed for ${id}: ${e instanceof Error ? e.name : 'error'}`)
    return UNEXPECTED
  } finally {
    refresh(id)
  }
}

export async function approveAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const p = ApproveInput.safeParse(fields(formData, ['id', 'fingerprint', 'lastRun', 'comment']))
  if (!p.success) return invalid(p.error)
  return run(p.data.id, () => approve(getDb(), getCrm(), p.data, today()))
}

export async function rejectAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const p = RejectInput.safeParse(fields(formData, ['id', 'comment']))
  if (!p.success) return invalid(p.error)
  return run(p.data.id, () => reject(getDb(), p.data))
}

export async function retryAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const p = RetryInput.safeParse(fields(formData, ['id']))
  if (!p.success) return INVALID
  return run(p.data.id, () => retry(getDb(), getCrm(), p.data.id, today()))
}

export async function resolveStepAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const p = ResolveInput.safeParse(fields(formData, ['id', 'idx', 'outcome', 'accountId']))
  if (!p.success) {
    return formData.get('outcome') === 'done' && formData.get('accountId') !== null
      ? { ok: false, message: 'Enter the id of the account the create step made (18 characters, 0-9 and A-Z)' }
      : INVALID
  }
  const { id, idx, outcome } = p.data
  const accountId = outcome === 'done' ? p.data.accountId : undefined
  return run(id, () => resolveUnknownStep(getDb(), getCrm(), id, idx, outcome, accountId))
}
