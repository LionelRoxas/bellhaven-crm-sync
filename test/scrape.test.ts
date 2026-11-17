import { describe, expect, test } from 'vitest'
import { scrapeLocations } from '@/sync/scrape'
import { fixtureFetcher, readFixture } from './helpers/site'

const BASE = 'https://analyst-assessment-production.up.railway.app'

describe('scrapeLocations', () => {
  test('returns 35 unique locations and stops at the pager total', async () => {
    const { fetchText, requested } = fixtureFetcher()
    const locs = await scrapeLocations(fetchText, BASE)
    expect(locs).toHaveLength(35)
    expect(new Set(locs.map((l) => l.slug)).size).toBe(35)
    expect(locs.map((l) => l.slug)).toContain('bellhaven-meadows-of-findlay')
    expect(requested.some((p) => /page=([4-9]|\d\d)/.test(p))).toBe(false)
  })

  test('parses Tiffin and Erie', async () => {
    const { fetchText } = fixtureFetcher()
    const locs = await scrapeLocations(fetchText, BASE)
    expect(locs.find((l) => l.slug === 'bellhaven-of-tiffin')).toMatchObject({
      name: 'Bellhaven of Tiffin',
      street: '45 St Lawrence Dr',
      city: 'Tiffin',
      state: 'OH',
      zip: '44883',
      offerings: ['Short-Term Rehabilitation & Nursing'],
    })
    expect(locs.find((l) => l.slug === 'bellhaven-shores-of-erie')?.offerings).toEqual([
      'Assisted Living',
      'Memory Support',
    ])
  })

  test('rejects cross-origin detail links', async () => {
    const page1 = '<div class="pager"><span>Page 1 / 1</span></div><a href="https://evil.test/communities/x">x</a>'
    const { fetchText, requested } = fixtureFetcher({ '/communities?page=1': page1 })
    const locs = await scrapeLocations(fetchText, BASE)
    expect(locs.map((l) => l.slug)).not.toContain('x')
    expect(requested).not.toContain('/communities/x')
  })

  test('schema failure names the slug', async () => {
    const html = readFixture('communities_bellhaven-of-tiffin').replace('44883', '4588')
    const { fetchText } = fixtureFetcher({ '/communities/bellhaven-of-tiffin': html })
    await expect(scrapeLocations(fetchText, BASE)).rejects.toThrow(/bellhaven-of-tiffin.*zip/)
  })

  test('skips unsafe slugs without fetching or throwing', async () => {
    const page1 =
      '<div class="pager"><span>Page 1 / 1</span></div><a href="/communities/..%2Fadmin">a</a><a href="/communities/%zz">b</a>'
    const { fetchText, requested } = fixtureFetcher({ '/communities?page=1': page1 })
    await expect(scrapeLocations(fetchText, BASE)).resolves.toHaveLength(1)
    expect(requested.some((p) => /admin|%zz/i.test(p))).toBe(false)
  })

  test('fails closed when the pager total is absurd', async () => {
    const page1 = '<div class="pager"><span>Page 1 / 21</span></div>'
    const { fetchText } = fixtureFetcher({ '/communities?page=1': page1 })
    await expect(scrapeLocations(fetchText, BASE)).rejects.toThrow('Pager total 21 exceeds limit 20')
  })
})
