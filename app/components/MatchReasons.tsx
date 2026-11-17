import type { Evidence } from '@/types'
import { Src } from './Src'

export function MatchReasons({ evidence }: { evidence: Evidence }) {
  const name = (id: string) => evidence.accounts.find((a) => a.account_id === id)?.name
  return (
    <>
      {evidence.candidates.length > 0 && (
        <section className="panel" aria-labelledby="match-h">
          <div className="panel-head">
            <h2 id="match-h">Why these accounts</h2>
          </div>
          <div className="panel-body">
            <ul className="plain-list">
            {evidence.candidates.map((c) => (
              <li key={c.accountId}>
                <Src text={name(c.accountId)} /> <span className="mono muted">{c.accountId}</span>
                <div className="small">
                  {c.strength === 'strong' ? 'Strong match' : 'Weak match'}: {c.reasons.join('; ')}
                </div>
              </li>
            ))}
            </ul>
          </div>
        </section>
      )}
      {evidence.notLinked.length > 0 && (
        <section className="panel" aria-labelledby="notlinked-h">
          <div className="panel-head">
            <h2 id="notlinked-h">Not linked</h2>
            <p className="small muted">Nearby accounts that this proposal leaves alone.</p>
          </div>
          <div className="panel-body">
            <ul className="plain-list">
            {evidence.notLinked.map((n) => (
              <li key={n.accountId}>
                <Src text={name(n.accountId)} /> <span className="mono muted">{n.accountId}</span>
                <div className="small">{n.why}</div>
              </li>
            ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}
