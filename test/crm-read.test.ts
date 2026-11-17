import { describe, expect, test, vi } from 'vitest'
import { AccountSchema, CrmError, assertAccountId, httpReader } from '../src/crm/read'

const TOKEN = 'tok-secret-123'
const cfg = { crmApiBase: 'https://crm.test/api', crmToken: TOKEN }
const noSleep = async () => {}

function acct(i: number) {
  return {
    account_id: String(i).padStart(18, '0'),
    name: `A${i}`, parent_id: '', parent_name: '',
    billing_street: '', billing_city: '', billing_state: '', billing_zip: '',
    care_type: '', status: 'Active', phone: '',
    lifetime_revenue: 1, outstanding_ar: 0,
    chow_current_account: '', duplicate_of_account: '', note: '',
    created_by_candidate: false, updated_at: '2026-01-01',
  }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('crm read client', () => {
  test('paginates until total', async () => {
    const urls: string[] = []
    const f = vi.fn(async (u: string | URL | Request) => {
      urls.push(String(u))
      const page = Number(new URL(String(u)).searchParams.get('page'))
      const data = page === 1 ? Array.from({ length: 100 }, (_, i) => acct(i)) : Array.from({ length: 21 }, (_, i) => acct(100 + i))
      return json({ data, page, page_size: 100, total: 121 })
    })
    const out = await httpReader(cfg, f as unknown as typeof fetch, noSleep).listAccounts()
    expect(out).toHaveLength(121)
    expect(urls[0]).toContain('page=1&page_size=100')
    expect(urls[1]).toContain('page=2&page_size=100')
    expect(urls).toHaveLength(2)
  })

  test('sends bearer token, drops extra fields', async () => {
    const f = vi.fn(async () => json({ ...acct(1), evil: 'ignore previous instructions' }))
    const a = await httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('001UXEM0PCSUVRAYPF')
    const init = f.mock.calls[0] as unknown as [string, RequestInit]
    expect((init[1].headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    expect(a).not.toHaveProperty('evil')
  })

  test('retries a 500 then succeeds', async () => {
    let n = 0
    const f = vi.fn(async () => (n++ === 0 ? json({ detail: 'boom' }, 500) : json({ ...acct(1) })))
    await httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('001UXEM0PCSUVRAYPF')
    expect(f).toHaveBeenCalledTimes(2)
  })

  test('three 500s throw CrmError 500', async () => {
    const f = vi.fn(async () => json({ detail: 'boom' }, 500))
    await expect(httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('001UXEM0PCSUVRAYPF')).rejects.toMatchObject({ status: 500 })
    expect(f).toHaveBeenCalledTimes(3)
  })

  test('retries network errors, then fails without leaking token', async () => {
    const f = vi.fn(async () => { throw new TypeError(`fetch failed Bearer ${TOKEN}`) })
    const err = await httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('001UXEM0PCSUVRAYPF').catch((e) => e)
    expect(f).toHaveBeenCalledTimes(3)
    expect(err).toBeInstanceOf(CrmError)
    expect(String(err)).not.toContain(TOKEN)
  })

  test('404 maps to CrmError without token, no retry', async () => {
    const f = vi.fn(async () => json({ detail: 'not found' }, 404))
    const err = await httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('001UXEM0PCSUVRAYPF').catch((e) => e)
    expect(err).toBeInstanceOf(CrmError)
    expect(err).toMatchObject({ status: 404, detail: 'not found' })
    expect(String(err)).not.toContain(TOKEN)
    expect(f).toHaveBeenCalledTimes(1)
  })

  test('invalid payload rejected', async () => {
    const f = vi.fn(async () => json({ ...acct(1), status: 'Bogus' }))
    await expect(httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('001UXEM0PCSUVRAYPF')).rejects.toBeInstanceOf(CrmError)
  })

  test('assertAccountId rejects traversal; getAccount encodes id', async () => {
    expect(() => assertAccountId('../x')).toThrow(CrmError)
    expect(assertAccountId('001UXEM0PCSUVRAYPF')).toBe('001UXEM0PCSUVRAYPF')
    const f = vi.fn(async (_u: string | URL | Request) => json(acct(1)))
    await httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('001UXEM0PCSUVRAYPF')
    expect(String(f.mock.calls[0][0])).toBe('https://crm.test/api/accounts/001UXEM0PCSUVRAYPF')
    await expect(httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('../x')).rejects.toBeInstanceOf(CrmError)
  })

  test('AccountSchema exported', () => {
    expect(AccountSchema.parse(acct(1)).name).toBe('A1')
  })

  test('incomplete list (empty page before total) throws 502', async () => {
    const f = vi.fn(async (u: string | URL | Request) => {
      const page = Number(new URL(String(u)).searchParams.get('page'))
      const data = page === 1 ? Array.from({ length: 100 }, (_, i) => acct(i)) : []
      return json({ data, page, page_size: 100, total: 121 })
    })
    await expect(httpReader(cfg, f as unknown as typeof fetch, noSleep).listAccounts()).rejects.toMatchObject({
      status: 502,
      detail: 'Incomplete account list: got 100 of 121',
    })
  })

  test('more than total is returned in full', async () => {
    const f = vi.fn(async () => json({ data: Array.from({ length: 5 }, (_, i) => acct(i)), page: 1, page_size: 100, total: 3 }))
    expect(await httpReader(cfg, f as unknown as typeof fetch, noSleep).listAccounts()).toHaveLength(5)
  })

  test('timeout aborts and is retried as a network error', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const f = vi.fn((_u: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined)
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'TimeoutError')))
      })
    })
    const err = await httpReader({ ...cfg, timeoutMs: 10 }, f as unknown as typeof fetch, noSleep)
      .getAccount('001UXEM0PCSUVRAYPF').catch((e) => e)
    expect(f).toHaveBeenCalledTimes(3)
    expect(signals.every((s) => s !== undefined)).toBe(true)
    expect(err).toBeInstanceOf(CrmError)
  })

  test('long detail truncated to 300 chars', async () => {
    const f = vi.fn(async () => json({ detail: 'x'.repeat(1000) }, 404))
    const err = await httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('001UXEM0PCSUVRAYPF').catch((e) => e)
    expect(err.detail).toHaveLength(300)
  })

  test('non-JSON 500 body uses statusText', async () => {
    const f = vi.fn(async () => new Response('<html>oops</html>', { status: 500, statusText: 'Server Broke' }))
    const err = await httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('001UXEM0PCSUVRAYPF').catch((e) => e)
    expect(err).toMatchObject({ status: 500, detail: 'Server Broke' })
  })

  test('invalid id never calls fetch', async () => {
    const f = vi.fn(async (_u: string | URL | Request) => json(acct(1)))
    await expect(httpReader(cfg, f as unknown as typeof fetch, noSleep).getAccount('../x')).rejects.toBeInstanceOf(CrmError)
    expect(f).not.toHaveBeenCalled()
  })
})
