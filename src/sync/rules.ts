import type { Account, Location } from '@/types'
import { cleanText, nameSimilarity } from './normalize'

/** Website care offering → CRM care_type picklist value. */
export const CARE_MAP: Record<string, string> = {
  'Short-Term Rehabilitation & Nursing': 'Skilled Nursing',
  'Memory Support': 'Memory Care',
  'Assisted Living': 'Assisted Living',
}

const same = (a: string, b: string) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase()

/**
 * Care type the account should have, or null to keep `current`.
 * Keep it when it is any of the location's mapped offerings; otherwise use the first offering's mapping.
 */
export function targetCareType(loc: Location, current: string): string | null {
  const mapped = loc.offerings
    .map((o) => CARE_MAP[cleanText(o)])
    .filter((m): m is string => Boolean(m))
  if (mapped.length === 0) return null
  if (mapped.some((m) => same(m, current))) return null
  return mapped[0]
}

/** Survivor order: billing history, then already under Bellhaven, then closest name, then lowest id. */
export function rankSurvivor(accounts: Account[], bellhavenId: string, loc: Location): Account[] {
  const key = (a: Account) => ({
    revenue: a.lifetime_revenue > 0 ? 0 : 1,
    parent: a.parent_id === bellhavenId ? 0 : 1,
    name: -nameSimilarity(a.name, loc.name),
  })
  return [...accounts].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return (
      ka.revenue - kb.revenue ||
      ka.parent - kb.parent ||
      ka.name - kb.name ||
      (a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0)
    )
  })
}

/** SOP: revenue > 0 AND AR > 0 → change of ownership; otherwise move the account directly. */
export function sopBranch(a: Account): 'chow' | 'reparent' {
  return a.lifetime_revenue > 0 && a.outstanding_ar > 0 ? 'chow' : 'reparent'
}

export const SOP_RULE = 'revenue > 0 and AR > 0 → CHOW (new account); otherwise reparent'

const SUSPICIOUS =
  /ignore (all|previous)|system prompt|you are (an?|the) |approve (all|every)|disregard|instruction|[​-‏⁠]/i

/** Instruction-like text in free-text fields. Evidence only: it never changes a proposal. */
export function findSuspicious(a: Account): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = []
  for (const field of ['name', 'note'] as const) {
    const text = a[field] ?? ''
    if (SUSPICIOUS.test(text)) out.push({ field, text })
  }
  return out
}
