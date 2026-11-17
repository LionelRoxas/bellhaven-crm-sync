import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  )
}

const FORBIDDEN = [/(^|\/)crm\/write($|\.)/, /(^|\/)apply($|\/|\.)/]

/** Every module specifier in the source: import/export-from, import(), require(), side-effect imports. */
function specifiers(src: string): string[] {
  return ts.preProcessFile(src, true, true).importedFiles.map((f) => f.fileName)
}
function forbidden(src: string): string[] {
  return specifiers(src).filter((s) => FORBIDDEN.some((re) => re.test(s)))
}

test('detector catches multi-line, barrel, relative, dynamic and require forms', () => {
  expect(forbidden("import {\n  createAccount,\n} from '@/crm/write'")).toEqual(['@/crm/write'])
  expect(forbidden("import { x } from '@/apply'")).toEqual(['@/apply'])
  expect(forbidden("import { x } from '@/apply/apply'")).toEqual(['@/apply/apply'])
  expect(forbidden("import { x } from '../crm/write'")).toEqual(['../crm/write'])
  expect(forbidden("import '@/crm/write'")).toEqual(['@/crm/write'])
  expect(forbidden("const m = await import('@/apply/apply')")).toEqual(['@/apply/apply'])
  expect(forbidden("const m = require('../crm/write')")).toEqual(['../crm/write'])
  expect(forbidden("export { y } from '@/apply'")).toEqual(['@/apply'])
  expect(forbidden("import { a } from '@/crm/contracts'\nimport { b } from '@/crm/read'")).toEqual([])
})

test('pipeline code never imports the write client or apply code', () => {
  const files = [...tsFiles(join(root, 'src', 'sync')), ...tsFiles(join(root, 'scripts'))]
  expect(files.length).toBeGreaterThan(5)
  for (const f of files) expect(forbidden(readFileSync(f, 'utf8')), f).toEqual([])
})
