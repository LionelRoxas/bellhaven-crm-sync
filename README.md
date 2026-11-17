# Bellhaven CRM sync

A daily job compares Bellhaven Senior Living's public community directory with the CRM and turns every difference into a proposal with its evidence. A local review app shows the queue. Nothing is written to the CRM until a reviewer clicks Approve on a proposal, and a re-run never re-proposes something already decided.

Matching is address-first and deterministic (no LLM). The pipeline can only read the CRM; the one code path that writes is the approve action in the review app.

## How to run

Node 24 (the app uses the built-in `node:sqlite`).

```
cp .env.example .env.local     # fill in CRM_API_BASE and CRM_TOKEN
npm install
npm run pipeline               # scrape, match, write proposals to data/sync.db
npm run dev                    # review app at http://127.0.0.1:3000
```

`CRM_BROWSER_URL` is optional. If you set it in `.env.local`, the app header shows an "Open CRM browser" link. The real browser URL contains the token, so it only ever lives in your local env file; the app refuses to render a link that contains `CRM_TOKEN`.

Other settings, all optional: `SITE_BASE`, `BELLHAVEN_PARENT_NAME` (default `Bellhaven Senior Living (Parent Account)`), `DB_PATH` (default `data/sync.db`).

| Command | What it does |
|---|---|
| `npm run pipeline` | One run: scrape, load every CRM account, classify, upsert proposals. Read-only toward the CRM. |
| `npm run dev` | The review app, bound to 127.0.0.1. |
| `npm test` | Vitest: normalization, matching, classification against saved fixtures, pipeline re-runs, apply against a fake CRM. |
| `npm run e2e` | Playwright: approve and reject through the real UI against a fake CRM server. |
| `npm run typecheck` | `next typegen` then `tsc --noEmit`. |

## Today's outcome on the sandbox data

The pipeline found 35 locations on the website and 121 CRM accounts, and produced 26 proposals plus 12 informational "confirmed" rows (locations that already match and need nothing).

| Type | Count | Notable cases |
|---|---|---|
| `create` | 4 | Batavia, Carlisle PA, Union Square (New Albany) and Amberly Manor (Hudson) have no CRM account |
| `chow` | 2 | Tiffin and Marietta: under Cedar Trail with revenue and AR, so a new account is created |
| `reparent` | 3 | Lima, Zanesville (also a rename), Findlay |
| `duplicate` | 5 | Kettering (3 accounts at one address), Monroe (3), Erie, Port Clinton, Owosso |
| `update_fields` | 9 | Ashtabula (PO box to street), Portsmouth (zip), renames such as Grove City, Ashland, Sycamore Ridge |
| `stale` | 2 | Alliance and Coldwater: under Bellhaven, no longer on the website |
| `sold` | 1 | Sandusky, now Millstone Care of Sandusky |
| `confirmed` | 12 | Informational, not in the approval queue |

Two lookalikes are deliberately not linked: Amberly Manor in Colorado Springs (same name as the Hudson, OH location, different state) and Union Square Senior Living at 240 Market St (same zip as the New Albany location, different street). Both locations become `create` proposals, with the lookalike listed under "Not linked, and why" so the reviewer can overrule.

These counts are pinned by `test/classify.test.ts` against fixtures saved from the sandbox on 2026-11-16.

## How matching works

Names lie: renamed facilities keep their address, and lookalike names exist elsewhere. So the link between a website location and a CRM account is the address (`src/sync/match.ts`). All 121 accounts are candidates, not only the ones under Bellhaven, because ownership errors hide under other parents.

An account is a **strong** match when the state agrees and one of these holds:

1. Same normalized street and same zip.
2. Same normalized street and same city (the zip differs).
3. The CRM street is a PO box or empty, and the name is the same (or at least 0.8 similar by token overlap) with the same city.

