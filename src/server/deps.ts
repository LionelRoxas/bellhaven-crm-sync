import 'server-only'
import { loadConfig, type Config } from '@/config'
import { openDb, type Db } from '@/store/db'
import { httpReader } from '@/crm/read'
import { httpWriter } from '@/crm/write'
import type { Crm } from '@/apply/apply'

// Kept on globalThis so dev-mode module reloads reuse one SQLite connection.
const g = globalThis as typeof globalThis & { __bhDb?: Db; __bhCrm?: Crm; __bhCfg?: Config }

export function getConfig(): Config {
  return (g.__bhCfg ??= loadConfig())
}

export function getDb(): Db {
  return (g.__bhDb ??= openDb(getConfig().dbPath))
}

/** Reader + writer over the live CRM API. The token stays in this server-only module. */
export function getCrm(): Crm {
  if (!g.__bhCrm) {
    const cfg = getConfig()
    const reader = httpReader(cfg)
    const writer = httpWriter(cfg)
    g.__bhCrm = {
      listAccounts: reader.listAccounts,
      getAccount: reader.getAccount,
      createAccount: writer.createAccount,
      patchAccount: writer.patchAccount,
    }
  }
  return g.__bhCrm
}
