/** Write-side contract. No `server-only` import: tests and the fake CRM implement it. */
export interface CrmWriter {
  createAccount(body: Record<string, string>): Promise<{ account_id: string }>
  patchAccount(id: string, body: Record<string, string>): Promise<void>
}

/** A write whose outcome is unknown (network error or timeout). Never retried blindly. */
export class UnknownOutcomeError extends Error {
  constructor(message = 'write outcome unknown') {
    super(message)
    this.name = 'UnknownOutcomeError'
  }
}
