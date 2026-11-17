import type { ProposalRow, StepRow } from '@/store/db'
import type { Account } from '@/types'

type Tone = 'plain' | 'bh' | 'new' | 'muted'
type ChainNode = { kicker: string; name: string; id?: string; extra?: string; tone: Tone }
type Edge = { label: string; style: 'solid' | 'dashed' | 'removed'; arrow: boolean }
/** One row of the chain: three node columns (from, facility, parent) joined by two edges. */
type Row = { cells: [ChainNode[], ChainNode[], ChainNode[]]; edges: [Edge | null, Edge | null] }
/** A vertical connector under the facility column, linking two rows. */
type Link = { label: string }
type Chain = (Row | Link)[]

const isRow = (x: Row | Link): x is Row => 'cells' in x

const solid = (label: string, arrow = false): Edge => ({ label, style: 'solid', arrow })

function accountNode(a: Account, kicker: string, tone: Tone = 'plain', extra?: string): ChainNode {
  return { kicker, name: a.name, id: a.account_id, tone, extra }
}

function parentNode(a: Account | undefined, bhName: string, bhId: string): ChainNode {
  if (!a || !a.parent_id) return { kicker: 'Parent', name: 'No parent', tone: 'muted' }
  if (a.parent_id === bhId) return { kicker: 'Parent', name: bhName, id: bhId, tone: 'bh' }
  return { kicker: 'Parent', name: a.parent_name || a.parent_id, id: a.parent_id, tone: 'plain' }
}

/** Builds the ownership picture from the stored evidence and steps (never from free text). */
export function buildChain(p: ProposalRow, steps: StepRow[], bhName: string, bhId: string): Chain {
  const involved = p.evidence.accounts.filter((a) => p.accountIds.includes(a.account_id))
  const first = involved[0]
  const loc = p.evidence.location
  const bh: ChainNode = { kicker: 'Parent', name: bhName, id: bhId, tone: 'bh' }
  const newNode: ChainNode = { kicker: 'New account', name: loc?.name ?? p.title, tone: 'new' }
  const empty: ChainNode[] = []
  const movesTo = (s: StepRow | undefined) => s?.body.parent_id === bhId

  switch (p.type) {
    case 'chow':
      return [
        {
          cells: [[parentNode(first, bhName, bhId)], first ? [accountNode(first, 'Existing account, keeps its history')] : empty, empty],
          edges: [solid('stays under'), null],
        },
        { label: 'CHOW current account' },
        { cells: [empty, [newNode], [bh]], edges: [null, solid('parent', true)] },
      ]
    case 'create':
      return [{ cells: [empty, [newNode], [bh]], edges: [null, solid('parent', true)] }]
    case 'reparent':
      return [
        {
          cells: [[parentNode(first, bhName, bhId)], first ? [accountNode(first, 'Facility')] : empty, [bh]],
          edges: [{ label: 'was under', style: 'removed', arrow: false }, solid('moves to', true)],
        },
      ]
    case 'duplicate': {
      const survivorId = steps.map((s) => s.body.duplicate_of_account).find((v): v is string => typeof v === 'string')
      const survivor = involved.find((a) => a.account_id === survivorId)
      const losers = involved.filter((a) => a.account_id !== survivorId)
      const moving = movesTo(steps.find((s) => s.accountId === survivorId))
      return [
        {
          cells: [
            losers.map((a) => accountNode(a, 'Duplicate, becomes Inactive', 'muted')),
            survivor ? [accountNode(survivor, 'Kept account')] : empty,
            [moving || !survivor ? bh : parentNode(survivor, bhName, bhId)],
          ],
          edges: [{ label: 'duplicate of', style: 'dashed', arrow: true }, moving ? solid('moves to', true) : solid('under')],
        },
      ]
    }
    case 'stale':
      return [
        {
          cells: [empty, first ? [accountNode(first, 'Not on the website', 'plain', 'Status becomes Needs Review')] : empty, [parentNode(first, bhName, bhId)]],
          edges: [null, solid('under')],
        },
      ]
    case 'sold': {
      const ours = involved.find((a) => steps.some((s) => s.accountId === a.account_id))
      const owner = involved.find((a) => a !== ours)
      return [
        {
          cells: [empty, ours ? [accountNode(ours, 'Sold facility')] : empty, [parentNode(ours, bhName, bhId)]],
          edges: [null, solid('under')],
        },
        { label: 'CHOW current account' },
        {
          cells: [empty, owner ? [accountNode(owner, "New owner's account")] : empty, [parentNode(owner, bhName, bhId)]],
          edges: [null, solid('under')],
        },
      ]
    }
    default:
      // confirmed, update_fields: ownership is already right.
      return [
        {
          cells: [empty, first ? [accountNode(first, 'Facility')] : empty, [parentNode(first, bhName, bhId)]],
          edges: [null, solid('under')],
        },
      ]
  }
}

function NodeBox({ n }: { n: ChainNode }) {
  return (
    <div className={`node ${n.tone}`}>
      <div className="kicker">{n.kicker}</div>
      <div className="name">
        <span className="src">{n.name}</span>
      </div>
      {n.id && <div className="mono muted">{n.id}</div>}
      {n.extra && <div className="extra">{n.extra}</div>}
    </div>
  )
}

function EdgeBox({ e }: { e: Edge | null }) {
  if (!e) return <div className="blank" aria-hidden="true" />
  return (
    <div className={`edge ${e.style}${e.arrow ? ' arrow' : ''}`}>
      <span className="line" aria-hidden="true" />
      <span className="lbl">{e.label}</span>
    </div>
  )
}

export function OwnershipChain({ chain, summary }: { chain: Chain; summary: string }) {
  return (
    <section className="panel" aria-labelledby="chain-h">
      <div className="panel-head">
        <h2 id="chain-h">Ownership</h2>
        <p className="small muted">{summary}</p>
      </div>
      <div className="panel-body">
        <div className="chain">
          {chain.map((item, i) =>
            isRow(item) ? (
              [0, 1, 2].flatMap((c) => {
                const cell = item.cells[c]
                const out = [
                  cell.length ? (
                    <div className="cell" key={`${i}-c${c}`}>
                      {cell.map((n, k) => (
                        <NodeBox n={n} key={k} />
                      ))}
                    </div>
                  ) : (
                    <div className="blank" key={`${i}-c${c}`} aria-hidden="true" />
                  ),
                ]
                if (c < 2) out.push(<EdgeBox e={item.edges[c]} key={`${i}-e${c}`} />)
                return out
              })
            ) : (
              [
                <div className="blank" key={`${i}-l0`} aria-hidden="true" />,
                <div className="blank" key={`${i}-l1`} aria-hidden="true" />,
                <div className="vedge arrow" key={`${i}-l2`}>
                  <span className="vline" aria-hidden="true" />
                  <span className="lbl">{item.label}</span>
                </div>,
                <div className="blank" key={`${i}-l3`} aria-hidden="true" />,
                <div className="blank" key={`${i}-l4`} aria-hidden="true" />,
              ]
            ),
          )}
        </div>
      </div>
    </section>
  )
}
