import type { Account, Candidate, Evidence, Location, ProposalDraft, ProposalType, Step } from '@/types'
import { cleanText, isPoBox, normStreet, sameName } from './normalize'
import { findCandidates, isMatchable, PATH_CONFIDENCE, strongPath } from './match'
import { findSuspicious, rankSurvivor, SOP_RULE, sopBranch, targetCareType } from './rules'

/*
 * Every decision here is made from structured fields (addresses, ids, parent, revenue/AR, status).
 * Free text from the CRM or the website (names, notes) never selects a type, a target account or a
 * body; names are only compared and copied as website values, notes only surface as evidence.
 */

const DEFAULT_SITE_BASE = 'https://analyst-assessment-production.up.railway.app'
const SNAPSHOT_FIELDS = [
  'parent_id', 'status', 'name', 'billing_street', 'billing_city', 'billing_state', 'billing_zip',
  'care_type', 'chow_current_account', 'duplicate_of_account', 'note',
] as const

const FIELD_LABEL: Record<string, string> = {
  name: 'name', billing_street: 'street', billing_city: 'city', billing_state: 'state',
  billing_zip: 'zip', care_type: 'care type',
}

const eq = (a: string, b: string) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase()

function snapshotOf(a: Account): Partial<Account> {
  const s: Partial<Account> = {}
  for (const f of SNAPSHOT_FIELDS) (s as Record<string, string>)[f] = a[f]
  return s
}

/** POST body for a new Bellhaven account built only from website values. */
function newAccountBody(loc: Location, bellhavenId: string): Record<string, string> {
  return {
    name: cleanText(loc.name),
    billing_street: cleanText(loc.street),
    billing_city: cleanText(loc.city),
    billing_state: cleanText(loc.state),
    billing_zip: cleanText(loc.zip),
    care_type: targetCareType(loc, '') ?? '',
    parent_id: bellhavenId,
    status: 'Active',
  }
}

/** Fields where the website differs from the account; values are the cleaned website values. */
export function changedFields(loc: Location, a: Account): Record<string, string> {
  const out: Record<string, string> = {}
  if (!sameName(loc.name, a.name)) out.name = cleanText(loc.name)
  const crmStreet = cleanText(a.billing_street)
  if (crmStreet === '' || isPoBox(crmStreet) || normStreet(loc.street) !== normStreet(crmStreet)) {
    out.billing_street = cleanText(loc.street)
  }
  if (!eq(loc.city, a.billing_city)) out.billing_city = cleanText(loc.city)
  if (!eq(loc.state, a.billing_state)) out.billing_state = cleanText(loc.state)
  if (!eq(loc.zip, a.billing_zip)) out.billing_zip = cleanText(loc.zip)
  const care = targetCareType(loc, a.care_type)
  if (care !== null) out.care_type = care
  return out
}

function baseEvidence(loc: Location | null, involved: Account[]): Evidence {
  return {
    location: loc,
    accounts: involved,
    candidates: [],
    notLinked: [],
    sop: null,
    suspiciousText: involved.flatMap((a) =>
      findSuspicious(a).map((s) => ({ accountId: a.account_id, field: s.field, text: s.text })),
    ),
  }
}

function sopEvidence(a: Account) {
  return { revenue: a.lifetime_revenue, ar: a.outstanding_ar, rule: SOP_RULE }
}

/** Already-handled accounts at the location's address: shown, never linked. */
function handledAtAddress(loc: Location, accounts: Account[]) {
  const street = normStreet(loc.street)
  return accounts
    .filter((a) => cleanText(a.billing_street) !== '' && !isMatchable(a))
    .filter((a) => street !== '' && normStreet(a.billing_street) === street && eq(a.billing_zip, loc.zip))
    .map((a) => ({
      accountId: a.account_id,
      why: a.duplicate_of_account
        ? `already marked duplicate of ${a.duplicate_of_account}`
        : `already linked to CHOW account ${a.chow_current_account}`,
    }))
}

