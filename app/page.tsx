import Link from 'next/link'
import { connection } from 'next/server'
import { isInterrupted } from '@/apply/apply'
import type { ProposalRow, Status } from '@/store/db'
import type { ProposalType } from '@/types'
import { getDb } from '@/server/deps'
import { CountsStrip, type Counts } from './components/CountsStrip'
import { QueueTable } from './components/QueueTable'
import { TYPE_LABELS } from './components/format'

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'interrupted', label: 'Interrupted' },
  { value: 'failed', label: 'Failed' },
  { value: 'applied', label: 'Applied' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'info', label: 'Confirmed, no change' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'all', label: 'All' },
] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]['value']

const TYPES = Object.keys(TYPE_LABELS) as ProposalType[]

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function href(status: StatusFilter, type: ProposalType | undefined): string {
  const q = new URLSearchParams()
  if (status !== 'pending') q.set('status', status)
  if (type) q.set('type', type)
  const s = q.toString()
  return s ? `/?${s}` : '/'
}

export default async function QueuePage(props: PageProps<'/'>) {
  const sp = await props.searchParams
  await connection()
  const rawStatus = one(sp.status)
  const rawType = one(sp.type)
  const status: StatusFilter = STATUS_FILTERS.some((f) => f.value === rawStatus) ? (rawStatus as StatusFilter) : 'pending'
  const type = TYPES.includes(rawType as ProposalType) ? (rawType as ProposalType) : undefined

  const db = getDb()
  const all = db.listProposals()
  const now = new Date()
  const interrupted = new Set(all.filter((p) => isInterrupted(p, [], now)).map((p) => p.id))
  const by = (s: Status) => all.filter((p) => p.status === s).length
  const counts: Counts = {
    pending: by('pending'),
    interrupted: interrupted.size,
    failed: by('failed'),
    applied: by('applied'),
    rejected: by('rejected'),
    info: by('info'),
  }

  let rows: ProposalRow[] = all
  if (status === 'interrupted') rows = rows.filter((p) => interrupted.has(p.id))
  else if (status !== 'all') rows = rows.filter((p) => p.status === status)
  if (type) rows = rows.filter((p) => p.type === type)

  const typeCounts = new Map<ProposalType, number>()
  for (const p of all) {
    if (status === 'all' || (status === 'interrupted' ? interrupted.has(p.id) : p.status === status)) {
      typeCounts.set(p.type, (typeCounts.get(p.type) ?? 0) + 1)
    }
  }

  const statusLabel = STATUS_FILTERS.find((f) => f.value === status)!.label

  return (
    <div className="stack">
      <h1>Review queue</h1>
      <CountsStrip counts={counts} run={db.lastRunInfo()} />

      <nav className="filters" aria-label="Filters">
        <span className="label">Status</span>
        <ul>
          {STATUS_FILTERS.map((f) => (
            <li key={f.value}>
              <Link href={href(f.value, type)} aria-current={f.value === status ? 'page' : undefined}>
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
        <span className="label">Type (in {statusLabel})</span>
        <ul>
          <li>
            <Link href={href(status, undefined)} aria-current={!type ? 'page' : undefined}>
              All types
            </Link>
          </li>
          {TYPES.filter((t) => (typeCounts.get(t) ?? 0) > 0 || t === type).map((t) => (
            <li key={t}>
              <Link href={href(status, t)} aria-current={t === type ? 'page' : undefined}>
                {TYPE_LABELS[t]} <span className="num">({typeCounts.get(t) ?? 0})</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {rows.length > 0 ? (
        <QueueTable rows={rows} interrupted={interrupted} />
      ) : (
        <div className="panel empty">
          {status === 'pending' && !type ? (
            <p>
              No pending proposals. Run <code>npm run pipeline</code> to check for changes.
            </p>
          ) : (
            <p>No proposals match these filters.</p>
          )}
        </div>
      )}
    </div>
  )
}
