import type { ProposalType } from '@/types'
import type { Status } from '@/store/db'

export const TYPE_LABELS: Record<ProposalType, string> = {
  confirmed: 'Confirmed',
  update_fields: 'Field update',
  reparent: 'Move to Bellhaven',
  chow: 'CHOW',
  duplicate: 'Duplicate',
  create: 'New account',
  stale: 'Not on website',
  sold: 'Sold',
}

export const STATUS_LABELS: Record<Status, string> = {
  info: 'No change',
  pending: 'Pending',
  approved: 'Applying',
  applied: 'Applied',
  failed: 'Failed',
  rejected: 'Rejected',
  superseded: 'Superseded',
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
export const money = (n: number) => usd.format(n)

/** `2026-11-16 23:50 UTC`; deterministic, no locale. */
export function utc(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`
}

/** Only http(s) URLs may become links. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  billing_street: 'Street',
  billing_city: 'City',
  billing_state: 'State',
  billing_zip: 'Zip',
  care_type: 'Care type',
  parent_id: 'Parent',
  status: 'Status',
  chow_current_account: 'CHOW current account',
  duplicate_of_account: 'Duplicate of',
  note: 'Note',
}

export const confidenceLabel = (c: number) => `${Math.round(c * 100)}%`
