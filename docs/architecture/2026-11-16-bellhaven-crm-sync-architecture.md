# Bellhaven CRM Sync: architecture

**Design:** `docs/superpowers/specs/2026-11-16-bellhaven-crm-sync-design.md`
Status: Approved 2026-11-16

## 1. Overview

```mermaid
flowchart LR
  cron[cron, daily] --> P[pipeline script<br/>npm run pipeline]
  P -- scrape HTML --> W[(Bellhaven website)]
  P -- GET accounts --> C[(CRM API)]
  P -- upsert proposals --> DB[(SQLite<br/>data/sync.db)]
  R[Reviewer browser] --> A[Next.js app<br/>127.0.0.1:3000]
  A -- read queue --> DB
  A -- approve: re-read, then POST/PATCH --> C
  A -- step log --> DB
```

A standalone TypeScript pipeline scrapes the website, loads every CRM account, matches by address, and turns each location (and each stale account) into one proposal with its evidence and an ordered list of planned API writes. It stores them in SQLite, keyed by a fingerprint so re-runs never re-propose a decided item. A local Next.js app shows the queue; only an Approve click executes a proposal's writes, step by step, logging each call.

## 2. Stack and why

| Choice | Why | Rejected |
|---|---|---|
| TypeScript 5, Node 24 | User's pick; Node 24 ships `node:sqlite` and `fetch` | Python |
| Next.js 16.4 App Router (pinned `16.4.x`) | User's pick; Server Actions give approve/reject without a hand-written API | Hono single page |
| `node:sqlite` (built in) | No native build on Windows; sync API is fine for one local user | better-sqlite3 (native), JSON files |
| `cheerio` 1.x | Parses the site's simple HTML reliably; selectors are readable in a live edit | regex on HTML |
| `zod` 4 | Validates CRM responses and Server Action inputs at the boundary | hand-written guards |
| `tsx` | Runs the pipeline script and its `@/` imports without a build | Node type stripping (no path aliases) |
| Vitest 3, Playwright 1.5x | Unit/integration and one e2e flow | Jest |
| No auth, no hosting | Design non-goal; app binds to 127.0.0.1 only | |

Next.js 16 gotcha (from `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`): synchronous `node:sqlite` reads are treated as prerenderable. Every page that reads the DB calls `await connection()` first so it renders per request.

## 3. Data model

SQLite file `data/sync.db` (git-ignored), WAL mode, `busy_timeout = 5000` so the pipeline and the app can overlap. Schema is created idempotently on open (`CREATE TABLE IF NOT EXISTS`); no migration tool.

**runs**: `id INTEGER PK`, `started_at TEXT`, `finished_at TEXT NULL`, `locations INTEGER`, `accounts INTEGER`, `created INTEGER`, `refreshed INTEGER`, `suppressed INTEGER`, `superseded INTEGER`, `error TEXT NULL`.

**proposals**:
- `id TEXT PK` (short readable id, e.g. `p_7f3a1c`), `fingerprint TEXT UNIQUE NOT NULL`
- `type TEXT` (`confirmed | update_fields | reparent | chow | duplicate | create | stale | sold`)
- `status TEXT` (`info | pending | approved | applied | failed | rejected | superseded`)
  - `info` for `confirmed` (nothing to write, never approvable)
  - Mapping to the design's words: approved in the design = `approved` (applying) → `applied` | `failed`. An `approved` row older than 5 minutes with steps not all done is shown as **Interrupted** and can be resumed with `retry`.
- `location_slug TEXT NULL`, `account_ids TEXT` (JSON array, involved accounts)
- `title TEXT`, `summary TEXT`, `confidence REAL`
- `evidence TEXT` (JSON: website facts, each CRM account as read, match reasons, SOP check)
- `snapshot TEXT` (JSON: per account, the fields the writes depend on: touched fields + `parent_id`, `status`)
- `first_run INTEGER`, `last_run INTEGER`, `decided_at TEXT NULL`, `comment TEXT NULL`
- Index: `(status)`, `(type)`.

