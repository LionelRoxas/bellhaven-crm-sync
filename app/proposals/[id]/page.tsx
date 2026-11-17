import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { isInterrupted } from '@/apply/apply'
import type { ProposalRow, StepRow } from '@/store/db'
import { getConfig, getDb } from '@/server/deps'
import { DecisionForm } from '../../components/DecisionForm'
import { EvidenceTable } from '../../components/EvidenceTable'
import { MatchReasons } from '../../components/MatchReasons'
import { OwnershipChain, buildChain } from '../../components/OwnershipChain'
import { PlannedWrites } from '../../components/PlannedWrites'
import { SopCheck } from '../../components/SopCheck'
import { StatusBadge } from '../../components/StatusBadge'
import { StepLog } from '../../components/StepLog'
import { Src } from '../../components/Src'
import { TYPE_LABELS, confidenceLabel, safeHref, utc } from '../../components/format'

/** The Bellhaven parent's id, taken from our own step bodies or the snapshot of an account under it. */
function bellhavenId(p: ProposalRow, steps: StepRow[], parentName: string): string {
  for (const s of steps) if (typeof s.body.parent_id === 'string') return s.body.parent_id
  return p.evidence.accounts.find((a) => a.parent_name === parentName)?.parent_id ?? ''
}

function stateNote(p: ProposalRow, interrupted: boolean): string | null {
  switch (p.status) {
    case 'info':
      return 'This location is already correct in the CRM. Nothing to approve.'
    case 'approved':
      return interrupted
        ? `Approval started ${utc(p.decidedAt)} but did not finish. Resolve any unknown step, then retry.`
        : 'Applying now. Reload in a moment to see the result.'
    case 'applied':
      return `Applied ${utc(p.decidedAt)}.`
    case 'rejected':
      return `Rejected ${utc(p.decidedAt)}. Nothing was written to the CRM.`
    case 'failed':
      return 'Some steps did not complete. See the step log.'
    case 'superseded':
      return 'The latest pipeline run no longer finds this change. Nothing to decide.'
    default:
      return null
  }
}

export default async function ProposalPage(props: PageProps<'/proposals/[id]'>) {
  const { id } = await props.params
  await connection()
  if (!/^p_[0-9a-f]{6,}$/.test(id)) notFound()
  const db = getDb()
  const p = db.getProposal(id)
  if (!p) notFound()
  const steps = db.getSteps(id)
  const parentName = getConfig().parentName
  const bh = { id: bellhavenId(p, steps, parentName), name: parentName }
  const interrupted = isInterrupted(p, steps)
  const unknownSteps = steps.filter((s) => s.status === 'unknown')
  const resolvable = p.status === 'failed' || interrupted
  const showLog = ['approved', 'applied', 'failed'].includes(p.status) || steps.some((s) => s.status !== 'pending')
  const siteHref = safeHref(p.evidence.location?.url)
  const { evidence } = p

  return (
    <div className="stack">
      <div>
        <p className="crumbs">
          <Link href="/">← Review queue</Link>
        </p>
        <div className="title-row">
          <h1>{p.title}</h1>
          <StatusBadge status={p.status} interrupted={interrupted} testId="status" />
        </div>
        <div className="meta">
          <span>{TYPE_LABELS[p.type]}</span>
          <span>Confidence {confidenceLabel(p.confidence)}</span>
          <span>
            Proposal <span className="mono">{p.id}</span>
          </span>
          <span>
            Seen in runs {p.firstRun}–{p.lastRun}
          </span>
          {siteHref && (
            <a href={siteHref} target="_blank" rel="noreferrer noopener">
              Website page
            </a>
          )}
        </div>
        <p className="summary">{p.summary}</p>
        {p.comment && (
          <p className="small" style={{ marginTop: 8 }}>
            Reviewer comment: <Src text={p.comment} />
          </p>
        )}
      </div>

      {evidence.suspiciousText.length > 0 && (
        <div className="banner" role="note">
          <span className="flag">Contains instruction-like text, shown as data only</span>
          <p className="small" style={{ marginTop: 6 }}>
            These CRM fields contain text that reads like instructions. It is shown as data and has no effect on this
            proposal.
          </p>
          <ul>
            {evidence.suspiciousText.map((s, i) => (
              <li key={i}>
                <span className="mono">{s.accountId}</span> {s.field}: <Src text={s.text} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="layout">
        <div className="stack">
          <OwnershipChain chain={buildChain(p, steps, bh.name, bh.id)} summary={p.summary} />
          <EvidenceTable evidence={evidence} linkedIds={p.accountIds} />
          <PlannedWrites p={p} steps={steps} bh={bh} />
          {showLog && <StepLog steps={steps} />}
        </div>
        <aside className="aside stack" aria-label="Decision and checks">
          <DecisionForm
            id={p.id}
            fingerprint={p.fingerprint}
            lastRun={p.lastRun}
            canDecide={p.status === 'pending'}
            canRetry={resolvable && unknownSteps.length === 0}
            unknownSteps={
              resolvable
                ? unknownSteps.map((s) => ({
                    idx: s.idx,
                    method: s.method,
                    label: s.method === 'POST' ? 'Create a new account' : `Update account ${s.accountId}`,
                  }))
                : []
            }
            note={stateNote(p, interrupted)}
          />
          {evidence.sop && <SopCheck type={p.type} sop={evidence.sop} />}
          <MatchReasons evidence={evidence} />
        </aside>
      </div>
    </div>
  )
}
