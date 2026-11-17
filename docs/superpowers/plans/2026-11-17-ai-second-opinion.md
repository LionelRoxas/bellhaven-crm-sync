# AI Second Opinion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an advisory Groq LLM second opinion to `create` and `stale` proposals, shown in the review app, never affecting writes.

**Architecture:** A tiny Groq JSON client, a second-opinion module with a DB cache, an optional pipeline hook that annotates `evidence.aiOpinion` before drafts are stored, and a read-only UI box.

**Tech Stack:** TypeScript, Node 24 `fetch`, node:sqlite, zod 4, Next.js 16 App Router, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-ai-second-opinion-design.md` (design + architecture notes; small-feature path, no separate architecture doc).

## Global Constraints
- Model default `openai/gpt-oss-120b`; env `GROQ_API_KEY` (optional), `GROQ_MODEL` (optional override).
- Endpoint `https://api.groq.com/openai/v1/chat/completions`, header `Authorization: Bearer <key>`, `temperature: 0`, strict `json_schema` response format, 20 000 ms timeout.
- Opinion never alters `type`, `steps`, `accountIds`, `confidence`, `snapshot`, `sop`, or the fingerprint.
- CRM `note` is never sent to the model. Only name, street, city, state, zip, parent name (accounts) / name, street, city, state, zip (locations).
- `matchId` must be null or in the shortlist; `reason` trimmed to 300 chars; anything else → `unavailable`.
- No test ever calls the real Groq API; tests inject a fake `fetch`/`ask`.
- Never log or render the API key. Nothing under `app/` or `src/apply/` imports `src/ai/`.
- All existing tests (vitest 126, e2e 10) stay green.

## Review Focus
- Model returns a `matchId` not in the shortlist (hallucinated id) → `unavailable`, not shown as a match.
- Groq 429 / 5xx / timeout / malformed JSON → `unavailable` with a short why; the run still succeeds.
- No key set → no network call at all; opinions absent or `unavailable: "No GROQ_API_KEY set"`.
- A CRM name containing instruction-like text → still sent as data inside JSON, system prompt says data only; output still schema-validated.
- Re-run with unchanged inputs → cache hit, zero calls, same fingerprint/status (approved/rejected stay suppressed).

---

### Task 1: Groq client + config

**Files:** Create `src/ai/groq.ts`, `test/groq.test.ts`. Modify `src/config.ts`, `test/config.test.ts`.

**Interfaces — Produces:**
```ts
export type GroqJsonRequest = { apiKey: string; model: string; system: string; user: string; schemaName: string; schema: object; timeoutMs?: number; fetchImpl?: typeof fetch }
export async function groqJson(req: GroqJsonRequest): Promise<unknown>
// config.ts: Config gains `groqApiKey: string | null` and `groqModel: string` (default 'openai/gpt-oss-120b')
```

- [ ] Tests (fake `fetchImpl`): sends POST to the endpoint with Bearer header, `temperature: 0`, `response_format.type === 'json_schema'`, `json_schema.strict === true`, messages `[system, user]`; returns `JSON.parse(choices[0].message.content)`; throws on non-2xx with message containing the status but NOT the key; throws on unparseable content; passes an `AbortSignal`.
- [ ] Config tests: `groqApiKey` null when unset/empty; `groqModel` default and override via `GROQ_MODEL`.
- [ ] Implement; `npm test` green; `npm run typecheck` clean; commit `feat(ai): Groq JSON client and config`.

### Task 2: Second-opinion module + cache

**Files:** Create `src/ai/second-opinion.ts`, `test/second-opinion.test.ts`. Modify `src/types.ts`, `src/store/db.ts` (+ db tests in existing file or new `test/db-ai.test.ts`).

