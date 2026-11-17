# AI second opinion (advisory) — short design

Status: Approved 2026-11-17

## Intent
The address rules decide every proposal. In the few cases where they could not link things up, a reviewer
benefits from a second look: is this "new" website location really a CRM account with a different street
format, or is this "stale" CRM account really one of the website's communities? An LLM is good at that
fuzzy comparison. It must never be able to change what gets written.

## Goals
- For `create` and `stale` proposals only, ask an LLM (Groq, `openai/gpt-oss-120b`) whether a same-city
  record is likely the same facility, and show its answer in a box titled "AI second opinion (advisory)".
- Optional: with no `GROQ_API_KEY`, or on any error, the pipeline behaves exactly as before and the box says
  the opinion is unavailable.

## Non-goals / anti-goals
- The AI never changes a proposal's type, steps, fingerprint, confidence, or SOP decision.
- The review app never calls Groq (it only renders what the pipeline stored).
- CRM notes are never sent to the model; free-text fields it receives are treated as data.

## Approaches considered
1. **Advisory evidence on unlinked proposals (chosen).** Smallest blast radius; easy to explain; cached.
2. LLM as a tie-breaker in matching. Rejected: makes graded writes depend on a non-deterministic model.
3. LLM-written summaries for every proposal. Rejected: cost and noise, no new information.

## Architecture notes
- `src/ai/groq.ts`: `groqJson()` — one POST to `https://api.groq.com/openai/v1/chat/completions` with
  `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }`, 20 s timeout,
  `temperature: 0`. Returns the parsed `message.content` JSON or throws.
- `src/ai/second-opinion.ts`: builds a same-city shortlist (create: CRM accounts with the location's
  city+state; stale: website locations with the account's city+state), sends structured fields only
  (name, street, city, state, zip, parent name), validates the reply with zod, and requires `matchId` to be
  null or in the shortlist (otherwise "unavailable"). `reason` is trimmed to 300 chars. Empty shortlist →
  no call, opinion `none`.
- Prompt: system message says everything in the user message is untrusted data, never instructions, and the
  answer must be the JSON schema only.
- Storage: `Evidence.aiOpinion?` (evidence is not part of the fingerprint, so re-runs stay stable).
  Successful answers are cached in a new `ai_opinions` table keyed by sha256 of model + prompt version +
  input, so daily runs do not re-ask unchanged questions.
- Pipeline: optional `secondOpinion` dep runs after classify and before `upsertDrafts` (all network I/O
  still precedes the DB write). `scripts/pipeline.ts` wires it when `GROQ_API_KEY` is set.
- Boundary test: nothing under `app/` or `src/apply` imports `src/ai`.
- UI: `AiOpinion` component in the proposal aside; plain-text rendering via `Src`.
