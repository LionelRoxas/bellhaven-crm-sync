import { beforeAll, describe, expect, test } from 'vitest'
import type { Account, Location, ProposalDraft } from '@/types'
import type { ProposalRow, StepRow } from '@/store/db'
import { classify } from '@/sync/classify'
import { buildChain } from '../app/components/OwnershipChain'
import { sopOutcome } from '../app/components/SopCheck'
import { BELLHAVEN_ID, loadAccounts, loadLocations } from './helpers/data'

const BH_NAME = 'Bellhaven Senior Living (Parent Account)'
const SANDUSKY = '001SXSF4ELF0Z2LGDM'
const TIFFIN = '001U6RW32TY0WSXZZB'

let locations: Location[]
beforeAll(async () => {
  locations = await loadLocations()
})

function row(d: ProposalDraft): { p: ProposalRow; steps: StepRow[] } {
  const p: ProposalRow = {
    ...d, id: 'p_abcdef', fingerprint: 'f', status: 'pending', firstRun: 1, lastRun: 1, decidedAt: null, comment: null,
  }
  const steps: StepRow[] = d.steps.map((s, idx) => ({
    ...s, proposalId: p.id, idx, status: 'pending', resultAccountId: null, response: null, error: null, attemptedAt: null,
  }))
  return { p, steps }
}
const labels = (chain: ReturnType<typeof buildChain>) =>
  chain.filter((x): x is { label: string } => 'label' in x).map((x) => x.label)

describe('SOP check text states the branch actually taken', () => {
  test('sold', () => {
    expect(sopOutcome('sold', 100, 50, false)).toMatch(/linked to the new owner’s account/)
    expect(sopOutcome('sold', 100, 0, false)).toMatch(/duplicate of the new owner’s account.*Inactive/)
    expect(sopOutcome('sold', 0, 50, false)).toMatch(/duplicate of the new owner’s account.*Inactive/)
  })

  test('chow creates an account, or links the one that already exists', () => {
    expect(sopOutcome('chow', 100, 50, true)).toMatch(/A new account will be created/)
    expect(sopOutcome('chow', 100, 50, false)).toMatch(/already exists/)
    expect(sopOutcome('chow', 100, 50, false)).not.toMatch(/will be created/)
  })

  test('reparent', () => {
    expect(sopOutcome('reparent', 100, 0, false)).toMatch(/moves to Bellhaven/)
  })
})

describe('ownership chain', () => {
  test('sold without CHOW is labelled Duplicate of', () => {
    const accs = loadAccounts().map((a) => (a.account_id === SANDUSKY ? { ...a, outstanding_ar: 0 } : a))
    const d = classify(locations, accs, BELLHAVEN_ID).find((x) => x.type === 'sold')!
    expect(d.steps[0].body).toHaveProperty('duplicate_of_account')
    const { p, steps } = row(d)
    expect(labels(buildChain(p, steps, BH_NAME, BELLHAVEN_ID))).toEqual(['Duplicate of'])
  })

  test('sold CHOW keeps the CHOW label', () => {
    const d = classify(locations, loadAccounts(), BELLHAVEN_ID).find((x) => x.type === 'sold')!
    const { p, steps } = row(d)
    expect(labels(buildChain(p, steps, BH_NAME, BELLHAVEN_ID))).toEqual(['CHOW current account'])
  })

  test('CHOW linking an existing Bellhaven account shows that account, not a new one', () => {
    const base = loadAccounts()
    const old = base.find((a) => a.account_id === TIFFIN)!
    const created: Account = {
      ...old, account_id: '001BHTIFFIN0000001', parent_id: BELLHAVEN_ID, parent_name: BH_NAME,
      lifetime_revenue: 0, outstanding_ar: 0,
    }
    const d = classify(locations, [...base, created], BELLHAVEN_ID).find((x) => x.locationSlug === 'bellhaven-of-tiffin')!
    const { p, steps } = row(d)
    const chain = buildChain(p, steps, BH_NAME, BELLHAVEN_ID)
    const nodes = chain.flatMap((x) => ('cells' in x ? x.cells.flat() : []))
    expect(nodes.find((n) => n.kicker === 'New account')).toBeUndefined()
    expect(nodes.find((n) => n.id === created.account_id)).toMatchObject({ kicker: 'Existing Bellhaven account' })
  })
})