**steps** (planned writes, one row per API call): `proposal_id TEXT FK`, `idx INTEGER`, `method TEXT` (`POST | PATCH`), `account_id TEXT NULL` (NULL for POST), `body TEXT` (JSON; a field value may be the typed marker `{"$ref":"created"}`, meaning the id returned by this proposal's POST step, allowed only at `parent_id`, `chow_current_account`, `duplicate_of_account`; any other occurrence fails the step), `note_reason TEXT NULL` (the note line is built at apply time as `[bellhaven-sync YYYY-MM-DD <proposal id>] <reason>` and appended to the account's current note), `status TEXT` (`pending | done | failed | unknown`), `result_account_id TEXT NULL`, `response TEXT NULL`, `error TEXT NULL`, `attempted_at TEXT NULL`. PK `(proposal_id, idx)`.

Access rules: single local user; the DB is only reachable by code on this machine. The app never accepts write bodies from the browser: steps come only from the DB.

### Fingerprint and suppression
`fingerprint = sha256(type + sorted account ids + location slug + canonical JSON of every step's method/account/body)`. Bodies never contain notes or dates (notes are built at apply time), so the same finding hashes the same every day. On each run, all network I/O happens first; then one `BEGIN IMMEDIATE` transaction does:
- fingerprint exists with status in `approved | applied | failed | rejected` → skip (suppressed).
- exists as `pending | info` → refresh evidence/snapshot, set `last_run` (`UPDATE … WHERE status IN ('pending','info')`, so a row approved meanwhile is never touched).
- new → insert as `pending` (or `info`).
- `pending`/`info` rows whose `last_run` < this run → `superseded` (same conditional update).

**Matching exclusions** (prevent applied fixes coming back): accounts with `duplicate_of_account` or `chow_current_account` set are evidence only, never candidates; stale accounts already `Needs Review` with a `[bellhaven-sync` note aren't re-proposed.

**Short-scrape guard:** the run aborts before the transaction if it found 0 locations or ≥20% fewer than the last successful run.

## 4. API surface

Server Actions in `app/actions.ts` (`'use server'`), inputs validated with zod:

| Action | Input | Effect | Errors (returned as `{ok:false, message}`) |
|---|---|---|---|
| `approve` | `id`, `fingerprint` and `lastRun` the reviewer saw, `comment?: string ≤ 500` | `pending → approved` only if fingerprint and last_run still match, then `applyProposal(id)` → `applied` or `failed` | not found; not pending; proposal refreshed since you opened it; CRM changed since proposal; CRM call failed (step + `detail`) |
| `reject` | `id`, `comment?` | `pending → rejected` | not found; not pending |
| `retry` | `id` | `failed` or Interrupted `approved` → re-run remaining steps | not found; not failed/interrupted; a step is `unknown` (must be checked by hand first) |

`app/actions.ts` exports only these three functions; `applyProposal` lives in `src/apply`, never in a `'use server'` file. Actions return `{ok, message}` and never throw raw errors to the client. Each action calls `revalidatePath` for `/` and the proposal page. Status transitions use a conditional `UPDATE … WHERE status = ?` so a double click can't apply twice.

No route handlers. The pipeline is a CLI: `npm run pipeline` (`tsx scripts/pipeline.ts`), exit code 0 on success, non-zero on scrape/CRM failure (nothing written to `proposals` on a failed run; the run row records the error).

### CRM client, split by capability
- `src/crm/read.ts`: `listAccounts()` (paginates `page_size=100` until `total`), `getAccount(id)`. Used by the pipeline and the app.
- `src/crm/write.ts` (`import 'server-only'`): `createAccount(body)`, `patchAccount(id, body)`. Used only by `src/apply`. The pipeline physically can't load it; a unit test asserts no file under `src/sync` or `scripts/` imports `crm/write` or `src/apply`. Vitest aliases `server-only` to an empty module.
- Bearer token from `CRM_TOKEN`. GETs retry on 5xx/network errors (3×, backoff); writes never retry automatically. Account ids are checked against `^[0-9A-Z]{18}$` and passed through `encodeURIComponent`. Errors become `CrmError {status, detail}` with only the response's `detail`, never request headers or options.

