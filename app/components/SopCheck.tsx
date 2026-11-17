import type { ProposalType } from '@/types'
import { money } from './format'

function outcome(type: ProposalType, revenue: number, ar: number): string {
  const both = revenue > 0 && ar > 0
  if (type === 'sold') {
    return 'Revenue and AR are both above zero, so the old account is kept and linked to the new owner’s account.'
  }
  if (both) {
    return 'Revenue and AR are both above zero. A new account will be created under Bellhaven; the old account keeps its history and links to it.'
  }
  return 'Revenue or AR is zero, so the existing account moves to Bellhaven. No new account is needed.'
}

export function SopCheck({ type, sop }: { type: ProposalType; sop: { revenue: number; ar: number; rule: string } }) {
  return (
    <section className="panel" aria-labelledby="sop-h" data-testid="sop">
      <div className="panel-head">
        <h2 id="sop-h">SOP check</h2>
      </div>
      <div className="panel-body">
        <dl className="kv">
          <dt>Lifetime revenue</dt>
          <dd className="num">{money(sop.revenue)}</dd>
          <dt>Outstanding AR</dt>
          <dd className="num">{money(sop.ar)}</dd>
          <dt>Rule</dt>
          <dd>{sop.rule}</dd>
        </dl>
        <p style={{ marginTop: 8 }}>{outcome(type, sop.revenue, sop.ar)}</p>
      </div>
    </section>
  )
}
