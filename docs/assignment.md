# Assignment: Bellhaven CRM ownership sync

Source: take-home brief (pasted 2026-11-16). Expected effort ~2 focused hours; record actual time honestly.

## Links
- Website: https://analyst-assessment-production.up.railway.app
- CRM API base: https://analyst-assessment-production.up.railway.app/api/v1
- API docs: https://analyst-assessment-production.up.railway.app/api/docs
- CRM browser (read only): https://analyst-assessment-production.up.railway.app/crm/<token>/accounts
- Token: personal sandbox token, stored in `.env.local` as `CRM_TOKEN` (not committed). Sent as `Authorization: Bearer`.

## Build
1. Scraper: every Bellhaven location from the website (name, address, city, state, zip, care offerings).
2. Matching + classification of each location vs CRM accounts. At least: confident match; match needing a fix (wrong parent, outdated name); location with no CRM account; CRM accounts under Bellhaven parent no longer on the website.
3. Local review app: each proposed change with evidence; approve/reject. Approved changes write to the CRM via API. Nothing writes without approval.
4. Daily schedule config (cron or GitHub Actions, need not be live). Re-runs safe: a second run must not re-propose already-decided items.

## CRM conventions
- `parent_id` links facility to parent account.
- `status`: Active | Inactive | Needs Review. Free-text `note`.
- No merge/delete. Duplicate: set `duplicate_of_account` on the losing copy to the survivor's id and mark it Inactive. Explain choices in the writeup.

## SOP (must follow) — re-parenting
Before moving an account to a different parent, check `lifetime_revenue` and `outstanding_ar`:
- revenue > 0 AND AR > 0 → do NOT change the old account. Create a new account for the facility under the correct parent; set `chow_current_account` on the OLD account to the new account's id.
- otherwise → re-parent the existing account directly.

## Deliverables
- [ ] Code (scraper, matcher, review app, schedule config)
- [ ] Pipeline actually run; proposals reviewed and approved so the CRM copy is corrected (end state is graded)
- [ ] Writeup explaining choices (duplicates, stale accounts, SOP handling)
- [ ] ~2 min screen recording, user narrating live: a few proposals with evidence, approve one, reject one, show the change in the CRM browser. Shared "anyone with link". Link pasted in form.
- [ ] Honest time spent
- Live 45-min walkthrough later, including a small live change to the system.

## Ground rules
Any AI tools allowed; no paid keys needed; no LLM required in pipeline. Nothing hosted.
