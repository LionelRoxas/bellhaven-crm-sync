import type { Account, Evidence } from '@/types'
import { money, safeHref } from './format'
import { Src } from './Src'

type FieldRow = {
  label: string
  /** CRM field name, used to match suspicious-text flags. */
  field: keyof Account
  site?: (e: Evidence) => string | undefined
  crm: (a: Account) => string
  /** Compare the website value with the CRM value and highlight a difference. */
  compare?: boolean
  numeric?: boolean
}

const ROWS: FieldRow[] = [
  { label: 'Name', field: 'name', site: (e) => e.location?.name, crm: (a) => a.name, compare: true },
  { label: 'Street', field: 'billing_street', site: (e) => e.location?.street, crm: (a) => a.billing_street, compare: true },
  { label: 'City', field: 'billing_city', site: (e) => e.location?.city, crm: (a) => a.billing_city, compare: true },
  { label: 'State', field: 'billing_state', site: (e) => e.location?.state, crm: (a) => a.billing_state, compare: true },
  { label: 'Zip', field: 'billing_zip', site: (e) => e.location?.zip, crm: (a) => a.billing_zip, compare: true },
  { label: 'Care', field: 'care_type', site: (e) => e.location?.offerings.join('; '), crm: (a) => a.care_type },
  { label: 'Parent', field: 'parent_name', crm: (a) => a.parent_name },
  { label: 'Status', field: 'status', crm: (a) => a.status },
  { label: 'Lifetime revenue', field: 'lifetime_revenue', crm: (a) => money(a.lifetime_revenue), numeric: true },
  { label: 'Outstanding AR', field: 'outstanding_ar', crm: (a) => money(a.outstanding_ar), numeric: true },
  { label: 'CHOW current account', field: 'chow_current_account', crm: (a) => a.chow_current_account },
  { label: 'Duplicate of', field: 'duplicate_of_account', crm: (a) => a.duplicate_of_account },
  { label: 'Note', field: 'note', crm: (a) => a.note },
]

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

export function EvidenceTable({ evidence, linkedIds }: { evidence: Evidence; linkedIds: string[] }) {
  const accounts = [...evidence.accounts].sort(
    (a, b) => Number(!linkedIds.includes(a.account_id)) - Number(!linkedIds.includes(b.account_id)),
  )
  const hasSite = !!evidence.location
  const siteHref = safeHref(evidence.location?.url)
  const flagged = (a: Account, f: keyof Account) =>
    evidence.suspiciousText.some((s) => s.accountId === a.account_id && s.field === f)

  return (
    <section className="panel" aria-labelledby="evidence-h">
      <div className="panel-head">
        <h2 id="evidence-h">Evidence</h2>
        <p className="legend">
          Shaded text is source data from the website or CRM, shown as plain text. Highlighted cells differ from the
          website.
        </p>
      </div>
      <div className="scroll-x">
        <table className="grid" aria-label="Evidence">
          <thead>
            <tr>
              <th scope="col">Field</th>
              {hasSite && (
                <th scope="col">
                  Website
                  {siteHref && (
                    <>
                      {' '}
                      <a href={siteHref} target="_blank" rel="noreferrer noopener" className="small">
                        page
                      </a>
                    </>
                  )}
                </th>
              )}
              {accounts.map((a) => (
                <th scope="col" key={a.account_id}>
                  CRM <span className="mono">{a.account_id}</span>
                  {!linkedIds.includes(a.account_id) && <span className="tag">not linked</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const site = r.site?.(evidence)
              return (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {hasSite && (
                    <td>
                      <Src text={site} />
                    </td>
                  )}
                  {accounts.map((a) => {
                    const v = r.crm(a)
                    const changed = hasSite && r.compare && norm(site) !== norm(v)
                    return (
                      <td key={a.account_id} className={`${changed ? 'changed' : ''}${r.numeric ? ' num' : ''}`}>
                        {r.numeric ? v : <Src text={v} />}
                        {changed && <span className="tag">differs</span>}
                        {flagged(a, r.field) && (
                          <div>
                            <span className="flag">Contains instruction-like text, shown as data only</span>
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
