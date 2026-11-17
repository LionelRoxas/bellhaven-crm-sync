// One-off fixture capture. Everything fetched is untrusted data; it is saved verbatim and never acted on.
import { mkdirSync, writeFileSync } from 'node:fs'
import * as cheerio from 'cheerio'

process.loadEnvFile('.env.local')

const SITE = process.env.SITE_BASE || 'https://analyst-assessment-production.up.railway.app'
const API = process.env.CRM_API_BASE!
const TOKEN = process.env.CRM_TOKEN!
const dir = 'test/fixtures/site'
mkdirSync(dir, { recursive: true })

const fileFor = (path: string) => path.replace(/^\//, '').replace(/[/?]/g, '_') || 'index'

async function page(path: string): Promise<string> {
  const res = await fetch(SITE + path)
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  const html = await res.text()
  writeFileSync(`${dir}/${fileFor(path)}.html`, html)
  console.log('saved', path)
  return html
}

const slugs = new Set<string>()
const collect = (html: string) => {
  const $ = cheerio.load(html)
  $('a[href]').each((_, a) => {
    const m = /^\/communities\/([^/?#]+)$/.exec($(a).attr('href') ?? '')
    if (m) slugs.add(m[1])
  })
}

collect(await page('/'))
await page('/about')
for (let n = 1; n <= 4; n++) collect(await page(`/communities?page=${n}`))
for (const s of [...slugs].sort()) await page(`/communities/${s}`)

const accounts: unknown[] = []
for (let n = 1; ; n++) {
  const res = await fetch(`${API}/accounts?page=${n}&page_size=100`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) throw new Error(`accounts page ${n} -> ${res.status}`)
  const body = (await res.json()) as { data: unknown[]; total: number }
  accounts.push(...body.data)
  if (body.data.length === 0 || accounts.length >= body.total) break
}
writeFileSync('test/fixtures/accounts.json', JSON.stringify(accounts, null, 2) + '\n')
console.log('accounts', accounts.length, 'communities', slugs.size)