Street normalization (`src/sync/normalize.ts`) unifies suffixes and directions (Road/Rd, West/W, Pike/Pk), treats only the last street token as a suffix (so "45 St Lawrence Dr" keeps St as Saint), and recognizes a trailing direction ("199 Barks Road West"). HTML entities and control characters are cleaned first.

A **weak** candidate is same zip with a different street, or same name in a different state. Weak candidates are shown as evidence and never linked. Phone numbers are not used: CRM phones disagree widely in this data.

Accounts already marked `duplicate_of_account` or `chow_current_account` are excluded from matching, so an applied fix doesn't come back as a new finding the next day.

## Proposal types and the CRM writes they make

There is one proposal per website location, bundling every write for that facility, plus one per Bellhaven account that no location matches. A proposal is approved or rejected as a whole. That avoids ordering problems, like a duplicate approved while its survivor's re-parent was rejected. The proposal's type is its most significant action: `chow`, then `duplicate`, then `reparent`, then `update_fields`.

| Type | When | Writes |
|---|---|---|
| `confirmed` | One account matches, is under Bellhaven, nothing differs | none |
| `update_fields` | Match under Bellhaven with an outdated name, address, zip or care type | PATCH the changed fields |
| `reparent` | Match under another parent or none, and revenue = 0 or AR = 0 | PATCH `parent_id` to Bellhaven, plus any field fixes |
| `chow` | Match under another parent with revenue > 0 and AR > 0 | POST a new account under Bellhaven from the website data, then PATCH the old account's `chow_current_account` to the new id. Nothing else on the old account changes. If a matching account already exists under Bellhaven (for example a CHOW whose POST landed but whose PATCH did not), there is no POST: the only write is the PATCH linking the old account to that existing account, which is not treated as a duplicate. |
| `duplicate` | Two or more accounts match one location | Pick a survivor. Each loser gets `duplicate_of_account` = survivor, `status` = Inactive and a note. The survivor gets its own parent or field fixes in the same proposal. |
| `create` | No strong match | POST a new Bellhaven account |
| `stale` | Under Bellhaven, not Inactive, not on the website, no other account at its address | PATCH `status` = Needs Review and a note; parent left as is |
| `sold` | Under Bellhaven, not Inactive, not on the website, another operator's account at the same address | SOP applies, see below |

Field rules: the website is the source of truth for names, but whitespace and ampersand-only differences don't count as a change. A street is only proposed when it's a real change (PO box to street, different number or street name), not for "Rd" versus "Road". Care type maps website offerings to the CRM picklist (`CARE_MAP` in `src/sync/rules.ts`); if the CRM value is any of the location's offerings it is kept, otherwise it is set to the first offering's mapping.

New accounts (`create` and `chow`) carry name, street, city, state, zip, care type, parent = Bellhaven and status Active.

Every note the app writes has the form `[bellhaven-sync YYYY-MM-DD p_xxxxxx] <reason>` and is appended to the existing note, which is kept verbatim. The line is built when the proposal is applied, so it never affects the fingerprint.

## SOP handling (Tiffin, Marietta, Sandusky)

Before an account moves to a different parent, the code checks `lifetime_revenue` and `outstanding_ar` (`sopBranch` in `src/sync/rules.ts`). Revenue > 0 and AR > 0 means the old account is not changed. A new account is created under Bellhaven, and the old account's `chow_current_account` points to it. Otherwise the existing account is re-parented directly. Every re-parent and CHOW proposal shows the revenue, the AR and the branch taken in an SOP check box.

Revenue and AR are not part of the proposal's snapshot, so the branch is checked again at write time, on the freshly re-read accounts. A step that sets `parent_id` is refused if the account now meets the CHOW rule, and a `chow` or `sold` step that sets `chow_current_account` is refused if it no longer does: "Billing data changed (revenue/AR); the SOP now applies differently. Run the pipeline again." Nothing is written, and the proposal is handled like any other CRM change (below).