**Interfaces — Produces:**
```ts
// types.ts
export type AiOpinion =
  | { status: 'ok'; verdict: 'likely_same' | 'unlikely' | 'unsure'; matchId: string | null; matchLabel: string | null; reason: string; model: string }
  | { status: 'none'; why: string }          // nothing in the same city to compare
  | { status: 'unavailable'; why: string }
// Evidence gains: aiOpinion?: AiOpinion
// db.ts Db gains:
getAiOpinion(key: string): AiOpinion | null
putAiOpinion(key: string, opinion: AiOpinion): void   // table ai_opinions(key TEXT PRIMARY KEY, opinion TEXT NOT NULL, created_at TEXT NOT NULL)
// second-opinion.ts
export const PROMPT_VERSION = 1
export type Ask = (system: string, user: string, schemaName: string, schema: object) => Promise<unknown>
export async function addSecondOpinions(drafts: ProposalDraft[], ctx: { locations: Location[]; accounts: Account[]; ask: Ask | null; model: string; cache: Pick<Db, 'getAiOpinion' | 'putAiOpinion'> }): Promise<void>
```
Behavior: only `create` (uses `draft.evidence.location`) and `stale` (uses the single account in `draft.accountIds`) drafts; others untouched. Shortlist = same city+state, case/whitespace-insensitive; for create exclude accounts already in `draft.accountIds`. `ask === null` → `{status:'unavailable', why:'No GROQ_API_KEY set'}` without calling. Cache key = sha256(JSON of {model, PROMPT_VERSION, kind, subject, shortlist}); only `ok` results cached. `matchLabel` = the matched account's/location's name. Errors caught per draft → `unavailable` with `why` = `'AI request failed'` (status code omitted by ruling: fixed strings are safer; never the raw body). Calls sequential.

- [ ] Tests (fake `ask`): create with same-city candidate → `ok` with matchLabel; stale → shortlist is locations; empty shortlist → `none`, ask not called; hallucinated matchId → `unavailable`; bad shape → `unavailable`; ask throws → `unavailable`; reason > 300 chars trimmed; `note` never appears in the user payload (assert on captured `user` string with a note fixture); cache hit → ask not called second time; non-create/stale drafts untouched and steps/fingerprint inputs deep-equal before/after.
- [ ] DB tests: put/get roundtrip; unknown key → null.
- [ ] Implement; tests + typecheck green; commit `feat(ai): advisory second opinion with cache`.

### Task 3: Pipeline hook, script wiring, UI box, boundary + e2e

**Files:** Modify `src/sync/pipeline.ts`, `scripts/pipeline.ts`, `app/proposals/[id]/page.tsx`, `test/boundaries.test.ts`, `test/pipeline.test.ts`, `test/e2e/global-setup.ts`, `test/e2e/review.spec.ts`, `app/globals.css` if needed. Create `app/components/AiOpinion.tsx`.

**Interfaces — Consumes:** `addSecondOpinions`, `groqJson`, `Config.groqApiKey/groqModel`. **Produces:** `PipelineDeps.secondOpinion?: (drafts: ProposalDraft[], ctx: { locations: Location[]; accounts: Account[] }) => Promise<void>` called after `classify`, before `upsertDrafts`; if it throws, the run continues without opinions.

- [ ] Pipeline tests: hook receives drafts + locations + accounts and its annotations are stored in evidence; a throwing hook does not fail the run; fingerprints identical with and without the hook.
- [ ] `scripts/pipeline.ts`: build `ask` from `groqJson` when `cfg.groqApiKey` is set, else `ask: null`; print a one-line count of opinions by status.
- [ ] `AiOpinion` component: `<section aria-labelledby>` heading "AI second opinion (advisory)"; line "Advisory only. It never changes this suggestion or what gets written."; for `ok` show verdict label (Likely the same place / Probably different / Not sure), match label, reason via `Src`, model in small text; `none`/`unavailable` show the why. Render only when `evidence.aiOpinion` exists.
- [ ] Boundary test: files under `app/` and `src/apply/` must not import `src/ai` (`@/ai`, `@/ai/...`, relative).
- [ ] e2e: global-setup passes a fake `secondOpinion` hook (no network) that sets an `ok` opinion on create drafts; spec opens a create proposal and asserts the heading and verdict text, and that a reparent proposal has no such heading.
- [ ] Vitest + e2e + typecheck + lint green; commit `feat(ai): pipeline hook and advisory box in review app`.

### Task 4: Docs

**Files:** Modify `README.md`, `.env.example`, `.github/workflows/daily-sync.yml`, `CLAUDE.md` (one line).

- [ ] README: short "AI second opinion (advisory)" section — what it does, where it runs, why it can't change writes, how to enable (`GROQ_API_KEY`), cache, what data is sent (no notes), cost/rate note. `.env.example`: `GROQ_API_KEY=` and `GROQ_MODEL=` with comments. Workflow env: `GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}`. CLAUDE.md: "LLM output is advisory evidence only; never feed it into steps/fingerprints."
- [ ] Commit `docs: AI second opinion`.

## After the build
- Re-run the demo environment and confirm the box on Batavia / Union Square / Alliance with a real Groq call (local fake CRM only).
- Update the demo script with an AI-second-opinion beat; re-voice, re-record, compose with captions.
