import type { StepRow, StepStatus } from '@/store/db'
import { utc } from './format'
import { Src } from './Src'

const LABEL: Record<StepStatus, string> = {
  pending: 'Not run',
  done: 'Done',
  failed: 'Failed',
  unknown: 'Unknown outcome',
}

const HINT: Partial<Record<StepStatus, string>> = {
  failed: 'Fix the cause, then retry. If the CRM changed, run the pipeline again.',
  unknown: 'Check the account in the CRM, then mark this step below.',
}

export function StepLog({ steps }: { steps: StepRow[] }) {
  return (
    <section className="panel" aria-labelledby="log-h">
      <div className="panel-head">
        <h2 id="log-h">Step log</h2>
      </div>
      <div className="scroll-x">
        <table className="grid" aria-label="Step log">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Call</th>
              <th scope="col">Status</th>
              <th scope="col">Result</th>
              <th scope="col">Attempted</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.idx}>
                <td className="num">{s.idx + 1}</td>
                <td>
                  <span className="mono">
                    {s.method} /accounts{s.accountId ? `/${s.accountId}` : ''}
                  </span>
                </td>
                <td>
                  <span className={`status ${s.status === 'done' ? 'applied' : s.status === 'pending' ? 'info' : 'failed'}`}>
                    {LABEL[s.status]}
                  </span>
                </td>
                <td>
                  {s.resultAccountId && (
                    <div>
                      Created <span className="mono">{s.resultAccountId}</span>
                    </div>
                  )}
                  {s.error && (
                    <div>
                      <Src text={s.error} />
                    </div>
                  )}
                  {HINT[s.status] && <div className="small muted">{HINT[s.status]}</div>}
                </td>
                <td className="small num">{utc(s.attemptedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