- **Tiffin and Marietta** have both revenue and AR and sit under Cedar Trail, so each is a `chow`: POST the new account, then PATCH the old one's `chow_current_account`.
- **Sandusky** is the sold case. The Bellhaven account has revenue 130,000 and AR 5,200, and the website no longer lists it. Another operator's account, Millstone Care of Sandusky, is at the same address under Millstone Health Partners. That account already is "the new account under the correct parent", so the SOP step is just a PATCH of the old account's `chow_current_account` to Millstone's account id. A `sold` account without both revenue and AR would instead be marked `duplicate_of_account` the buyer's account and Inactive.
- Duplicate losers never have their parent changed. They only get the duplicate pointer, status and note. In the current data no loser has AR.

## Duplicates: how the survivor is chosen

`rankSurvivor` in `src/sync/rules.ts` orders the matching accounts by: billing history (revenue > 0) first, then already under Bellhaven, then the closest name to the website, then the lowest account id (ids are random, so this only makes the choice repeatable). Billing history is the strongest reason to keep a record, since billing needs it. The CRM has no merge or delete, so losers are marked Inactive with `duplicate_of_account` set, as the conventions require.

If the survivor itself needs the CHOW branch, the whole proposal is typed `chow`, because that is the most consequential write and should be visible in the queue. The losers point at the survivor, which points at the new account through `chow_current_account`.

## Stale versus sold, and why Needs Review

