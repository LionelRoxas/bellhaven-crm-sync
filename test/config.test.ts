import { describe, expect, it } from 'vitest'
import { loadConfig } from '@/config'

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({ CRM_API_BASE: 'x', CRM_TOKEN: 't' })
    expect(c.siteBase).toBe('https://analyst-assessment-production.up.railway.app')
    expect(c.parentName).toBe('Bellhaven Senior Living (Parent Account)')
    expect(c.dbPath).toBe('data/sync.db')
  })
  it('throws naming a missing CRM_TOKEN', () => {
    expect(() => loadConfig({ CRM_API_BASE: 'x' })).toThrow(/CRM_TOKEN/)
  })
  it('never leaks the token value in errors', () => {
    expect(() => loadConfig({ CRM_TOKEN: 'secret123' })).toThrow(/CRM_API_BASE/)
    try {
      loadConfig({ CRM_TOKEN: 'secret123' })
    } catch (e) {
      expect((e as Error).message).not.toContain('secret123')
    }
  })
})
