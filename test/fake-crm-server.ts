import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CrmError } from '@/crm/read'
import { FakeCrm } from './fake-crm'

export type FakeCrmServer = { url: string; crm: FakeCrm; close: () => Promise<void> }

const MAX_BODY = 64 * 1024

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) throw new CrmError(413, 'Body too large')
    chunks.push(c as Buffer)
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v
  } catch {
    throw new CrmError(400, 'Invalid JSON body')
  }
}

/**
 * HTTP front for `FakeCrm`, shaped like the CRM API: `GET/POST /accounts`, `GET/PATCH /accounts/:id`.
 * Requires `Authorization: Bearer <token>`. For e2e tests only.
 */
export async function startFakeCrmServer(opts: { port?: number; token: string; crm?: FakeCrm }): Promise<FakeCrmServer> {
  const crm = opts.crm ?? new FakeCrm()
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${opts.token}`) return send(res, 401, { detail: 'Unauthorized' })
      const url = new URL(req.url ?? '/', 'http://fake')
      const one = /^\/accounts\/([^/]+)$/.exec(url.pathname)
      if (url.pathname === '/accounts' && req.method === 'GET') {
        const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
        const size = Math.min(500, Math.max(1, Number(url.searchParams.get('page_size') ?? 100) || 100))
        const all = await crm.listAccounts()
        return send(res, 200, { data: all.slice((page - 1) * size, page * size), total: all.length })
      }
      if (url.pathname === '/accounts' && req.method === 'POST') {
        const { account_id } = await crm.createAccount(await readJson(req))
        return send(res, 201, await crm.getAccount(account_id))
      }
      if (one && req.method === 'GET') return send(res, 200, await crm.getAccount(decodeURIComponent(one[1])))
      if (one && req.method === 'PATCH') {
        const id = decodeURIComponent(one[1])
        await crm.patchAccount(id, await readJson(req))
        return send(res, 200, await crm.getAccount(id))
      }
      return send(res, 404, { detail: 'Not found' })
    } catch (e) {
      if (e instanceof CrmError) return send(res, e.status || 500, { detail: e.detail })
      return send(res, 500, { detail: 'Internal error' })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    crm,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
