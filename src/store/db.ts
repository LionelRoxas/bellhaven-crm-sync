import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Account, Evidence, ProposalDraft, ProposalType } from '@/types'
import { fingerprint } from './fingerprint'

export type Status = 'info' | 'pending' | 'approved' | 'applied' | 'failed' | 'rejected' | 'superseded'
export type StepStatus = 'pending' | 'done' | 'failed' | 'unknown'

export type ProposalRow = {
  id: string
  fingerprint: string
  type: ProposalType
  status: Status
  locationSlug: string | null
  accountIds: string[]
  title: string
  summary: string
  confidence: number
  evidence: Evidence
  snapshot: Record<string, Partial<Account>>
  firstRun: number
  lastRun: number
  decidedAt: string | null
  comment: string | null
}

export type StepRow = {
  proposalId: string
  idx: number
  method: 'POST' | 'PATCH'
  accountId: string | null
  body: Record<string, unknown>
  noteReason: string | null
  status: StepStatus
  resultAccountId: string | null
  response: string | null
  error: string | null
  attemptedAt: string | null
}

export type RunCounts = {
  locations: number
  accounts: number
  created: number
  refreshed: number
  suppressed: number
  superseded: number
}

export type UpsertResult = Pick<RunCounts, 'created' | 'refreshed' | 'suppressed' | 'superseded'>

