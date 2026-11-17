import { existsSync } from 'node:fs'
import { addSecondOpinions } from '../src/ai/second-opinion'
import { groqJson } from '../src/ai/groq'
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
    const apiKey = cfg.groqApiKey
    const ask = apiKey
      ? (system: string, user: string, schemaName: string, schema: object) =>
          groqJson({ apiKey, model: cfg.groqModel, system, user, schemaName, schema })
      : null
    const s = await runPipeline({
      fetchText,
      crm: httpReader(cfg),
      db,
      siteBase: cfg.siteBase,
      parentName: cfg.parentName,
      secondOpinion: (drafts, c) => addSecondOpinions(drafts, { ...c, ask, model: cfg.groqModel, cache: db }),
    })
    console.log(
      `run ${s.runId}: ${s.locations} locations, ${s.accounts} accounts, ` +
        `${s.created} created, ${s.refreshed} refreshed, ${s.suppressed} suppressed, ${s.superseded} superseded, ` +
        `${s.held} held (touch an approved or failed proposal)`,
    )
    const counts: Record<string, number> = {}
    for (const p of db.listProposals({ status: 'pending' })) counts[p.type] = (counts[p.type] ?? 0) + 1
    const ai: Record<string, number> = {}
    for (const p of db.listProposals({ status: 'pending' })) {
      const o = p.evidence.aiOpinion
      if (o) ai[o.status] = (ai[o.status] ?? 0) + 1
    }
    console.log(`AI second opinions on pending proposals: ${JSON.stringify(ai)}${ask ? '' : ' (no Groq key set)'}`)
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
