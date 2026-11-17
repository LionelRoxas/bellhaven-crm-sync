import type { Account, Candidate, Location } from '@/types'
import { cleanText, isPoBox, nameSimilarity, normStreet, sameName } from './normalize'

const eq = (a: string, b: string) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase()

/** Accounts that may be matched: not a parent account, not already marked duplicate or CHOW. */
export function isMatchable(a: Account): boolean {
  return cleanText(a.billing_street) !== '' && !a.duplicate_of_account && !a.chow_current_account
}

export type StrongPath = 'street+zip' | 'street+city' | 'po-box-name'

export const PATH_CONFIDENCE: Record<StrongPath, number> = {
  'street+zip': 1,
  'street+city': 0.9,
  'po-box-name': 0.8,
}

/** Which strong rule (if any) links this account to the location. Address first; name only for PO box/empty streets. */
export function strongPath(loc: Location, a: Account): StrongPath | null {
  if (!isMatchable(a) || !eq(loc.state, a.billing_state)) return null
  const ls = normStreet(loc.street)
  if (ls !== '' && ls === normStreet(a.billing_street)) {
    if (eq(loc.zip, a.billing_zip)) return 'street+zip'
    if (eq(loc.city, a.billing_city)) return 'street+city'
    return null
  }
  const street = cleanText(a.billing_street)
  if (
    (street === '' || isPoBox(street)) &&
    (sameName(loc.name, a.name) || nameSimilarity(loc.name, a.name) >= 0.8) &&
    eq(loc.city, a.billing_city)
  ) {
    return 'po-box-name'
  }
  return null
}

const PATH_REASON: Record<StrongPath, string> = {
  'street+zip': 'same street and zip',
  'street+city': 'same street and city (zip differs)',
  'po-box-name': 'CRM street is a PO box or empty; same name and city/state',
}

export function findCandidates(loc: Location, accounts: Account[]): Candidate[] {
  const out: Candidate[] = []
  for (const a of accounts) {
    if (!isMatchable(a)) continue
    const path = strongPath(loc, a)
    if (path) {
      out.push({ account: a, strength: 'strong', reasons: [PATH_REASON[path]] })
      continue
    }
    const reasons: string[] = []
    if (eq(loc.zip, a.billing_zip) && normStreet(loc.street) !== normStreet(a.billing_street)) {
      reasons.push(`same zip ${cleanText(loc.zip)} but different street (${cleanText(a.billing_street)})`)
    }
    if (!eq(loc.state, a.billing_state) && nameSimilarity(loc.name, a.name) === 1) {
      reasons.push(`same name but different state (${cleanText(a.billing_state)})`)
    }
    if (reasons.length) out.push({ account: a, strength: 'weak', reasons })
  }
  return out
}
