import 'server-only'
import { CrmError, assertAccountId } from './read'
import { UnknownOutcomeError, type CrmWriter } from './contracts'

export type { CrmWriter } from './contracts'

const DEFAULT_TIMEOUT_MS = 15000
const ACCOUNT_ID = /^[0-9A-Z]{18}$/

/**
 * The live POST success body is not verified, so accept the id at `account_id`, `id` or
 * `data.account_id`. Anything else means we cannot tell which account was created.
 */
function createdId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const o = body as Record<string, unknown>
  const data = o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {}
  for (const v of [o.account_id, o.id, data.account_id]) {
    if (typeof v === 'string' && ACCOUNT_ID.test(v)) return v
  }
  return null
}

/**
 * The only code that writes to the CRM. Used only by `src/apply`. Writes are never retried:
 * a network error, timeout or unreadable POST response throws `UnknownOutcomeError` because
 * the write may have landed. HTTP errors throw `CrmError` with only the response's `detail`.
 */
export function httpWriter(
  cfg: { crmApiBase: string; crmToken: string; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): CrmWriter {
  const base = cfg.crmApiBase.replace(/\/+$/, '')

  async function send(method: 'POST' | 'PATCH', path: string, body: Record<string, string>): Promise<Response> {
    let res: Response
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.crmToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      })
    } catch {
      // Never include the underlying error: it can echo request options.
      throw new UnknownOutcomeError('network error or timeout')
    }
    if (res.ok) return res
    let detail = res.statusText || 'request failed'
    try {
      const b = (await res.json()) as { detail?: unknown }
      if (typeof b?.detail === 'string') detail = b.detail
    } catch {
      // keep statusText
    }
    throw new CrmError(res.status, detail)
  }

  return {
    async createAccount(body) {
      const res = await send('POST', '/accounts', body)
      let parsed: unknown
      try {
        parsed = await res.json()
      } catch {
        throw new UnknownOutcomeError('unreadable create response')
      }
      const id = createdId(parsed)
      if (!id) throw new UnknownOutcomeError('create response has no account id')
      return { account_id: id }
    },

    async patchAccount(id, body) {
      const res = await send('PATCH', `/accounts/${encodeURIComponent(assertAccountId(id))}`, body)
      // 2xx: the write landed. Drain the body; a failure here doesn't change that.
      await res.text().catch(() => {})
    },
  }
}
