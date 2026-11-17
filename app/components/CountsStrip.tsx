import Link from 'next/link'
import type { RunInfo } from '@/store/db'
import { utc } from './format'

export type Counts = { pending: number; interrupted: number; failed: number; applied: number; rejected: number; info: number }

const ITEMS: { key: keyof Counts; label: string; status: string }[] = [
  { key: 'pending', label: 'Pending', status: 'pending' },
  { key: 'interrupted', label: 'Interrupted', status: 'interrupted' },
  { key: 'failed', label: 'Failed', status: 'failed' },
  { key: 'applied', label: 'Applied', status: 'applied' },
  { key: 'rejected', label: 'Rejected', status: 'rejected' },
  { key: 'info', label: 'Confirmed, no change', status: 'info' },
]

export function CountsStrip({ counts, run }: { counts: Counts; run: RunInfo | null }) {
  return (
    <section aria-label="Counts">
      <dl className="counts">
        {ITEMS.map((i) => (
          <div key={i.key}>
            <dt>{i.label}</dt>
            <dd>
              <Link href={`/?status=${i.status}`} data-testid={`count-${i.key}`}>
                {counts[i.key]}
              </Link>
            </dd>
          </div>
        ))}
      </dl>
      <p className="small muted" style={{ marginTop: 8 }}>
        {!run
          ? 'No runs yet.'
          : run.error
            ? `Last run failed at ${utc(run.startedAt)}: ${run.error}`
            : `Snapshot from ${utc(run.finishedAt ?? run.startedAt)}: ${run.locations} website locations, ${run.accounts} CRM accounts.`}
      </p>
    </section>
  )
}