export type RunInfo = RunCounts & {
  id: number
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export type StepPatch = Partial<
  Pick<StepRow, 'status' | 'resultAccountId' | 'response' | 'error' | 'attemptedAt'>
>

export type TransitionExtra = {
  comment?: string
  decidedAt?: string
  /** Extra conditions checked in the same UPDATE, so the check and the change are atomic. */
  ifMatch?: {
    fingerprint?: string
    lastRun?: number
    /** `decided_at` is NULL or strictly earlier than this ISO time. */
    decidedBefore?: string
  }
}

export type Db = {
  startRun(at?: Date): number
  finishRun(id: number, result: RunCounts | { error: string }, at?: Date): void
  lastGoodRun(): { id: number; locations: number } | null
  upsertDrafts(runId: number, drafts: ProposalDraft[]): UpsertResult
  listProposals(f?: { type?: ProposalType; status?: Status }): ProposalRow[]
  getProposal(id: string): ProposalRow | null
  getSteps(id: string): StepRow[]
  transition(id: string, from: Status[], to: Status, extra?: TransitionExtra): boolean
  updateStep(proposalId: string, idx: number, patch: StepPatch): void
  lastRunInfo(): RunInfo | null
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  locations INTEGER,
  accounts INTEGER,
  created INTEGER,
  refreshed INTEGER,
  suppressed INTEGER,
  superseded INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  fingerprint TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  location_slug TEXT,
  account_ids TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  first_run INTEGER NOT NULL,
  last_run INTEGER NOT NULL,
  decided_at TEXT,
  comment TEXT
);
CREATE INDEX IF NOT EXISTS proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS proposals_type ON proposals(type);
CREATE TABLE IF NOT EXISTS steps (
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  idx INTEGER NOT NULL,
  method TEXT NOT NULL,
  account_id TEXT,
  body TEXT NOT NULL,
  note_reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  result_account_id TEXT,
  response TEXT,
  error TEXT,
  attempted_at TEXT,
  PRIMARY KEY (proposal_id, idx)
);
`

type Row = Record<string, unknown>

function toProposal(r: Row): ProposalRow {
  return {
    id: r.id as string,
    fingerprint: r.fingerprint as string,
    type: r.type as ProposalType,
    status: r.status as Status,
    locationSlug: (r.location_slug as string | null) ?? null,
    accountIds: JSON.parse(r.account_ids as string),
    title: r.title as string,
    summary: r.summary as string,
    confidence: r.confidence as number,
    evidence: JSON.parse(r.evidence as string),
    snapshot: JSON.parse(r.snapshot as string),
    firstRun: r.first_run as number,
    lastRun: r.last_run as number,
    decidedAt: (r.decided_at as string | null) ?? null,
    comment: (r.comment as string | null) ?? null,
  }
}

function toStep(r: Row): StepRow {
  return {
    proposalId: r.proposal_id as string,
    idx: r.idx as number,
    method: r.method as 'POST' | 'PATCH',
    accountId: (r.account_id as string | null) ?? null,
    body: JSON.parse(r.body as string),
    noteReason: (r.note_reason as string | null) ?? null,
    status: r.status as StepStatus,
    resultAccountId: (r.result_account_id as string | null) ?? null,
    response: (r.response as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    attemptedAt: (r.attempted_at as string | null) ?? null,
  }
}

const STEP_COLUMNS: Record<keyof StepPatch, string> = {
  status: 'status',
  resultAccountId: 'result_account_id',
  response: 'response',
  error: 'error',
  attemptedAt: 'attempted_at',
}

const SUPPRESSING: Status[] = ['approved', 'applied', 'failed', 'rejected']

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA)

  const q = (sql: string) => db.prepare(sql)

  /** `p_` + first 6 hex of the fingerprint; extended by 2 on a collision with another fingerprint. */
  function freshId(fp: string): string {
    for (let len = 6; len <= fp.length; len += 2) {
      const id = `p_${fp.slice(0, len)}`
      if (!q('SELECT 1 FROM proposals WHERE id = ?').get(id)) return id
    }
    throw new Error('Could not allocate a proposal id')
  }

  return {
    startRun(at = new Date()) {
      const r = q('INSERT INTO runs (started_at) VALUES (?)').run(at.toISOString())
      return Number(r.lastInsertRowid)
    },

    finishRun(id, result, at = new Date()) {
      if ('error' in result) {
        q('UPDATE runs SET finished_at = ?, error = ? WHERE id = ?').run(at.toISOString(), result.error, id)
        return
      }
      q(
        `UPDATE runs SET finished_at = ?, locations = ?, accounts = ?, created = ?, refreshed = ?,
           suppressed = ?, superseded = ?, error = NULL WHERE id = ?`,
      ).run(
        at.toISOString(), result.locations, result.accounts, result.created,
        result.refreshed, result.suppressed, result.superseded, id,
      )
    },

    lastGoodRun() {
      const r = q(
        'SELECT id, locations FROM runs WHERE error IS NULL AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1',
      ).get() as Row | undefined
      return r ? { id: r.id as number, locations: r.locations as number } : null
    },

    upsertDrafts(runId, drafts) {
      const out: UpsertResult = { created: 0, refreshed: 0, suppressed: 0, superseded: 0 }
      const find = q('SELECT id, status FROM proposals WHERE fingerprint = ?')
      const refresh = q(
        `UPDATE proposals SET evidence = ?, snapshot = ?, title = ?, summary = ?, confidence = ?, last_run = ?
         WHERE id = ? AND status IN ('pending','info')`,
      )
      const revive = q(
        `UPDATE proposals SET status = ?, evidence = ?, snapshot = ?, title = ?, summary = ?, confidence = ?,
           last_run = ? WHERE id = ? AND status = 'superseded'`,
      )
      const insP = q(
        `INSERT INTO proposals (id, fingerprint, type, status, location_slug, account_ids, title, summary,
           confidence, evidence, snapshot, first_run, last_run)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const insS = q(
        `INSERT INTO steps (proposal_id, idx, method, account_id, body, note_reason, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      const supersede = q(
        `UPDATE proposals SET status = 'superseded' WHERE status IN ('pending','info') AND last_run < ?`,
      )

      db.exec('BEGIN IMMEDIATE')
      try {
        for (const d of drafts) {
          const fp = fingerprint(d)
          const status: Status = d.type === 'confirmed' ? 'info' : 'pending'
          const evidence = JSON.stringify(d.evidence)
          const snapshot = JSON.stringify(d.snapshot)
          const hit = find.get(fp) as Row | undefined
          if (hit) {
            const st = hit.status as Status
            const id = hit.id as string
            if (SUPPRESSING.includes(st)) {
              out.suppressed++
            } else if (st === 'superseded') {
              // The finding came back after being superseded: bring it back for review.
              revive.run(status, evidence, snapshot, d.title, d.summary, d.confidence, runId, id)
              out.created++
            } else {
              refresh.run(evidence, snapshot, d.title, d.summary, d.confidence, runId, id)
              out.refreshed++
            }
            continue
          }
          const id = freshId(fp)
          insP.run(
            id, fp, d.type, status, d.locationSlug, JSON.stringify([...d.accountIds].sort()),
            d.title, d.summary, d.confidence, evidence, snapshot, runId, runId,
          )
          d.steps.forEach((s, i) => insS.run(id, i, s.method, s.accountId, JSON.stringify(s.body), s.noteReason))
          out.created++
        }
        out.superseded = Number(supersede.run(runId).changes)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return out
    },

    listProposals(f = {}) {
      const where: string[] = []
      const args: string[] = []
      if (f.type) {
        where.push('type = ?')
        args.push(f.type)
      }
      if (f.status) {
        where.push('status = ?')
        args.push(f.status)
      }
      const sql = `SELECT * FROM proposals ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY type, location_slug, id`
      return (q(sql).all(...args) as Row[]).map(toProposal)
    },

    getProposal(id) {
      const r = q('SELECT * FROM proposals WHERE id = ?').get(id) as Row | undefined
      return r ? toProposal(r) : null
    },

    getSteps(id) {
      return (q('SELECT * FROM steps WHERE proposal_id = ? ORDER BY idx').all(id) as Row[]).map(toStep)
    },

    transition(id, from, to, extra = {}) {
      if (from.length === 0) return false
      const marks = from.map(() => '?').join(',')
      const conds: string[] = []
      const condArgs: (string | number)[] = []
      const m = extra.ifMatch ?? {}
      if (m.fingerprint !== undefined) {
        conds.push('fingerprint = ?')
        condArgs.push(m.fingerprint)
      }
      if (m.lastRun !== undefined) {
        conds.push('last_run = ?')
        condArgs.push(m.lastRun)
      }
      if (m.decidedBefore !== undefined) {
        conds.push('(decided_at IS NULL OR decided_at < ?)')
        condArgs.push(m.decidedBefore)
      }
      const r = q(
        `UPDATE proposals SET status = ?, comment = COALESCE(?, comment), decided_at = COALESCE(?, decided_at)
         WHERE id = ? AND status IN (${marks})${conds.map((c) => ` AND ${c}`).join('')}`,
      ).run(to, extra.comment ?? null, extra.decidedAt ?? null, id, ...from, ...condArgs)
      return Number(r.changes) > 0
    },

    updateStep(proposalId, idx, patch) {
      const sets: string[] = []
      const args: (string | null)[] = []
      for (const key of Object.keys(STEP_COLUMNS) as (keyof StepPatch)[]) {
        const v = patch[key]
        if (v !== undefined) {
          sets.push(`${STEP_COLUMNS[key]} = ?`)
          args.push(v)
        }
      }
      if (sets.length === 0) return
      q(`UPDATE steps SET ${sets.join(', ')} WHERE proposal_id = ? AND idx = ?`).run(...args, proposalId, idx)
    },

    lastRunInfo() {
      const r = q('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get() as Row | undefined
      if (!r) return null
      return {
        id: r.id as number,
        startedAt: r.started_at as string,
        finishedAt: (r.finished_at as string | null) ?? null,
        error: (r.error as string | null) ?? null,
        locations: (r.locations as number) ?? 0,
        accounts: (r.accounts as number) ?? 0,
        created: (r.created as number) ?? 0,
        refreshed: (r.refreshed as number) ?? 0,
        suppressed: (r.suppressed as number) ?? 0,
        superseded: (r.superseded as number) ?? 0,
      }
    },

    close() {
      db.close()
    },
  }
}