function locationDraft(loc: Location, accounts: Account[], bellhavenId: string): ProposalDraft {
  const candidates = findCandidates(loc, accounts)
  const strong = candidates.filter((c) => c.strength === 'strong')
  const weak = candidates.filter((c) => c.strength === 'weak')
  const notLinked = [
    ...weak.map((c) => ({ accountId: c.account.account_id, why: c.reasons.join('; ') })),
    ...handledAtAddress(loc, accounts),
  ]
  const candidateEvidence = candidates.map((c: Candidate) => ({
    accountId: c.account.account_id,
    strength: c.strength,
    reasons: c.reasons,
  }))
  const title = cleanText(loc.name)

  if (strong.length === 0) {
    // No account is involved; weak candidates are shown for the reviewer but never linked.
    // Their free text is still scanned so the reviewer sees flagged lookalikes.
    const evidence = baseEvidence(loc, weak.map((c) => c.account))
    evidence.candidates = candidateEvidence
    evidence.notLinked = notLinked
    return {
      type: 'create',
      locationSlug: loc.slug,
      accountIds: [],
      title,
      summary: `Create new Bellhaven account for ${title}`,
      confidence: weak.length ? 0.6 : 0.9,
      evidence,
      snapshot: {},
      steps: [
        { method: 'POST', accountId: null, body: newAccountBody(loc, bellhavenId), noteReason: `Created from ${loc.url}` },
      ],
    }
  }

  const ranked = rankSurvivor(strong.map((c) => c.account), bellhavenId, loc)
  const survivor = ranked[0]
  // A CHOW whose new Bellhaven account already exists (e.g. a half-applied CHOW): link to it
  // instead of creating a second one, and never mark it as a duplicate.
  const existingTarget =
    survivor.parent_id !== bellhavenId && sopBranch(survivor) === 'chow'
      ? ranked.slice(1).find((a) => a.parent_id === bellhavenId) ?? null
      : null
  const losers = ranked.slice(1).filter((a) => a !== existingTarget)
  const involved = ranked
  const steps: Step[] = []
  const evidence = baseEvidence(loc, involved)
  evidence.candidates = candidateEvidence
  evidence.notLinked = notLinked

  let type: ProposalType
  let summary: string
  const changed = changedFields(loc, survivor)
  const changedList = Object.keys(changed).map((k) => FIELD_LABEL[k] ?? k).join(', ')

  if (survivor.parent_id === bellhavenId) {
    if (Object.keys(changed).length) {
      steps.push({ method: 'PATCH', accountId: survivor.account_id, body: changed, noteReason: null })
      type = 'update_fields'
      summary = changed.name ? `Rename to ${changed.name}` : `Update ${changedList}`
      if (changed.name && Object.keys(changed).length > 1) summary += `; update ${changedList}`
    } else {
      type = 'confirmed'
      summary = 'Already under Bellhaven; nothing to change'
    }
  } else {
    evidence.sop = sopEvidence(survivor)
    const from = survivor.parent_name ? `from ${cleanText(survivor.parent_name)}` : 'from no parent'
    if (existingTarget) {
      steps.push({
        method: 'PATCH',
        accountId: survivor.account_id,
        body: { chow_current_account: existingTarget.account_id },
        noteReason: null,
      })
      type = 'chow'
      summary = `Move to Bellhaven (CHOW): link the old one ${from} to the existing Bellhaven account ${existingTarget.account_id}`
    } else if (sopBranch(survivor) === 'chow') {
      steps.push(
        { method: 'POST', accountId: null, body: newAccountBody(loc, bellhavenId), noteReason: `Created from ${loc.url}` },
        { method: 'PATCH', accountId: survivor.account_id, body: { chow_current_account: { $ref: 'created' } }, noteReason: null },
      )
      type = 'chow'
      summary = `Move to Bellhaven: create new account (CHOW) and link the old one ${from}`
    } else {
      steps.push({
        method: 'PATCH',
        accountId: survivor.account_id,
        body: { parent_id: bellhavenId, ...changed },
        noteReason: `Moved to Bellhaven: listed at ${loc.url}`,
      })
      type = 'reparent'
      summary = `Move to Bellhaven ${from}` + (changedList ? `; update ${changedList}` : '')
    }
  }

  if (losers.length) {
    for (const l of losers) {
      steps.push({
        method: 'PATCH',
        accountId: l.account_id,
        body: { duplicate_of_account: survivor.account_id, status: 'Inactive' },
        noteReason: `Duplicate of ${survivor.account_id} (same address as ${title})`,
      })
    }
    summary = `Merge ${losers.length} duplicate${losers.length > 1 ? 's' : ''} into ${survivor.account_id}` +
      (type === 'confirmed' ? '' : `; ${summary}`)
    // Precedence: chow > duplicate > reparent > update_fields.
    if (type !== 'chow') type = 'duplicate'
  }

  const path = strongPath(loc, survivor)
  return {
    type,
    locationSlug: loc.slug,
    accountIds: involved.map((a) => a.account_id),
    title,
    summary,
    confidence: path ? PATH_CONFIDENCE[path] : 0,
    evidence,
    snapshot: Object.fromEntries(involved.map((a) => [a.account_id, snapshotOf(a)])),
    steps,
  }
}

