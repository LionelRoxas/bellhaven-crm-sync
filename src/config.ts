export type Config = {
  crmApiBase: string
  crmToken: string
  siteBase: string
  parentName: string
  dbPath: string
}

function required(env: NodeJS.ProcessEnv | Record<string, string | undefined>, name: string): string {
  const v = env[name]
  if (!v) throw new Error(`Missing ${name}`)
  return v
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    crmApiBase: required(env, 'CRM_API_BASE'),
    crmToken: required(env, 'CRM_TOKEN'),
    siteBase: env.SITE_BASE || 'https://analyst-assessment-production.up.railway.app',
    parentName: env.BELLHAVEN_PARENT_NAME || 'Bellhaven Senior Living (Parent Account)',
    dbPath: env.DB_PATH || 'data/sync.db',
  }
}
