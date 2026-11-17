import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@/store/db'

describe('ai opinion cache', () => {
  it('roundtrips and returns null for unknown keys', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'aiop-')), 't.db'))
    expect(db.getAiOpinion('nope')).toBeNull()
    const o = { status: 'ok' as const, verdict: 'unsure' as const, matchId: null, matchLabel: null, reason: 'r', model: 'm' }
    db.putAiOpinion('k', o)
    expect(db.getAiOpinion('k')).toEqual(o)
    db.close()
  })
})
