export type Location = {
  slug: string
  name: string
  street: string
  city: string
  state: string
  zip: string
  offerings: string[]
  url: string
}

/** CRM read shape. */
export type Account = {
  account_id: string
  name: string
  parent_id: string
  parent_name: string
  billing_street: string
  billing_city: string
  billing_state: string
  billing_zip: string
  care_type: string
  status: string
  phone: string
  lifetime_revenue: number
  outstanding_ar: number
  chow_current_account: string
  duplicate_of_account: string
  note: string
  created_by_candidate: boolean
  updated_at: string
}

export type ProposalType =
  | 'confirmed'
  | 'update_fields'
  | 'reparent'
  | 'chow'
  | 'duplicate'
  | 'create'
  | 'stale'
  | 'sold'

export type Ref = { $ref: 'created' }

export type Step = {
  method: 'POST' | 'PATCH'
  accountId: string | null
  body: Record<string, string | Ref>
  noteReason: string | null
}

export type Candidate = {
  account: Account
  strength: 'strong' | 'weak'
  reasons: string[]
}

export type Evidence = {
  location: Location | null
  accounts: Account[]
  candidates: { accountId: string; strength: string; reasons: string[] }[]
  notLinked: { accountId: string; why: string }[]
  sop: { revenue: number; ar: number; rule: string } | null
  suspiciousText: { accountId: string; field: string; text: string }[]
}

export type ProposalDraft = {
  type: ProposalType
  locationSlug: string | null
  accountIds: string[]
  title: string
  summary: string
  confidence: number
  evidence: Evidence
  snapshot: Record<string, Partial<Account>>
  steps: Step[]
}