### Apply algorithm (`src/apply/apply.ts`)
1. Load steps. If any step is `unknown`, refuse: "A previous write may or may not have landed. Check the CRM and mark the step done or failed."
2. Re-read each involved account and compare with what it should be now: the original `snapshot`, with the values of already-`done` steps applied on top. On mismatch → fail with "CRM changed since this proposal was made. Run the pipeline again."
3. Run pending steps in order, substituting `{"$ref":"created"}` with the stored created id and appending the note line where `note_reason` is set.
4. Each step's result is written before the next starts. A 4xx/5xx response → step `failed`, proposal `failed`, stop. A network error or timeout on a write (outcome unknown) → step `unknown`, proposal `failed`, stop; never re-sent blindly, so a lost POST response can't create a second account. (Replaces a marker-based lookup: simpler, and safe.)

## 5. Auth and permissions

One role: the local reviewer. Enforcement points:
- Next binds to `127.0.0.1` (`next dev -H 127.0.0.1`, `next start -H 127.0.0.1`).
- `proxy.ts` returns 403 unless the `Host` header is `127.0.0.1:<port>` or `localhost:<port>`. This blocks DNS-rebinding pages, which would otherwise pass Next's Origin-equals-Host Server Action check.
- Server Actions accept only an id and a comment; status preconditions are checked in SQL on the server. Next's Server Action origin check rejects cross-site posts.
- The CRM token lives only in `.env.local`, read in server-only modules (`import 'server-only'`); it never reaches the client bundle or logs.
- The pipeline cannot write to the CRM: see the read/write client split in §4.

## 6. Frontend structure

Routes: `/` (queue), `/proposals/[id]` (detail). Root layout holds the header (app name, last run time, link to CRM browser).

- **Queue page** (server component): counts strip, snapshot size (locations, accounts) and last run; filter links by type/status as query params (`?type=chow&status=pending`), so state lives in the URL; a table (not cards) of proposals: type, facility, city/state, summary, confidence, status. Default filter: pending. A "Confirmed, no change" filter lists `confirmed` locations, so every location is visibly accounted for; an "Interrupted" filter shows stuck approvals.
- **Detail page** (server component):
  - `OwnershipChain`: the memorable element, built from HTML/CSS boxes and connector lines (no SVG, to keep it cheap and editable): `[old parent] ── [facility] ──▶ [Bellhaven]`; CHOW shows a fork (old account stays, new account under Bellhaven, dashed `chow_current_account` link); duplicates show losers greyed, pointing at the survivor.
  - `EvidenceTable`: website vs each CRM account, rows = fields, changed cells highlighted.
  - `MatchReasons`, `SopCheck` (revenue, AR, rule applied).
  - `PlannedWrites`: ordered list of calls in plain words plus the JSON body in a `<details>`.
  - `DecisionForm` (client component): comment textarea, Approve / Reject buttons using `useActionState`, pending state, result message. After a decision: `StepLog`.
- **UI library:** none. All controls are native (`<a>`, `<button>`, `<textarea>`, `<details>`): no menus, dialogs, comboboxes or tabs. See ADR-4.
- **Tokens** (CSS variables in `app/globals.css`, light and dark):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F7F8FA` | `#14171C` | page |
| `--surface` | `#FFFFFF` | `#1B1F26` | tables, panels |
| `--ink` | `#1E2430` | `#E6E9EF` | text |
| `--muted` | `#5D6677` | `#9AA3B2` | secondary text |
| `--rule` | `#D9DEE7` | `#2C323D` | borders |
| `--approve` | `#0E6B5B` | `#3FB59D` | approve, applied |
| `--reject` | `#A23A2C` | `#E07A6B` | reject, failed |
| `--changed` | `#FFF1C2` | `#4A3F14` | highlighted changed cells |
| `--link` | `#2457A6` | `#8DB4F0` | links, chain edges |

  Type: **Public Sans** (variable, via `next/font/google`) for all UI; tabular numerals for money and counts. Account ids in `ui-monospace` only because they are codes. Scale (px): 13 / 15 (body) / 18 / 23 / 29. Spacing on a 4px grid; radius 6px on panels, 4px on badges. Left-aligned throughout; max content width 1180px; the evidence table scrolls horizontally inside its panel at 375px.

