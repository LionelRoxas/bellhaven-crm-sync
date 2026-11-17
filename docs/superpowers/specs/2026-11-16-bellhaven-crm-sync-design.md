# Bellhaven CRM Sync: design

Status: Approved 2026-11-16

## Intent

LTC facilities change owners constantly, and each change can silently break the facility → parent link in the CRM. Sales depends on that link (corporate sign-off, outreach through the corporate office). This system keeps Bellhaven Senior Living's ownership picture accurate: every day it compares Bellhaven's public community directory with the CRM, proposes corrections with evidence, and writes only what a human reviewer approves.

It is a take-home exercise (brief: `docs/assignment.md`) graded on two things: the **end state of the CRM copy** and the **soundness of the system** that produced it. Expected effort is ~2 focused hours, and a fast, sound submission beats a long, perfect one. The candidate (Lionel) will demo it live for 45 minutes and make a small change to it on the spot, so the code must be easy to find your way around and edit.

## Users and flows

- **Reviewer** (Lionel; in production, a sales-ops analyst). Opens the local review app, works through the queue, approves or rejects each proposal, and checks the result in the CRM browser.
- **Scheduler** (cron). Runs the pipeline daily with no human present. It only ever *proposes*; it never writes to the CRM.

Flow:
1. `npm run pipeline` scrapes the site, loads the CRM, matches, classifies, and upserts proposals into SQLite. It prints a summary: new, unchanged pending, suppressed (already decided), superseded.
2. The reviewer opens `http://localhost:3000`, filters by type, opens a proposal, reads the evidence, and clicks Approve or Reject, optionally with a comment.
3. Approve runs that proposal's CRM writes immediately and shows each API call's result. On failure, the proposal shows `failed` with the error and can be retried. Already-completed steps aren't repeated.
4. The reviewer clicks the account link through to the CRM browser to confirm the change landed.
5. The next pipeline run doesn't re-propose anything already approved or rejected.

## Screens

1. **Queue** (`/`): counts by type and status at the top (pending / approved / rejected / failed), filter chips by type, and a list of proposal rows: type badge, facility name, city/state, a one-line summary ("Move to Bellhaven: create new account (CHOW)"), confidence, status. Also shows the last pipeline run time and a snapshot count (35 locations, 121 accounts).
2. **Proposal detail** (`/proposals/[id]`):
   - **Evidence:** website facts (with a link to the community page) side by side with each CRM account involved (with links to the CRM browser), with differing fields highlighted, plus the match reasons ("street number + street + zip equal; name similarity 0.62").
   - **Planned writes:** the exact API calls, in order, as a readable list (`PATCH 001… parent_id: Cedar Trail → Bellhaven`).
   - **SOP check box** for re-parent proposals: revenue, AR, and which branch of the SOP applies.
   - Approve / Reject buttons with an optional comment, and after a decision the execution log with each call's status.
3. **Run history** is a small section on the Queue page, not its own screen (my call; keeps scope down).

## What the pipeline detects (classification)

Matching is **address-first**, because names lie: renamed facilities keep their address, and lookalike names exist elsewhere. Address key = normalized street number + normalized street name (suffix/direction abbreviations unified: Road→rd, Avenue→ave, West→w, Northwest→nw, Pike/Pk, etc.) + 5-digit zip. Fallbacks, in order: number + street + city/state when the zip disagrees; normalized name + city/state when the CRM street is a PO box or empty. Every candidate gets a score and reasons. Phone is weak supporting evidence only (CRM phones are unreliable in this data).

All 121 accounts are candidates, not just Bellhaven-tagged ones: ownership errors hide under other parents.

Proposal types:

| Type | When | CRM writes |
|---|---|---|
| `confirmed` | One account matches, already under Bellhaven, nothing to fix | none (informational, not in the queue by default) |
| `update_fields` | Match under Bellhaven but name/address/zip/care type is outdated | PATCH changed fields |
| `reparent` | Match under another parent (or none), SOP says move directly (revenue = 0 or AR = 0) | PATCH `parent_id` → Bellhaven, plus any field updates |
| `chow` | Match under another parent with revenue > 0 AND AR > 0 | POST new account under Bellhaven with website data; PATCH old account `chow_current_account` = new id. The old account is otherwise untouched. |
| `duplicate` | 2+ accounts match one location | Choose a survivor; each loser: PATCH `duplicate_of_account` = survivor, `status` = Inactive, `note` explaining. Same proposal also carries the survivor's reparent/CHOW/field fixes (see "one proposal per location"). |
| `create` | Location with no matching account | POST new account under Bellhaven |
| `stale` | Account under Bellhaven with no website location | PATCH `status` = Needs Review, `note` explaining (parent left as is) |
| `ambiguous` | Weak/conflicting match (e.g. same zip, different street; name match in another state) | none; shows the evidence so the reviewer can see why it wasn't linked. It is never auto-linked. |

