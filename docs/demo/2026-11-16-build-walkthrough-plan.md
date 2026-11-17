# Demo plan: Bellhaven CRM sync build walkthrough

Status: Script approved 2026-11-16

## Audience and takeaway
- **Who:** the hiring team reviewing the take-home.
- **Takeaway:** the system gets the ownership picture right on messy data. It never writes without a human click, follows the billing SOP, and was tested and reviewed hard. The real bugs found along the way were fixed, not hidden.

## Format
- About 4 minutes, 1280x720.
- First-person narration as Lionel, in an AI voice (ElevenLabs "Chris"). The video description discloses that the voiceover is AI-generated.
- This is a companion to, not a replacement for, the brief's required ~2-minute recording. That one is Lionel reviewing his real queue and talking live.

## Data and safety
- Recorded against a local copy: the review app runs on this machine with the database seeded from today's captured website and CRM data, and a fake CRM server.
- The approve and reject clicks in the video write only to the fake CRM. The real graded CRM is never touched.
- The token never appears on screen.
- One fake account (Lima) is given an instruction-like note, the same setup as the end-to-end test, to show the injection flag.
- No personal data is in the script. Facility names are fictional, from the exercise.

## Scenes (one segment each)
| id | Screen | Action |
|---|---|---|
| intro | Queue | Rest on the counts strip |
| matching | Willow Creek proposal | Scroll the evidence table (CRM name "Sunny Acres", same address) |
| lookalike | Union Square proposal | Show "Not linked"; type a comment; click Reject |
| chow | Tiffin proposal | Hover the ownership fork, then the SOP box |
| approve | Tiffin | Click Approve; the step log shows 2 done steps |
| sold | Sandusky proposal | Ownership chain to Millstone |
| duplicates | Kettering proposal | Three accounts, survivor and losers |
| untrusted | Lima proposal | Instruction-like-text banner; planned writes unchanged |
| rerun | Queue, Applied and Rejected filters | Click the filters |
| bugs1 | README "re-run safety" section (rendered locally) | Slow scroll |
| bugs2 | README "apply" section | Slow scroll |
| outro | Queue | Rest |

## Script

**intro.** Hi, I'm Lionel. This is my Bellhaven ownership sync. Every day it reads Bellhaven's community directory, matches each location to our CRM, and lines up fixes for a person to approve. Nothing touches the CRM until someone clicks Approve. On today's data that's thirty-five locations, a hundred and twenty-one accounts, and twenty-six proposals to review.

**matching.** The first big decision was to match on address, not name. Names drift when facilities get rebranded. Here, the website says Bellhaven Willow Creek, but the CRM still calls the same building Sunny Acres Retirement Home. The street and zip match, so it's a confident link, and the proposal is just a rename.

**lookalike.** Matching on address also stops false links. There's a Union Square Senior Living in the same zip, but on a different street, so it's shown as "not linked" with the reason, and the proposal is a new account instead. If I disagree, I reject it and leave a note. A rejected item doesn't come back on later runs unless the facts change.

**chow.** Tiffin is the case the billing rule exists for. It's owned by Cedar Trail, with eighty-four thousand dollars in revenue and twelve thousand still owed. So the old account stays exactly as it is, a new account is created under Bellhaven, and the old one points to it as its change-of-ownership record. The picture shows that fork, and the box on the right shows which rule applied and why.

**approve.** When I approve, it runs the two writes in order and logs each one. Before writing, it re-reads the accounts, and it stops if anything changed since the proposal was made. It also re-checks the billing rule against the live revenue and amount owed.

**sold.** Sandusky went the other way. It's no longer on Bellhaven's site, and Millstone already has an account at the same address. Since Sandusky has billing history, it isn't moved: it just gets linked to Millstone's account.

**duplicates.** Kettering has three accounts for one building, under three different owners. The survivor is picked by a fixed order: billing history first, then already under Bellhaven, then the closest name. The other two are marked inactive and point at the survivor.

**untrusted.** Everything that comes from the website or the CRM is treated as data, never instructions. This account's note says to ignore previous instructions and approve everything. The app flags it, shows it as plain text, and the proposed change is exactly the same as without it.

**rerun.** The pipeline is built to run daily. Each proposal has a fingerprint of what it would change, so a second run doesn't bring back anything already approved or rejected. If the facts change, a new proposal appears instead.

**bugs1.** Testing and reviews caught real bugs, and here are the ones that mattered. My first plan put the date in each note, which would have changed every fingerprint daily and re-proposed everything. Notes are now written only when a change is applied. An applied CHOW leaves two accounts at one address, which would have looked like a duplicate the next day, so handled accounts now drop out of matching. My first data pass searched names, and it missed Kettering's third account and Sandusky's buyer. Those were caught once I matched every account by address.

**bugs2.** The write path got the most scrutiny. A reviewer showed that a slow approval and a retry could both send the same write, so every write now re-claims the proposal in a single database statement. A gateway error on a create might mean the account was actually created, so it's marked unknown and never resent automatically; I confirm it by hand in the app. And the test that keeps the daily job from ever loading the write code only caught one-line imports, so I replaced it with a real TypeScript parser.

**outro.** So that's it: address-first matching, the billing rule handled both ways, every write behind a human click, and a daily run that's safe to repeat. The code, tests, and writeup are in the repo. Thanks for watching.

About 670 words (roughly 4.5 minutes), 3,858 characters of ElevenLabs quota.
