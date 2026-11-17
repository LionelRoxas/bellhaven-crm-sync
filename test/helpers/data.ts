import { readFileSync } from 'node:fs'
import type { Account, Location } from '@/types'
import { scrapeLocations } from '@/sync/scrape'
import { fixtureFetcher } from './site'

export const SITE_BASE = 'https://analyst-assessment-production.up.railway.app'
export const BELLHAVEN_ID = '0015QAPLGS3FVYEEEM'

/** Fresh copy of the 121 fixture accounts (untrusted CRM data). */
export function loadAccounts(): Account[] {
  return JSON.parse(readFileSync(new URL('../fixtures/accounts.json', import.meta.url), 'utf8'))
}

/** The 35 locations scraped from the site fixtures. */
export async function loadLocations(): Promise<Location[]> {
  return scrapeLocations(fixtureFetcher().fetchText, SITE_BASE)
}
