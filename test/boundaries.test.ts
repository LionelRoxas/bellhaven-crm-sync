import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  )
}

test('pipeline code never imports the write client or apply code', () => {
  const files = [...tsFiles(join(root, 'src', 'sync')), ...tsFiles(join(root, 'scripts'))]
  expect(files.length).toBeGreaterThan(5)
  const importLine = /^\s*(import|export)\b[^\n]*['"][^'"]*(crm\/write|apply\/)[^'"]*['"]/m
  const dynamic = /import\(\s*['"][^'"]*(crm\/write|apply\/)/
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    expect(importLine.test(src) || dynamic.test(src), f).toBe(false)
  }
})
