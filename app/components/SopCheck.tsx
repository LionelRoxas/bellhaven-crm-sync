import type { ProposalType } from '@/types'
import { money } from './format'

/** The SOP branch this proposal takes, in words. `createsAccount`: the proposal has a create step. */
export function sopOutcome(type: ProposalType, revenue: number, ar: number, createsAccount: boolean): string {
  const both = revenue > 0 && ar > 0
  if (type === 'sold') {
    return both
      ? 'Revenue and AR are both above zero, so the old account is kept and linked to the new owner’s account (CHOW).'
      : 'Revenue or AR is zero, so the old account is marked a duplicate of the new owner’s account and set to Inactive.'
  }
  if (both) {
    return createsAccount
      ? 'Revenue and AR are both above zero. A new account will be created under Bellhaven; the old account keeps its history and links to it.'
      : 'Revenue and AR are both above zero. The Bellhaven account for this location already exists, so no account is created; the old account keeps its history and links to it.'
  }
  return 'Revenue or AR is zero, so the existing account moves to Bellhaven. No new account is needed.'
}

export function SopCheck({
  type,
  sop,
  createsAccount,
}: {
  type: ProposalType
  sop: { revenue: number; ar: number; rule: string }
  createsAccount: boolean
}) {
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
        <p style={{ marginTop: 8 }}>{sopOutcome(type, sop.revenue, sop.ar, createsAccount)}</p>
      </div>
    </section>
  )
}
