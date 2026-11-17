import { describe, expect, test, vi } from 'vitest'
import { httpWriter } from '@/crm/write'
import { CrmError } from '@/crm/read'
import { UnknownOutcomeError } from '@/crm/contracts'

const TOKEN = 'tok-secret-123'
const cfg = { crmApiBase: 'https://crm.test/api/', crmToken: TOKEN }
const ID = '001UXEM0PCSUVRAYPF'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const mk = (impl: () => Promise<Response>) => {
  const f = vi.fn(impl)
  return { f, w: httpWriter(cfg, f as unknown as typeof fetch) }
}
const call = (f: ReturnType<typeof vi.fn>, i = 0) => f.mock.calls[i] as unknown as [string, RequestInit]

describe('crm write client', () => {
  test('POST sends JSON with the bearer token and a timeout, returns the id', async () => {
    const { f, w } = mk(async () => json({ account_id: ID }, 201))
    await expect(w.createAccount({ name: 'X' })).resolves.toEqual({ account_id: ID })
    const [url, init] = call(f)
    expect(url).toBe('https://crm.test/api/accounts')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'X' })
    const h = init.headers as Record<string, string>
    expect(h.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(h['Content-Type']).toBe('application/json')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  test('POST accepts id or data.account_id', async () => {
    await expect(mk(async () => json({ id: ID })).w.createAccount({})).resolves.toEqual({ account_id: ID })
    await expect(mk(async () => json({ data: { account_id: ID } })).w.createAccount({})).resolves.toEqual({ account_id: ID })
  })

  test('POST with an unparseable or invalid id is an unknown outcome', async () => {
    for (const body of [{ ok: true }, { account_id: 'nope' }, { account_id: 7 }, null]) {
      await expect(mk(async () => json(body)).w.createAccount({})).rejects.toBeInstanceOf(UnknownOutcomeError)
    }
    const notJson = mk(async () => new Response('<html>', { status: 200 }))
    await expect(notJson.w.createAccount({})).rejects.toBeInstanceOf(UnknownOutcomeError)
  })

  test('network errors and timeouts on writes are unknown outcomes, never retried, no token leak', async () => {
    const { f, w } = mk(async () => { throw new TypeError(`fetch failed Bearer ${TOKEN}`) })
    const e = await w.createAccount({}).catch((x) => x)
    expect(e).toBeInstanceOf(UnknownOutcomeError)
    expect(String(e.message)).not.toContain(TOKEN)
    expect(f).toHaveBeenCalledTimes(1)
    const p = mk(async () => { throw new DOMException('timed out', 'TimeoutError') })
    await expect(p.w.patchAccount(ID, { status: 'Inactive' })).rejects.toBeInstanceOf(UnknownOutcomeError)
    expect(p.f).toHaveBeenCalledTimes(1)
  })

  test('HTTP errors throw CrmError with the detail, never retried', async () => {
    const { f, w } = mk(async () => json({ detail: 'bad field' }, 422))
    await expect(w.patchAccount(ID, { x: '1' })).rejects.toMatchObject({ status: 422, detail: 'bad field' })
    expect(f).toHaveBeenCalledTimes(1)
    const s = mk(async () => json({ detail: 'boom' }, 500))
    await expect(s.w.createAccount({})).rejects.toBeInstanceOf(CrmError)
    expect(s.f).toHaveBeenCalledTimes(1)
  })

  test('a 422 detail array (FastAPI validation errors) is formatted, not lost', async () => {
    const body = {
      detail: [
        { loc: ['body', 'care_type'], msg: 'Input should be Skilled Nursing, Memory Care or Assisted Living', type: 'enum' },
        { loc: ['body', 'billing_zip'], msg: 'String should match pattern', type: 'string_pattern_mismatch' },
      ],
    }
    const { w } = mk(async () => json(body, 422))
    await expect(w.patchAccount(ID, { care_type: 'X' })).rejects.toMatchObject({
      status: 422,
      detail:
        'body.care_type: Input should be Skilled Nursing, Memory Care or Assisted Living; body.billing_zip: String should match pattern',
    })
    const long = { detail: Array.from({ length: 40 }, (_, i) => ({ loc: ['body', `f${i}`], msg: 'bad value here', type: 't' })) }
    const e = await mk(async () => json(long, 422)).w.createAccount({}).catch((x) => x)
    expect(e).toBeInstanceOf(CrmError)
    expect(e.detail).toHaveLength(300)
    expect(e.detail.startsWith('body.f0: bad value here; body.f1: bad value here')).toBe(true)
  })

  test('PATCH targets the encoded account id and rejects malformed ids before calling', async () => {
    const { f, w } = mk(async () => json({ account_id: ID }))
    await w.patchAccount(ID, { status: 'Inactive' })
    const [url, init] = call(f)
    expect(url).toBe(`https://crm.test/api/accounts/${ID}`)
    expect(init.method).toBe('PATCH')
    await expect(w.patchAccount('../x', {})).rejects.toBeInstanceOf(CrmError)
    expect(f).toHaveBeenCalledTimes(1)
  })
})
