import type { Status } from '@/store/db'
import { STATUS_LABELS } from './format'

export function StatusBadge({ status, interrupted, testId }: { status: Status; interrupted?: boolean; testId?: string }) {
  const cls = interrupted ? 'interrupted' : status
  return (
    <span className={`status ${cls}`} data-testid={testId}>
      {interrupted ? 'Interrupted' : STATUS_LABELS[status]}
    </span>
  )
}
