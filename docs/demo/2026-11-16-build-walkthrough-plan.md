# Demo plan: Bellhaven CRM sync build walkthrough

Status: Revision 8 (sales ops analyst framing: account hierarchy, revenue and AR terms, fix breakdown, safeguards), approved 2026-11-17

## Audience and takeaway
- **Who:** anyone, including someone with no background in sales, CRMs or senior care, as well as the hiring team.
- **Takeaway:**
  - What problem this solves and why it matters.
  - How the tool decides each fix, and how well it did on real data.
  - How it was made safe, including real bugs found and fixed.
- **Tone:** a sales operations analyst presenting to the sales ops team and hiring panel: business impact first, the field's own terms (account hierarchy, re-parent, lifetime revenue, open AR, CHOW), full natural sentences.

## Format
- **Length:** 3 to 3½ minutes, at 1280x720. Revision 3's 9-minute cut was trimmed because the target is 2 minutes, with 3 at most.
- **Captions:** burned in, plus a transcript (`.srt` and `.md`) delivered alongside the video.
- **Narrator:** first person as Lionel, in an AI voice (ElevenLabs "Chris"). The video description discloses that the voiceover is AI-generated.
- **Role:** a companion to, not a replacement for, the brief's required ~2-minute recording, which is Lionel reviewing his real queue and talking live.

## Data and safety
- The two opening scenes show Bellhaven's public website, read-only.
- Everything else is the real pipeline run against the sandbox CRM (run 1, 2026-11-17). The Approve click on Tiffin is a real write to the graded CRM, made once, with the user's OK.
- The token never appears on screen.

## Scenes (one segment each, so every sentence matches the screen)
| id | Screen | Action |
|---|---|---|
| context1 | Bellhaven website home | Rest, gentle scroll |
| context2 | Community directory | Hover a few cards |
| context3 | Review queue | Hover the counts, then the type filters |
| matching | Willow Creek suggestion | Evidence: hover name, then street |
| ai | Union Square suggestion | Evidence streets, then the "AI second opinion (advisory)" box |
| chow | Tiffin suggestion | Ownership diagram, then the SOP box |
| approve | Tiffin | Hover Reject, then click Approve; step log |
| crm | CRM browser: old Tiffin account, then the new one | Hover parent, revenue, CHOW link; open the new account |
| duplicates | Kettering suggestion | "Why these accounts" (3 accounts), then the planned changes |
| rerun | Queue | Click the Applied, then Rejected filters |
| bugs | One slide: two safeguards, each with its fix | The cursor follows each row as it's narrated |
| future | One slide: time spent, then three next steps | The cursor follows each row as it's narrated |
| outro | Review queue | Rest |

## Script

**context1.** Hi, I'm Lionel. Let me start with the problem. About sixty percent of the long-term care facilities we sell to are owned by a parent company, and those facilities are bought, sold and rebranded all the time. For sales, the parent matters: contracts often need corporate sign-off, and outreach usually goes through the corporate office.

**context2.** In the CRM, that relationship is the account hierarchy, where each facility account points to its parent account. When ownership changes, that link quietly breaks, and reps end up calling the wrong corporate office. Bellhaven's website lists the thirty-five communities it runs today, so I treat it as the source of truth and check it against our hundred and twenty-one accounts.

**context3.** My tool runs that check every day. Each fix becomes a suggestion with its evidence, nothing changes until someone approves it, and anything typed into the CRM is treated as information, never as instructions. On today's data, twelve communities were already correct, and it found twenty-six fixes: three facilities under the wrong parent, four missing accounts, five sets of duplicates, two ownership changes with open billing, nine outdated names or addresses, and three accounts that may no longer be Bellhaven's.

**matching.** The key decision was to match on the address, not the name, because names change with every rebrand and addresses almost never do. Here the CRM still calls this building Sunny Acres, but it's the same address, so the fix is a rename, not a new account.

**ai.** For the cases the address rules can't settle, like Union Square here, an AI model gives a second opinion by comparing it with other accounts in the same city. It agrees this is a different place, because the streets don't match. It's advice for the reviewer only, and it can't change what gets written.

**chow.** Tiffin is where the billing SOP comes in. It needs to move to Bellhaven, but it has eighty-four thousand dollars in lifetime revenue and twelve thousand four hundred in open AR, so billing needs the old account left exactly as it is. Instead of re-parenting it, the tool creates a new account under Bellhaven and sets the old account's CHOW field to point to the new one.

**approve.** Reject sits right here and writes nothing, but every suggestion checked out today, so I won't reject any. When I click Approve, it checks the CRM once more, then makes each change in order and logs it.

**crm.** And here's the change in the CRM itself. The old Tiffin account still sits under Cedar Trail with its sales history, and its CHOW field now points to the new account, which sits under Bellhaven.

**duplicates.** Duplicates split a facility's activity history and lead to double outreach. When one building has several accounts, like Kettering's three, the tool keeps the best one, starting with the account that has revenue history, marks the others inactive, and points them to the one it kept, since the CRM has no merge.


**rerun.** Because it runs daily, it remembers every decision, so anything you've approved or rejected won't come back unless the facts change.

**bugs.** Before anything touched the CRM, our reviews caught problems that would have hurt trust in the data. Two runs could have made the same change twice, so each change is now locked before it's sent. And if the CRM times out while creating an account, it now stops and asks a person instead of risking a duplicate.

**future.** This took us two hours to design, plan and build. With more time, I'd add three things. First, a shared database with sign-in, so the whole sales ops team works from one queue. Second, a daily email of new suggestions, so nothing waits on someone remembering to check. And third, map-based address matching, so different spellings of the same street still line up.

**outro.** So in one run, a messy account hierarchy became twenty-six clear, evidence-backed fixes, with the billing SOP respected and nothing changed without approval. Thanks for watching.