## 7. Cross-cutting

- **Validation:** zod at three boundaries: CRM responses (`AccountSchema`), scraped location (`LocationSchema`: required name ≤ 120, street ≤ 120, city ≤ 60, 2-letter state, 5-digit zip, 1–5 offerings each ≤ 60; HTML entities decoded and control characters stripped), Server Action inputs. Detail-page links are resolved against `SITE_BASE`, and links to other origins are rejected; any URL rendered as a link must be http(s).
- **Normalization:** only the last street token is treated as a suffix (`Road→rd`), and a trailing direction (`Barks Road West`) is recognized, so `45 St Lawrence Dr` keeps "st" as Saint. A scraped location failing validation fails the run (better than silently dropping a facility).
- **Errors:** pipeline logs one line per phase and exits non-zero on failure. The app shows the CRM's `detail` verbatim next to the failed step, plus what to do ("Fix and retry", "Run the pipeline again").
- **States:** empty queue ("No pending proposals. Run `npm run pipeline` to check for changes."); no runs yet; failed proposal banner; pending button state during apply.
- **Accessibility:** WCAG AA: contrast checked for all token pairs, visible focus ring (`--link`, 2px), the chain SVG has a text equivalent (`<title>` + the summary sentence), status is never color-only (text labels).
- **Security:** see §5; React escapes scraped strings; no `dangerouslySetInnerHTML`; log lines never include headers.
- **Untrusted content (prompt-injection boundary):** everything from the website and the CRM is data, never instructions.
  - The pipeline has no LLM, so text can't steer it. Classification depends only on normalized field values and fixed rules in code.
  - Free text from outside (CRM `note`, names, page text) never selects a proposal type, a target account or a write body. Write bodies are built only from parsed structured fields (address, zip, ids, revenue/AR) and our own templates. Existing note text is carried over verbatim when we append, never interpreted.
  - The UI renders outside text as escaped plain text, visually marked as quoted source data. A field that looks like instructions (regex on phrases like "ignore previous", "approve", "you are", "system prompt", hidden or zero-width characters) adds a `suspicious_text` flag to the evidence, so the reviewer sees it. It never changes the proposal.
  - Build-time agents: `CLAUDE.md` states the same rule for every Claude session and subagent working on this repo. Briefs that hand agents fixture or recon data label it as untrusted data.
- **Performance:** ~40 proposals; no budget concerns. The pipeline makes ~4 website requests + ~35 detail pages + 2 CRM list calls; it fetches detail pages with concurrency 4.
- **Observability:** `runs` table + `logs/pipeline.log` (cron redirect); step log per proposal.

## 8. Testing strategy

