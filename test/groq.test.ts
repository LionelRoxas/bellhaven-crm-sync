import { describe, expect, it } from 'vitest'
import { groqJson } from '@/ai/groq'

const KEY = 'gsk_secret_key_123'
const base = {
  apiKey: KEY,
  model: 'openai/gpt-oss-120b',
  system: 'sys',
  user: 'usr',
  schemaName: 'thing',
  schema: { type: 'object', properties: {}, additionalProperties: false },
}

function fakeFetch(res: { ok?: boolean; status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const status = res.status ?? 200
    return {
      ok: res.ok ?? (status >= 200 && status < 300),
      status,
      json: async () => res.body,
      text: async () => res.text ?? JSON.stringify(res.body),
    }
  }) as unknown as typeof fetch
  return { impl, calls }
}

const okBody = (content: string) => ({ choices: [{ message: { content } }] })

describe('groqJson', () => {
  it('posts the request in the expected shape', async () => {
    const f = fakeFetch({ body: okBody('{"a":1}') })
    await groqJson({ ...base, fetchImpl: f.impl })
    const { url, init } = f.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('openai/gpt-oss-120b')
    expect(body.temperature).toBe(0)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema).toEqual({ name: 'thing', strict: true, schema: base.schema })
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ])
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('returns the parsed message content', async () => {
    const f = fakeFetch({ body: okBody('{"a":1}') })
    expect(await groqJson({ ...base, fetchImpl: f.impl })).toEqual({ a: 1 })
  })
  it('throws with the status but not the key on non-2xx', async () => {
    const f = fakeFetch({ status: 401, text: `bad key ${KEY}` })
    const err = await groqJson({ ...base, fetchImpl: f.impl }).catch((e) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('401')
    expect((err as Error).message).not.toContain(KEY)
  })
  it('throws on unparseable content', async () => {
    const f = fakeFetch({ body: okBody('not json') })
    await expect(groqJson({ ...base, fetchImpl: f.impl })).rejects.toThrow(/parse|JSON/i)
  })
  it('throws when content is missing', async () => {
    const f = fakeFetch({ body: { choices: [] } })
    await expect(groqJson({ ...base, fetchImpl: f.impl })).rejects.toThrow()
  })
})
