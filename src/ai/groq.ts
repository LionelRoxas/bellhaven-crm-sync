export type GroqJsonRequest = {
  apiKey: string
  model: string
  system: string
  user: string
  schemaName: string
  schema: object
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

export async function groqJson(req: GroqJsonRequest): Promise<unknown> {
  const doFetch = req.fetchImpl ?? fetch
  const res = await doFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}` },
    body: JSON.stringify({
      model: req.model,
      temperature: 0,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schemaName, strict: true, schema: req.schema },
      },
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 20000),
  })
  // Error messages carry only the status; never the key or the response body.
  if (!res.ok) throw new Error(`Groq request failed with status ${res.status}`)
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('Groq response had no message content')
  try {
    return JSON.parse(content)
  } catch {
    throw new Error('Groq response content was not valid JSON (parse failed)')
  }
}
