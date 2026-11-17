import type { Account } from '@/types'
import { CrmError, type CrmReader } from '@/crm/read'
import { UnknownOutcomeError, type CrmWriter } from '@/crm/contracts'
import { loadAccounts } from './helpers/data'

type Method = 'PATCH' | 'POST'

/** In-memory CRM over a copy of the fixtures. Edit `accounts` directly to simulate drift. */
export class FakeCrm implements CrmReader, CrmWriter {
  accounts: Account[] = loadAccounts()
  private counter = 0
  private failures: Partial<Record<Method, 'http500' | 'network'>> = {}

  failNext(method: Method, kind: 'http500' | 'network') {
    this.failures[method] = kind
  }

  private maybeFail(method: Method) {
    const kind = this.failures[method]
    if (!kind) return
    delete this.failures[method]
    if (kind === 'http500') throw new CrmError(500, 'fake failure')
    throw new UnknownOutcomeError()
  }

  async listAccounts() {
    return structuredClone(this.accounts)
  }

  async getAccount(id: string) {
    const a = this.accounts.find((x) => x.account_id === id)
    if (!a) throw new CrmError(404, 'Account not found')
    return structuredClone(a)
  }

  async createAccount(body: Record<string, string>) {
    this.maybeFail('POST')
    const id = '001FAKE' + String(++this.counter).padStart(11, '0')
    const base: Account = {
      account_id: id, name: '', parent_id: '', parent_name: '', billing_street: '', billing_city: '',
      billing_state: '', billing_zip: '', care_type: '', status: 'Active', phone: '', lifetime_revenue: 0,
      outstanding_ar: 0, chow_current_account: '', duplicate_of_account: '', note: '',
      created_by_candidate: true, updated_at: new Date().toISOString(),
    }
    this.accounts.push({ ...base, ...body, account_id: id, created_by_candidate: true } as Account)
    return { account_id: id }
  }

  async patchAccount(id: string, body: Record<string, string>) {
    this.maybeFail('PATCH')
    const a = this.accounts.find((x) => x.account_id === id)
    if (!a) throw new CrmError(404, 'Account not found')
    Object.assign(a, body, { updated_at: new Date().toISOString() })
  }
}
