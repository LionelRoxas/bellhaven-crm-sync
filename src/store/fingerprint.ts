import { createHash } from 'node:crypto'
import type { ProposalDraft } from '@/types'

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** Same finding, same hash: no dates, notes or evidence go in. */
export function fingerprint(d: ProposalDraft): string {
  const payload = {
    type: d.type,
    locationSlug: d.locationSlug,
    accountIds: [...d.accountIds].sort(),
    steps: d.steps.map((s) => ({ method: s.method, accountId: s.accountId, body: s.body })),
  }
  return createHash('sha256').update(canonical(payload)).digest('hex')
}
