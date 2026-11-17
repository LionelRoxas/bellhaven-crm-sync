import { existsSync } from 'node:fs'
import { loadConfig } from '../src/config'
import { httpReader } from '../src/crm/read'
import { openDb } from '../src/store/db'
import { runPipeline } from '../src/sync/pipeline'

async function main() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local')
  const cfg = loadConfig()
  const db = openDb(cfg.dbPath)
  try {
    const fetchText = async (path: string) => {
      const r = await fetch(cfg.siteBase + path, { signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error(`Site ${r.status} for ${path}`)
      return r.text()
    }
    const s = await runPipeline({
      fetchText,
      crm: httpReader(cfg),
      db,
      siteBase: cfg.siteBase,
      parentName: cfg.parentName,
    })
    console.log(
      `run ${s.runId}: ${s.locations} locations, ${s.accounts} accounts, ` +
        `${s.created} created, ${s.refreshed} refreshed, ${s.suppressed} suppressed, ${s.superseded} superseded, ` +
        `${s.held} held (touch an approved or failed proposal)`,
    )
    const counts: Record<string, number> = {}
    for (const p of db.listProposals({ status: 'pending' })) counts[p.type] = (counts[p.type] ?? 0) + 1
    const info = db.listProposals({ status: 'info' }).length
    console.log(`pending by type: ${JSON.stringify(counts)}; info (confirmed): ${info}`)
  } finally {
    db.close()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
