import * as cheerio from 'cheerio'
import { z } from 'zod'
import type { Location } from '@/types'
import { cleanText } from './normalize'

const SLUG_RE = /^[a-z0-9-]+$/
const MAX_PAGES = 20

export const LocationSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  name: z.string().min(1).max(120),
  street: z.string().min(1).max(120),
  city: z.string().min(1).max(60),
  state: z.string().regex(/^[A-Z]{2}$/),
  zip: z.string().regex(/^\d{5}$/),
  offerings: z.array(z.string().min(1).max(60)).min(1).max(5),
  url: z.string().url(),
})

const CONCURRENCY = 4

function slugsFrom(html: string, base: URL, into: Set<string>) {
  const $ = cheerio.load(html)
  $('a[href]').each((_, a) => {
    let u: URL
    try {
      u = new URL($(a).attr('href') ?? '', base)
    } catch {
      return
    }
    if (u.origin !== base.origin) return
    const m = /^\/communities\/([^/?#]+)\/?$/.exec(u.pathname)
    if (!m) return
    let slug: string
    try {
      slug = decodeURIComponent(m[1])
    } catch {
      return
    }
    if (SLUG_RE.test(slug)) into.add(slug)
  })
}

function parseDetail(html: string, slug: string, base: URL): unknown {
  const $ = cheerio.load(html)
  const fields = new Map<string, ReturnType<typeof $>>()
  $('dl.detail dt').each((_, dt) => {
    fields.set(cleanText($(dt).text()).toLowerCase(), $(dt).next('dd'))
  })
  const addr = fields.get('address')
  const lines = (addr?.html() ?? '').split(/<br\s*\/?>/i).map((l) => cleanText(l))
  const m = /^(.*?),\s*([A-Za-z]{2})\s+(\S+)$/.exec(lines[1] ?? '')
  const offerings = (fields.get('care offerings')?.find('.badge').toArray() ?? []).map((b) =>
    cleanText($(b).text()),
  )
  return {
    slug,
    name: cleanText($('h1').first().text()),
    street: lines[0] ?? '',
    city: m?.[1] ?? '',
    state: m?.[2] ?? '',
    zip: m?.[3] ?? '',
    offerings,
    url: new URL(`/communities/${slug}`, base).toString(),
  }
}

export async function scrapeLocations(
  fetchText: (path: string) => Promise<string>,
  siteBase: string,
): Promise<Location[]> {
  const base = new URL(siteBase)
  const slugs = new Set<string>()

  const first = await fetchText('/communities?page=1')
  const pager = cheerio.load(first)('.pager').text()
  const total = /Page\s+\d+\s*\/\s*(\d+)/.exec(pager)
  if (!total) throw new Error('Could not read "Page N / M" from the communities list')
  const lastPage = Number(total[1])
  if (lastPage > MAX_PAGES) throw new Error(`Pager total ${lastPage} exceeds limit ${MAX_PAGES}`)
  slugsFrom(first, base, slugs)
  for (let n = 2; n <= lastPage; n++) slugsFrom(await fetchText(`/communities?page=${n}`), base, slugs)
  slugsFrom(await fetchText('/'), base, slugs)

  const list = [...slugs]
  const out: Location[] = new Array(list.length)
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const i = next++
      const slug = list[i]
      const raw = parseDetail(await fetchText(`/communities/${slug}`), slug, base)
      const parsed = LocationSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(`Invalid location "${slug}": ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`)
      }
      out[i] = parsed.data
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return out
}