A Bellhaven account with no website location is either **sold** (another operator's account sits at its address) or **stale** (nothing else is there). For stale accounts we don't know the new owner, and removing the parent would destroy information. Inactive would wrongly say the facility closed. So the proposal sets `status` = Needs Review with a note and leaves the parent alone. A person decides what happened. Alliance and Coldwater are the stale cases today.

## Re-run safety

- **Fingerprints.** Each proposal's fingerprint is a hash of its type, involved account ids, location slug and the method, target and body of every step (`src/store/fingerprint.ts`). Notes and dates are not in it, so the same finding hashes the same every day.
- **Suppression.** If a fingerprint was approved, applied, failed or rejected, it is counted as suppressed and not re-proposed. A pending one is refreshed with current evidence, not duplicated.
- **Held drafts.** A new finding (a fingerprint not stored yet) that involves any account or the location of an `approved` or `failed` proposal is not stored while that proposal is unfinished, and is counted as `held` in the run summary. That proposal may be half-applied, so a second proposal for the same facility could race it; finish or resolve it first and the next run proposes whatever is still needed.
- **Superseding.** If the facts change (the website shows a new name, someone edits the CRM), the fingerprint changes and a new proposal appears. Pending proposals not produced by this run are marked `superseded` and leave the queue. If a superseded finding comes back, it is revived with a fresh snapshot.
- **Exclusions.** Accounts with `duplicate_of_account` or `chow_current_account` set are never matched again, and a stale account already in Needs Review with a sync note is not re-proposed. A test applies every proposal to a fake CRM and re-runs the pipeline to prove nothing comes back.
- **Counts.** The run summary reports created, refreshed, suppressed, superseded and held. "Created" counts every new row, including superseded rows brought back and new `confirmed` info rows. After approvals, fixed locations become newly confirmed, so "created" can be above zero on the next run while pending proposals stay at zero.
- **Short-scrape guard.** The run aborts, writing no proposals, if the scrape finds 0 locations or at most 80% of the last good run's count. A website outage can't flood the queue with stale items.
- **Apply is stepwise and single-owner.** Each planned write is a step with its own status. Before writing, the app re-reads the involved accounts and compares the fields the proposal touches (plus parent and status) with the snapshot stored in the proposal. If anything differs it refuses: "CRM changed since this proposal was made. Run the pipeline again." When none of the proposal's steps has landed yet, it becomes `superseded`, so the next run revives it as pending with a fresh snapshot (or proposes something new if the facts changed); once a step has landed it stays `failed` for a retry. Each step is recorded before the next runs, so a CHOW whose POST succeeded but whose PATCH failed resumes at the PATCH on retry. A per-step claim token stops two runs writing the same step.
- **What stops a second account.** There is no absolute guarantee, since the CRM has no idempotency key, but three things guard against it: a create step whose outcome is unknown is never re-sent automatically; a new finding that touches a failed or approved proposal is held (above); and a CHOW whose Bellhaven account already exists links to that account instead of creating another.
- **Unknown outcomes.** A network error, timeout or 5xx response on a POST may have created the account, so the step is marked `unknown` and is never retried automatically. The reviewer checks the CRM and records "It landed" (with the created account's id) or "It didn't land" in the app, then retries what's left. The app shows the name, address and parent the create step sent, to make the account easy to find, and accepts an id only if that account exists, is not one of the proposal's own accounts, and has the same name, zip and parent as what was sent. A 4xx, or a 5xx on a PATCH, marks the step `failed` and can be retried.

## Outside data is data, not instructions

Everything from the website and the CRM (account names, notes, addresses, page text) is untrusted content.

- The pipeline has no LLM. Classification uses only normalized fields and fixed rules in code. Free text never picks a proposal type, a target account or a write body. Bodies are built from parsed fields, ids and our own note templates; existing notes are carried over verbatim, never interpreted.
- The scraper validates every location (lengths, 2-letter state, 5-digit zip) and fails the run on a bad one rather than silently dropping a facility. Detail-page links must stay on the site's origin.
- The app renders outside text as escaped plain text. Instruction-like text ("ignore previous", "approve all", zero-width characters) adds a flag to the evidence so the reviewer sees it; it changes nothing.
- The app binds to 127.0.0.1, `proxy.ts` returns 403 for any other Host header (blocks DNS rebinding), and Server Actions accept only an id and a comment, never a write body. Steps come only from the database.
- `CLAUDE.md` states the same rule for AI tools used on this repo.
- The CRM token is read only in server-side modules and never logged. A test checks that nothing under `src/sync` or `scripts` imports the write client or the apply code.

## Schedule

`deploy/crontab` runs `npm run pipeline` daily at 06:00 on the machine that hosts the review app, because the SQLite file lives there. It creates `logs/` if needed; cron's PATH usually lacks node and npm, so set PATH at the top of the crontab or use an absolute npm path. A missed or doubled run is harmless for the reasons above. `.github/workflows/daily-sync.yml` is a reference only: it is `workflow_dispatch`-only with the schedule commented out, because a runner would write to a database nobody reviews. It becomes useful once the store is a shared database such as hosted Postgres. `.github/workflows/ci.yml` runs typecheck, unit tests and the e2e spec on every push with no secrets (`CRM_TOKEN=test` against a fake CRM).

Writes can't be rolled back automatically. Each proposal stores the prior values of every account it touches, and the step log records each call, so a manual PATCH can restore them.

## Where to make a change

| Change | File | Pinned by |
|---|---|---|
| Care type mapping (`CARE_MAP`) and how a care type is chosen | `src/sync/rules.ts` | `test/match.test.ts` ("care map and target care type") |
| Duplicate survivor ranking (`rankSurvivor`), SOP branch (`sopBranch`) | `src/sync/rules.ts` | `test/match.test.ts` ("survivor ranking", "SOP branch"); survivors per location in `test/classify.test.ts` |
| Street suffix and direction tables | `src/sync/normalize.ts` (`SUFFIXES`, `DIRECTIONS`) | `test/normalize.test.ts` |
| Match strength rules (strong and weak paths) | `src/sync/match.ts` (`strongPath`, `findCandidates`) | `test/match.test.ts` |
| Which type a location becomes, and the writes | `src/sync/classify.ts` | `test/classify.test.ts` |
| Short-scrape threshold | `src/sync/pipeline.ts` (`isShortScrape`) | `test/pipeline.test.ts` |

## Time spent

TBD by Lionel
