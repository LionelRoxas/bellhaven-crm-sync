# Demo plan: Bellhaven CRM sync build walkthrough

Status: Revision 6 draft (adds time spent and next steps; restyled app; about 3:35), approved 2026-11-17

## Audience and takeaway
- **Who:** anyone, including someone with no background in sales, CRMs or senior care, as well as the hiring team.
- **Takeaway:**
  - What problem this solves and why it matters.
  - How the tool decides each fix, and how well it did on real data.
  - How it was made safe, including real bugs found and fixed.
- **Tone:** a senior engineer explaining to a junior, in full, natural sentences, defining each term the first time it appears.

## Format
- **Length:** 3 to 3½ minutes, at 1280x720. Revision 3's 9-minute cut was trimmed because the target is 2 minutes, with 3 at most.
- **Captions:** burned in, plus a transcript (`.srt` and `.md`) delivered alongside the video.
- **Narrator:** first person as Lionel, in an AI voice (ElevenLabs "Chris"). The video description discloses that the voiceover is AI-generated.
- **Role:** a companion to, not a replacement for, the brief's required ~2-minute recording, which is Lionel reviewing his real queue and talking live.

## Data and safety
- The two opening scenes show Bellhaven's public website, read-only.
- Everything else runs against a local copy: a fake CRM seeded with today's captured data. The approve click never touches the graded CRM.
- The token never appears on screen.
- One fake account (Lima) gets a planted instruction-like note. The narration says it is a planted test.

## Scenes (one segment each, so every sentence matches the screen)
| id | Screen | Action |
|---|---|---|
| context1 | Bellhaven website home | Rest, gentle scroll |
| context2 | Community directory | Hover a few cards |
| context3 | Review queue | Hover the counts, then the type filters |
| matching | Willow Creek suggestion | Evidence: hover name, then street |
| ai | Union Square suggestion | Evidence streets, then the "AI second opinion (advisory)" box |
| chow | Tiffin suggestion | Ownership diagram, then the SOP box |
| approve | Tiffin | Click Approve; step log |
| duplicates | Kettering suggestion | "Why these accounts" (3 accounts), then the planned changes |
| untrusted | Lima suggestion | Warning banner, then the flagged note |
| rerun | Queue | Click the Applied, then Rejected filters |
| bugs | One slide: three bugs, each with its fix | The cursor follows each row as it's narrated |
| future | One slide: time spent, then three next steps | The cursor follows each row as it's narrated |
| outro | Review queue | Rest |

## Script

**context1.** Hi, I'm Lionel. Let me start with the problem. Senior living facilities get bought and sold all the time, and many of them belong to a bigger parent company. For a sales team that parent really matters, because contracts often need its approval.

**context2.** Sales teams keep their customers in a database called a CRM, where each facility is an account that points to its parent company. When a facility is sold or renamed, that pointer quietly goes out of date. Bellhaven's website lists the thirty-five communities it runs today, so we treat it as the truth and check it against a hundred and twenty-one CRM accounts.

**context3.** My tool does that check for you every day. It writes up each fix as a suggestion with its evidence, and nothing changes until a person clicks Approve. On today's data, twelve locations were already correct, and it found twenty-six fixes, including missing accounts, old names, wrong parent companies and duplicates.

**matching.** The most important decision was to match on the address instead of the name, because names change all the time and addresses almost never do. Here the CRM still calls this building Sunny Acres, but the address is the same, so the fix is simply a rename.

**ai.** I also added an AI second opinion, but only as advice. When the address rules can't link a community to an account, like Union Square here, the tool asks an AI model to compare it with records in the same city. It agrees these are two different places, because the streets don't match. It can't change the suggestion or what gets written, and it never sees the CRM notes.

**chow.** Tiffin shows the company's billing rule. It needs to move to Bellhaven, but it has past sales and money still owed, so the billing team needs the old account left exactly as it is. Instead of moving it, the tool creates a new account under Bellhaven and links the old account to the new one.

**approve.** When I click Approve, it checks the CRM once more, then makes each change in order and logs it.

**duplicates.** When one building has several accounts, like Kettering's three, the tool keeps one of them using a fixed order of rules, and marks the others inactive with a pointer to the one it kept.

**untrusted.** It also treats anything typed into the CRM as information, never as instructions. I planted a test note here telling it to approve everything, and the tool just flags the note and changes nothing.

**rerun.** Because it runs every day, each suggestion gets a fingerprint, so anything you've already approved or rejected won't come back unless the facts change.

**bugs.** Our reviews also caught real bugs before anything was written. Dates in the notes would have made it re-ask everything daily, so notes are now written only when a change is made. Two runs could have sent the same change twice, so each change is now claimed first. And a timeout could have created an account twice, so that case now waits for a person to confirm.

**future.** This took us two hours to design, plan and build. With more time, I'd add three things. First, a shared database with sign-in, so the whole team works from one queue instead of a file on one laptop. Second, a daily email of new suggestions, so nobody has to remember to check. And third, map-based address matching, so different spellings of the same street still line up without the AI.

**outro.** So in one run, a messy CRM became twenty-six clear fixes, and nothing changed without a click. Thanks for watching.
