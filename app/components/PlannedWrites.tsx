import type { ProposalRow, StepRow } from '@/store/db'
import { FIELD_LABELS } from './format'
import { Src } from './Src'

const isCreatedRef = (v: unknown) =>
  !!v && typeof v === 'object' && (v as Record<string, unknown>).$ref === 'created'

function Value({ field, v, p, steps, bh }: { field: string; v: unknown; p: ProposalRow; steps: StepRow[]; bh: { id: string; name: string } }) {
  if (isCreatedRef(v)) {
    const post = steps.find((s) => s.method === 'POST')
    return <span>the account created in step {post ? post.idx + 1 : '?'}</span>
  }
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (field === 'parent_id' && s === bh.id) {
    return (
      <span>
        {bh.name} <span className="mono muted">{s}</span>
      </span>
    )
  }
  if (/^[0-9A-Z]{18}$/.test(s)) {
    const known = p.evidence.accounts.find((a) => a.account_id === s)
    return (
      <span>
        <span className="mono">{s}</span> {known && <Src text={known.name} />}
      </span>
    )
  }
  return <Src text={s} />
}

export function PlannedWrites({ p, steps, bh }: { p: ProposalRow; steps: StepRow[]; bh: { id: string; name: string } }) {
  const nameOf = (id: string | null) => p.evidence.accounts.find((a) => a.account_id === id)?.name
  return (
    <section className="panel" aria-labelledby="writes-h">
      <div className="panel-head">
        <h2 id="writes-h">Planned writes</h2>
        <p className="small muted">
          {steps.length === 0
            ? 'Nothing to write.'
            : `${steps.length} ${steps.length === 1 ? 'call' : 'calls'}, run in order after approval.`}
        </p>
      </div>
      {steps.length > 0 && (
        <ol className="steps-list">
          {steps.map((s) => (
            <li key={s.idx}>
              <div className="step-title">
                <span className="n">{s.idx + 1}.</span>
                {s.method === 'POST' ? (
                  'Create a new account'
                ) : (
                  <>
                    Update account <span className="mono">{s.accountId}</span> <Src text={nameOf(s.accountId)} />
                  </>
                )}
              </div>
              <dl className="kv" style={{ marginTop: 8 }}>
                {Object.entries(s.body).map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{FIELD_LABELS[k] ?? k}</dt>
                    <dd>
                      <Value field={k} v={v} p={p} steps={steps} bh={bh} />
                    </dd>
                  </div>
                ))}
                {s.noteReason && (
                  <>
                    <dt>Note</dt>
                    <dd>
                      {s.method === 'PATCH' ? 'Append a line: ' : 'Set to: '}
                      <span className="mono">
                        [bellhaven-sync {'<date>'} {p.id}]
                      </span>{' '}
                      {s.noteReason}
                    </dd>
                  </>
                )}
              </dl>
              <details>
                <summary>Request body</summary>
                <pre>
                  {`${s.method} /accounts${s.accountId ? `/${s.accountId}` : ''}\n${JSON.stringify(s.body, null, 2)}`}
                </pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
