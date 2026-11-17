import Link from 'next/link'
import type { ProposalRow } from '@/store/db'
import { TYPE_LABELS, confidenceLabel } from './format'
import { StatusBadge } from './StatusBadge'

function place(p: ProposalRow): string {
  const l = p.evidence.location
  if (l) return `${l.city}, ${l.state}`
  const a = p.evidence.accounts.find((x) => p.accountIds.includes(x.account_id)) ?? p.evidence.accounts[0]
  return a ? [a.billing_city, a.billing_state].filter(Boolean).join(', ') : ''
}

export function QueueTable({ rows, interrupted }: { rows: ProposalRow[]; interrupted: Set<string> }) {
  return (
    <div className="panel scroll-x">
      <table className="grid queue" aria-label="Proposals">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Facility</th>
            <th scope="col">City, state</th>
            <th scope="col">Proposed change</th>
            <th scope="col">Confidence</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="type">
                <span className="badge">{TYPE_LABELS[p.type]}</span>
              </td>
              <td className="facility">
                <Link href={`/proposals/${p.id}`}>{p.title}</Link>
              </td>
              <td>{place(p)}</td>
              <td>{p.summary}</td>
              <td className="num">{confidenceLabel(p.confidence)}</td>
              <td>
                <StatusBadge status={p.status} interrupted={interrupted.has(p.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
