'use client'

import { useActionState, useState } from 'react'
import type { Result } from '@/apply/apply'
import { approveAction, rejectAction, resolveStepAction, retryAction } from '../actions'

type Intent = 'approve' | 'reject' | 'retry' | 'resolve'
type UnknownStep = {
  idx: number
  method: 'POST' | 'PATCH'
  label: string
  /** For a create step: what was sent, so the reviewer can find the account in the CRM. */
  sent?: { name: string; street: string; place: string; parent: string }
}

export type DecisionProps = {
  id: string
  fingerprint: string
  lastRun: number
  canDecide: boolean
  canRetry: boolean
  unknownSteps: UnknownStep[]
  note: string | null
}

const ACTIONS = { approve: approveAction, reject: rejectAction, retry: retryAction, resolve: resolveStepAction }

/**
 * All reviewer controls in one client component that stays mounted across re-renders, so the
 * result message survives the page refresh that follows each action.
 */
export function DecisionForm(props: DecisionProps) {
  const [intent, setIntent] = useState<Intent | null>(null)
  const [state, dispatch, pending] = useActionState(async (prev: Result | null, fd: FormData) => {
    const which = fd.get('intent') as Intent
    const action = ACTIONS[which]
    return action ? action(prev, fd) : { ok: false, message: 'Invalid request' }
  }, null)

  const submitAs = (which: Intent) => (fd: FormData) => {
    fd.set('intent', which)
    setIntent(which)
    dispatch(fd)
  }

  const label = (which: Intent, idle: string, busy: string) => (pending && intent === which ? busy : idle)

  return (
    <section className="panel decision" aria-labelledby="decision-h">
      <div className="panel-head">
        <h2 id="decision-h">Decision</h2>
      </div>
      <div className="panel-body">
        {props.canDecide && (
          <form>
            <input type="hidden" name="id" value={props.id} />
            <input type="hidden" name="fingerprint" value={props.fingerprint} />
            <input type="hidden" name="lastRun" value={props.lastRun} />
            <label htmlFor="comment">Comment</label>
            <textarea id="comment" name="comment" maxLength={500} placeholder="Optional, kept with the decision" />
            <div className="buttons">
              <button className="btn approve" formAction={submitAs('approve')} disabled={pending}>
                {label('approve', 'Approve', 'Applying…')}
              </button>
              <button className="btn reject" formAction={submitAs('reject')} disabled={pending}>
                {label('reject', 'Reject', 'Rejecting…')}
              </button>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              Approve runs the planned writes against the CRM now. Reject writes nothing.
            </p>
          </form>
        )}

        {props.unknownSteps.map((s) => (
          <div key={s.idx} className="unknown-step">
            <h3>Step {s.idx + 1}: unknown outcome</h3>
            <p className="small" style={{ marginTop: 4 }}>
              {s.label}. Check the CRM, then record what happened.
            </p>
            {s.sent && (
              <dl className="kv" style={{ marginTop: 8 }} data-testid={`sent-${s.idx}`}>
                <dt>Name</dt>
                <dd>
                  <span className="src">{s.sent.name}</span>
                </dd>
                <dt>Street</dt>
                <dd>
                  <span className="src">{s.sent.street}</span>
                </dd>
                <dt>City</dt>
                <dd>
                  <span className="src">{s.sent.place}</span>
                </dd>
                <dt>Parent</dt>
                <dd>
                  <span className="src">{s.sent.parent}</span>
                </dd>
              </dl>
            )}
            <form action={submitAs('resolve')} style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={props.id} />
              <input type="hidden" name="idx" value={s.idx} />
              <input type="hidden" name="outcome" value="done" />
              {s.method === 'POST' && (
                <>
                  <label htmlFor={`acct-${s.idx}`}>Created account id</label>
                  <input
                    id={`acct-${s.idx}`}
                    type="text"
                    name="accountId"
                    required
                    pattern="[0-9A-Z]{18}"
                    autoComplete="off"
                    spellCheck={false}
                    className="mono"
                  />
                </>
              )}
              <div className="buttons">
                <button className="btn" type="submit" disabled={pending}>
                  It landed
                </button>
              </div>
            </form>
            <form action={submitAs('resolve')}>
              <input type="hidden" name="id" value={props.id} />
              <input type="hidden" name="idx" value={s.idx} />
              <input type="hidden" name="outcome" value="failed" />
              <div className="buttons" style={{ marginTop: 8 }}>
                <button className="btn" type="submit" disabled={pending}>
                  It didn’t land
                </button>
              </div>
            </form>
            <hr className="divider" />
          </div>
        ))}

        {props.canRetry && (
          <form action={submitAs('retry')}>
            <input type="hidden" name="id" value={props.id} />
            <p className="small">Retry runs the steps that are not done yet. Done steps are never sent again.</p>
            <div className="buttons">
              <button className="btn" type="submit" disabled={pending}>
                {label('retry', 'Retry', 'Retrying…')}
              </button>
            </div>
          </form>
        )}

        {props.note && <p className="small muted">{props.note}</p>}

        <div role="status" aria-live="polite">
          {state && <p className={`result ${state.ok ? 'ok' : 'err'}`}>{state.message}</p>}
        </div>
      </div>
    </section>
  )
}