- **Fixtures:** `test/fixtures/accounts.json` and `test/fixtures/site/*.html` (saved from the live sandbox on 2026-11-16, including a page-4 request that repeats page 3).
- **Unit (Vitest):** normalization (street suffixes, directions, PO box), matcher scoring, care-type mapping, survivor ranking, SOP branch, fingerprint stability.
- **Classification table test:** runs scrape-parse + classify on fixtures and asserts every expected outcome listed in the design's Recon section (types, survivors, CHOW vs reparent, Kettering's 3 accounts, Sandusky sold, lookalikes not matched).
- **Pipeline idempotency:** run the pipeline twice against fixtures + temp DB → second run creates 0; approve/reject some, run again → those are suppressed; apply all proposals to the fake CRM, run again → 0 new proposals (covers CHOW/duplicate/stale coming back); change a fixture field → a new proposal appears and the old pending one is superseded; scrape returning 50% of locations → run aborts, queue unchanged.
- **Apply (integration):** an in-memory fake CRM implementing the 5 client methods: happy path for each type; CHOW POST ok + PATCH fail → retry resumes without a second POST; network error on POST → step `unknown`, retry refused; snapshot mismatch → refused; a `$ref` marker in a non-allowed field → step fails.
- **E2E (Playwright, one spec):** the app runs against a seeded temp DB and a small fake CRM HTTP server (`CRM_API_BASE` pointed at it): open queue → open proposal → approve → see "Applied" and the step log; reject another → status Rejected; reload → state persists; a request with `Host: evil.test` → 403.
- **CI:** `.github/workflows/ci.yml` on push: `npm ci`, typecheck, Vitest, Playwright (Chromium). No secrets; it sets `CRM_TOKEN=test` and uses the fake CRM. Fixtures are grepped for tokens before commit.

## 9. Deployment

Local only. Env vars (`.env.example`): `CRM_API_BASE`, `CRM_TOKEN`, `SITE_BASE`, `BELLHAVEN_PARENT_NAME` (default `Bellhaven Senior Living (Parent Account)`; resolved to an id at run start, and the run fails if not exactly one match), `DB_PATH` (default `data/sync.db`).
- Schedule: `deploy/crontab` with `0 6 * * * cd /opt/bellhaven-crm-sync && npm run pipeline >> logs/pipeline.log 2>&1`. Reference `.github/workflows/daily-sync.yml` with a header comment that it needs a shared DB to be useful; it is `workflow_dispatch`-only until then, `permissions: contents: read`, `CRM_TOKEN` scoped to the one step, never `pull_request_target`, and it never uploads the DB or logs as artifacts.
- Rollback: CRM writes can't be rolled back automatically; every applied step's prior values are in the proposal snapshot, so a manual PATCH can restore them. The step log is the audit trail.

## 10. Decisions (ADRs)

1. **SQLite via `node:sqlite`.** Why: durable decision memory and per-step log, no native build. Cost if wrong: swap the small `src/store` module for Postgres.
2. **One proposal per location (bundled writes).** Why: no half-fixed facilities, no ordering between proposals. Cost if wrong: a reviewer who wants to approve only part of a bundle must reject it and fix by hand.
3. **Address-first deterministic matching, no LLM.** Why: explainable evidence, testable on fixtures, free. Cost if wrong: an unusual rename at a new address is surfaced as `create` + `stale` instead of a match. The reviewer sees both and can reject.
4. **No component library (my call).** Why: the UI needs only native buttons, links, a textarea and `<details>`; UI SDK is beta and adds a dependency for nothing here. Cost if wrong: adding dialogs later means adopting one then.
5. **Pipeline is read-only against the CRM.** Why: "nothing writes without approval" is enforced by structure, not discipline. Cost if wrong: none.
6. **Snapshot-field comparison, not `updated_at`.** Why: every write bumps `updated_at`, including our own earlier steps. Cost if wrong: an unrelated field change slips through, which is harmless.
7. **cron over GitHub Actions.** Why: the review DB is local. Cost if wrong: move the DB to a hosted store.

## 11. Risks and open questions

- **Live data drift before submission** (owner: builder, at run time): the sandbox may differ from the fixtures; fixtures pin logic, and the real run's queue is reviewed by hand anyway.
- **Time budget** (owner: user): the brief expects ~2 hours; this is larger. Cut after review: SVG chain (now HTML/CSS), the lost-POST marker lookup (now an `unknown` step), lint in CI. Kept despite cost: one Playwright spec (the playbook requires e2e for UI) and dark mode (cheap with CSS variables). The writeup states the real time.
- **Next 16 API differences** (owner: builder, during build): read the bundled docs before each Next file; `params` is a Promise, `connection()` before DB reads.
- **Matching thresholds** (owner: builder, during build): tuned against fixtures; anything below the strong threshold is evidence only and is never linked; the location becomes `create`, which the reviewer can reject.
