import { z } from 'zod'
import type { Account } from '../types'

export const AccountSchema = z.object({
  account_id: z.string(),
  name: z.string(),
  parent_id: z.string(),
  parent_name: z.string(),
  billing_street: z.string(),
  billing_city: z.string(),
  billing_state: z.string(),
  billing_zip: z.string(),
  care_type: z.string(),
  status: z.enum(['Active', 'Inactive', 'Needs Review']),
  phone: z.string(),
  lifetime_revenue: z.number(),
  outstanding_ar: z.number(),
  chow_current_account: z.string(),
  duplicate_of_account: z.string(),
  note: z.string(),
  created_by_candidate: z.boolean(),
  updated_at: z.string(),
}) satisfies z.ZodType<Account>

const PageSchema = z.object({
  data: z.array(z.unknown()),
  total: z.number(),
})

/** Holds only status and detail. Never the token, headers, or raw bodies. */
export class CrmError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(`CRM ${status}: ${detail}`)
    this.name = 'CrmError'
    this.status = status
    this.detail = detail
  }
}

export interface CrmReader {
  listAccounts(): Promise<Account[]>
  getAccount(id: string): Promise<Account>
}

export function assertAccountId(id: string): string {
  if (!/^[0-9A-Z]{18}$/.test(id)) throw new CrmError(400, 'Invalid account id')
  return id
}

const ATTEMPTS = 3
const PAGE_SIZE = 100
const MAX_PAGES = 1000
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function httpReader(
  cfg: { crmApiBase: string; crmToken: string },
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): CrmReader {
  const base = cfg.crmApiBase.replace(/\/+$/, '')

  async function getJson(path: string): Promise<unknown> {
    let last: CrmError = new CrmError(0, 'request failed')
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (attempt > 1) await sleep(50 * (attempt - 1))
      let res: Response
      try {
        res = await fetchImpl(`${base}${path}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${cfg.crmToken}`, Accept: 'application/json' },
        })
      } catch {
        last = new CrmError(0, 'network error')
        continue
      }
      if (res.ok) {
        try {
          return await res.json()
        } catch {
          throw new CrmError(res.status, 'invalid JSON response')
        }
      }
      let detail = res.statusText || 'request failed'
      try {
        const body = (await res.json()) as { detail?: unknown }
        if (typeof body?.detail === 'string') detail = body.detail
      } catch {
        // keep statusText
      }
      last = new CrmError(res.status, detail)
      if (res.status < 500) throw last
    }
    throw last
  }

  function parseAccount(raw: unknown): Account {
    const r = AccountSchema.safeParse(raw)
    if (!r.success) throw new CrmError(502, 'invalid account payload')
    return r.data
  }

  return {
    async listAccounts() {
      const out: Account[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const body = PageSchema.safeParse(await getJson(`/accounts?page=${page}&page_size=${PAGE_SIZE}`))
        if (!body.success) throw new CrmError(502, 'invalid page payload')
        for (const row of body.data.data) out.push(parseAccount(row))
        if (out.length >= body.data.total || body.data.data.length === 0) return out
      }
      throw new CrmError(502, 'too many pages')
    },
    async getAccount(id) {
      return parseAccount(await getJson(`/accounts/${encodeURIComponent(assertAccountId(id))}`))
    },
  }
}
