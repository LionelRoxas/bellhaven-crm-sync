import { httpReader } from '@/crm/read'
import { openDb } from '@/store/db'
import { runPipeline } from '@/sync/pipeline'
import { startFakeCrmServer } from '../fake-crm-server'
import { fixtureFetcher } from '../helpers/site'
import { SITE_BASE } from '../helpers/data'

/** Starts the fake CRM (lives for the whole run) and seeds a fresh DB from the fixtures. */
export default async function globalSetup() {
  const server = await startFakeCrmServer({ port: Number(process.env.E2E_CRM_PORT), token: 'test' })
  const db = openDb(process.env.E2E_DB_PATH!)
  try {
    await runPipeline({
      fetchText: fixtureFetcher().fetchText,
      crm: httpReader({ crmApiBase: server.url, crmToken: 'test' }),
      db,
      siteBase: SITE_BASE,
      parentName: 'Bellhaven Senior Living (Parent Account)',
    })
  } finally {
    db.close()
  }
  return async () => {
    await server.close()
  }
}