function unlistedDraft(
  a: Account,
  accounts: Account[],
  bellhavenId: string,
  siteBase: string,
): ProposalDraft | null {
  const street = normStreet(a.billing_street)
  const buyers = accounts.filter(
    (b) =>
      b.account_id !== a.account_id &&
      b.parent_id !== bellhavenId &&
      isMatchable(b) &&
      street !== '' &&
      normStreet(b.billing_street) === street &&
      eq(b.billing_zip, a.billing_zip),
  )
  const name = cleanText(a.name)

  if (buyers.length) {
    const asLocation: Location = {
      slug: '', name: a.name, street: a.billing_street, city: a.billing_city, state: a.billing_state,
      zip: a.billing_zip, offerings: [], url: '',
    }
    const buyer = rankSurvivor(buyers, bellhavenId, asLocation)[0]
    const involved = [a, buyer]
    const evidence = baseEvidence(null, involved)
    evidence.sop = sopEvidence(a)
    evidence.candidates = buyers.map((b) => ({
      accountId: b.account_id,
      strength: b === buyer ? 'strong' : 'weak',
      reasons: ['same street and zip, under another operator'],
    }))
    const chow = sopBranch(a) === 'chow'
    const step: Step = chow
      ? { method: 'PATCH', accountId: a.account_id, body: { chow_current_account: buyer.account_id }, noteReason: null }
      : {
          method: 'PATCH',
          accountId: a.account_id,
          body: { duplicate_of_account: buyer.account_id, status: 'Inactive' },
          noteReason: `Duplicate of ${buyer.account_id} (not listed on ${siteBase}/communities; same address now under another operator)`,
        }
    return {
      type: 'sold',
      locationSlug: null,
      accountIds: involved.map((x) => x.account_id),
      title: name,
      summary: chow
        ? `Sold: link to the new owner's account ${buyer.account_id} (CHOW)`
        : `Sold: mark as duplicate of the new owner's account ${buyer.account_id}`,
      confidence: 1,
      evidence,
      snapshot: Object.fromEntries(involved.map((x) => [x.account_id, snapshotOf(x)])),
      steps: [step],
    }
  }

  if (a.status === 'Needs Review' && a.note.includes('[bellhaven-sync')) return null
  return {
    type: 'stale',
    locationSlug: null,
    accountIds: [a.account_id],
    title: name,
    summary: 'Not on the website: mark Needs Review',
    confidence: 0.7,
    evidence: baseEvidence(null, [a]),
    snapshot: { [a.account_id]: snapshotOf(a) },
    steps: [
      {
        method: 'PATCH',
        accountId: a.account_id,
        body: { status: 'Needs Review' },
        noteReason: `Not listed on ${siteBase}/communities as of the last run; ownership unknown`,
      },
    ],
  }
}

/**
 * One draft per website location, plus one per Bellhaven child account that no location matches
 * (stale or sold). Pure and deterministic; proposes only, never writes.
 */
export function classify(
  locations: Location[],
  accounts: Account[],
  bellhavenId: string,
  siteBase: string = DEFAULT_SITE_BASE,
): ProposalDraft[] {
  const drafts = locations.map((loc) => locationDraft(loc, accounts, bellhavenId))

  const matched = new Set<string>()
  for (const loc of locations) {
    for (const a of accounts) if (strongPath(loc, a)) matched.add(a.account_id)
  }

  const unlisted = accounts
    .filter((a) => a.parent_id === bellhavenId && isMatchable(a) && !matched.has(a.account_id))
    .sort((x, y) => (x.account_id < y.account_id ? -1 : x.account_id > y.account_id ? 1 : 0))
  for (const a of unlisted) {
    const d = unlistedDraft(a, accounts, bellhavenId, siteBase.replace(/\/+$/, ''))
    if (d) drafts.push(d)
  }
  return drafts
}
