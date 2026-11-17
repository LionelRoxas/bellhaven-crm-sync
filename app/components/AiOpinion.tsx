import type { AiOpinion as Opinion } from '@/types'
import { Src } from './Src'

const VERDICTS = {
  likely_same: 'Likely the same place',
  unlikely: 'Probably different',
  unsure: 'Not sure',
} as const

export function AiOpinion({ opinion }: { opinion: Opinion }) {
  return (
    <section className="panel" aria-labelledby="ai-h" data-testid="ai-opinion">
      <div className="panel-head">
        <h2 id="ai-h">AI second opinion (advisory)</h2>
        <p className="small muted">Advisory only. It never changes this suggestion or what gets written.</p>
      </div>
      <div className="panel-body">
        {opinion.status === 'ok' ? (
          <>
            <p>
              <strong>{VERDICTS[opinion.verdict]}</strong>
            </p>
            {opinion.matchLabel && (
              <p className="small">
                Compared with: <Src text={opinion.matchLabel} />
              </p>
            )}
            <p style={{ marginTop: 8 }}>
              <Src text={opinion.reason} />
            </p>
            <p className="small muted" style={{ marginTop: 8 }}>
              Model: <span className="mono">{opinion.model}</span>
            </p>
          </>
        ) : (
          <p className="small">
            <Src text={opinion.why} />
          </p>
        )}
      </div>
    </section>
  )
}
