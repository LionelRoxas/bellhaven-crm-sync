import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
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

const AI_ALIAS = /^@\/ai($|\/)/
function aiImports(src: string, file: string): string[] {
  return specifiers(src).filter((s) => {
    if (AI_ALIAS.test(s)) return true
    if (!s.startsWith('.')) return false
    const target = resolve(dirname(file), s).replaceAll(sep, '/')
    return target.includes('/src/ai/') || target.endsWith('/src/ai')
  })
}

test('ai import detector catches alias and relative forms', () => {
  const f = join(root, 'app', 'components', 'x.ts')
  expect(aiImports("import { a } from '@/ai/second-opinion'", f)).toHaveLength(1)
  expect(aiImports("import { a } from '@/ai'", f)).toHaveLength(1)
  expect(aiImports("import { a } from '../../src/ai/groq'", f)).toHaveLength(1)
  expect(aiImports("import { a } from '@/store/db'", f)).toEqual([])
})

test('review app and apply code never import src/ai', () => {
  const files = [...tsFiles(join(root, 'app')), ...tsFiles(join(root, 'src', 'apply'))]
  expect(files.length).toBeGreaterThan(5)
  for (const f of files) expect(aiImports(readFileSync(f, 'utf8'), f), f).toEqual([])
})
