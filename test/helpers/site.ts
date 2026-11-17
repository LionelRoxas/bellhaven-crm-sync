import { readFileSync } from 'node:fs'

const dir = new URL('../fixtures/site/', import.meta.url)
const fileFor = (path: string) => path.replace(/^\//, '').replace(/[/?]/g, '_') || 'index'

/** Fixture-backed fetchText that records requested paths. */
export function fixtureFetcher(extra: Record<string, string> = {}) {
  const requested: string[] = []
  const fetchText = async (path: string): Promise<string> => {
    requested.push(path)
    if (path in extra) return extra[path]
    return readFileSync(new URL(`${fileFor(path)}.html`, dir), 'utf8')
  }
  return { fetchText, requested }
}