### Calls I made (correct me)

- **Survivor choice for duplicates:** prefer the account with billing history; then one already under Bellhaven; then the closest name to the website; then the oldest id. Revenue history is the strongest reason to keep a record.
- **Duplicate + parent move:** the survivor gets the parent fix. Losers keep their old parent; they become Inactive + `duplicate_of_account`. If a loser had revenue > 0 and AR > 0, the SOP's spirit (billing needs it preserved) still holds: we only set the duplicate pointer, status and note, never the parent. In the current data no loser has AR.
- **Stale accounts** (Alliance, Coldwater, Sandusky): `Needs Review` + note, parent unchanged. We don't know the new owner, and removing the parent destroys information; Inactive would wrongly imply the facility closed.
- **Names:** the CRM name becomes the website name. Whitespace and ampersand-only differences don't count as changes.
- **Addresses:** propose a street change only when it's a real change (PO box → street, different number/street) or the zip/city differs, not for abbreviation differences ("Rd" vs "Road").
- **Care type:** map website offerings to the CRM picklist (Short-Term Rehabilitation & Nursing → Skilled Nursing; Memory Support → Memory Care; Assisted Living → Assisted Living). If the CRM value is any of the location's offerings, leave it; otherwise set the first offering's mapping. Multi-offering locations get the full list in the note.
- **Phone:** evidence only, never updated (out of the brief's field list, and CRM phones disagree widely).
- **New accounts** (create and CHOW): name, street, city, state, zip, care type, parent = Bellhaven, status Active, a note citing the source page and run date.
- **Notes** are written in a fixed format: `[bellhaven-sync YYYY-MM-DD] <reason>`. Existing note text is kept and the new line is appended.
- **One proposal per website location** (bundling every write for that facility: survivor fixes, duplicate losers, CHOW), plus one per stale account. Approved or rejected as a whole; no per-field approval. This removes ordering problems between dependent proposals (a duplicate approved while its survivor's reparent is rejected). The proposal's type is its most significant action (chow > duplicate > reparent > update_fields), and its writes list shows everything.
- **Duplicate losers point at the survivor** as it exists before any CHOW. If the survivor itself is a CHOW old account, the chain loser → survivor → `chow_current_account` → new account stays traceable. (No current case.)
- **Matching requires the state to agree.** Zip implies state; a same-name or same-street-number account in another state is evidence for `ambiguous` at most (Amberly Manor CO, Carlisle PA vs New Carlisle OH).
- **Care type blank or outside the location's offerings** (e.g. Independent Living) → set to the first offering's mapping. The website is the source of truth.
- **Confirmed** locations appear under a "Confirmed, no change" filter on the queue, outside the pending count, so the reviewer can see every location was accounted for.

## Re-run safety

- Each proposal has a **fingerprint** = hash(type, involved account ids / website slug, the target values of its writes). The pipeline upserts by fingerprint: an existing pending proposal is refreshed (evidence updated), not duplicated.
- If the fingerprint was **approved or rejected** before, it isn't re-proposed (counted as suppressed).
- If the facts change (the website shows a new name, the CRM is edited by someone else), the fingerprint changes, so a new proposal appears. Older pending proposals whose fingerprint wasn't produced this run are marked `superseded` and leave the queue.
- After an approval lands, the next run sees the corrected CRM and naturally produces no proposal. Created accounts are found as matches.
- **Apply is idempotent per step:** each planned write is a step with its own status. A CHOW whose POST succeeded but whose PATCH failed resumes at the PATCH on retry, using the stored new id, never creating a second account.
- **Before writing, the app re-reads the involved accounts** and compares the specific fields the proposal's writes touch (and `parent_id`, `status`) with the snapshot stored in the proposal. If any differ, it refuses with "CRM changed since proposal; re-run pipeline". `updated_at` is not used: every write bumps it, including our own earlier steps.
- **Lost POST responses:** before a create step's POST, the app searches `GET /accounts?street=…` for an account with `created_by_candidate = true` at that address whose note carries this proposal's id marker. If found, it records that id instead of creating a second account.

## Scheduling

A daily crontab entry on the machine hosting the review app (the SQLite file lives there): `0 6 * * * cd /path/bellhaven-crm-sync && npm run pipeline >> logs/pipeline.log 2>&1`. A GitHub Actions workflow is also included as a reference, with a comment that it would need a shared database (e.g. hosted Postgres) instead of local SQLite to be useful. My call: cron is the honest choice for a local SQLite design.

## Goals

- A correct end state for the sandbox CRM: every website location linked under Bellhaven, duplicates pointed at survivors, SOP-compliant CHOWs, stale accounts flagged.
- Every write traceable to an approved proposal with its evidence and an API log.
- Re-runs that are provably safe (a test runs the pipeline twice and asserts no new proposals).
- Code a reviewer can change live: matching rules and thresholds in one readable module, with the proposal types as a single list.

## Non-goals

- LLM calls in the pipeline (not needed; deterministic rules are explainable).
- Auth, multi-user review, hosting.
- Contacts, phones, administrators.
- Generic operators other than Bellhaven (the parent account id and site URL are config, but no multi-operator UI).

## Anti-goals (failure even if it "works")

- Any CRM write without an approval click.
- Re-parenting an account with revenue > 0 and AR > 0.
- Linking a lookalike by name (Amberly Manor, Colorado; Union Square Senior Living, different street).
- A queue left unapproved at submission time.
- Over-building past ~2 hours of effort.

## Constraints

- TypeScript; Next.js app in this repo (the installed version has breaking changes, so read `node_modules/next/dist/docs/` before writing Next code); SQLite via Node's built-in `node:sqlite` (Node 24 is installed).
- The token is read from `.env.local` (`CRM_TOKEN`, `CRM_API_BASE`); never committed or logged.
- The website directory paginates with a "Page N / M" label, and pages past M repeat the last page. The scraper reads M and also collects community links from the home page (Bellhaven Meadows of Findlay is only linked there).
- API: `GET/POST /accounts`, `GET/PATCH /accounts/{id}`; accounts list is paginated (`page`, `page_size`; filters `q`, `city`, `state`, `zip`, `street`, `parent_id`), 121 accounts. Verified by probing the sandbox on 2026-11-16 (the OpenAPI file has no body schemas): write fields have the same names as read fields; PATCH is a partial update returning `{account_id, message, fields}`; mutable fields are name, parent_id, status, note, care_type, phone, billing_street/city/state/zip, chow_current_account, duplicate_of_account; POST requires `name`; `status` must be Active | Inactive | Needs Review; an unknown `parent_id` is rejected; errors come back as `{detail}`; every write bumps `updated_at`; created accounts carry `created_by_candidate = true`.

## Approaches considered

1. **Next.js app + standalone pipeline script + node:sqlite** (picked by Lionel). One app for review screens and approve actions; the pipeline runs without the web server, so cron doesn't need the app running. Familiar framework for the live change.
2. **Lean Node server (Hono) + one page.** Fewer files, but plainer screens and an unfamiliar framework for the live edit.
3. **JSON files, no database.** Fewest parts, but the decision memory and per-step apply log become fragile, which is exactly what reviewers probe.

## Left to the builder

- Exact normalization tables and scoring weights (they must handle every case in the recon list below, and be tested against a fixture snapshot of the real data).
- Visual design (frontend-design pass recorded in the architecture doc).
- File layout and test framework.

## Recon: expected outcomes on today's data

These are cases from the live sandbox (2026-11-16) that the fixture tests should pin:

- Address-only matches with a different name: Bellhaven Willow Creek ↔ "Sunny Acres Retirement Home" (Portage); Bellhaven of Chagrin Falls ↔ "Riverbend Manor Care Center"; Bellhaven of Chesterton ↔ "Chesterton Senior Commons"; Bellhaven of Kettering ↔ two accounts under Harborview and Cedar Trail.
- Duplicates: Monroe (3: Bellhaven, Cedar Trail, Harborview), Erie (Bellhaven + Harborview), Port Clinton (Bellhaven + Harborview), Kettering (Harborview + Cedar Trail), Owosso (2 under Bellhaven).
- CHOW (revenue > 0 and AR > 0, under Cedar Trail): Tiffin, Marietta.
- Direct reparent: Lima (Harborview, AR 0), Zanesville (Cedar Trail, revenue 0, also a rename), Findlay (no parent, AR 0), Kettering survivor.
- Field fixes: Ashtabula (PO box → 3156 W Prospect Rd), Portsmouth (zip 45626 → 45662), name changes (Grove City, Ashland, Arbors Dayton, Sycamore Ridge).
- No CRM account: Batavia, Union Square (New Albany), Carlisle PA, Amberly Manor (Hudson).
- Lookalikes that must not match: Amberly Manor (Colorado Springs), Union Square Senior Living (240 Market St, New Albany).
- Stale under Bellhaven: Alliance, Coldwater, Sandusky (Sandusky has AR, so the note mentions billing).
