---
name: email-consolidator
description: Fetches and maps Outlook emails to projects (by street address), producing per-project thread views, and backfills client name/email into projects.json.
---

# email-consolidator

Fifth skill. Produces `data/emails.json` (the portal's **Email** tab) and backfills the
`client` on each project card.

## What it does
1. For each project, `outlook_email_search` with a distinctive address string
   (e.g. `"75 East End"`, `"535 East 86th"` — street number + street disambiguates
   the two East 86th projects). The runner assembles the results into
   `data/raw/emails-snapshot.json`, collapsing automated HUB/QuickBooks notices.
2. `consolidate.mjs` (pure transform) maps each message to a **readable sender + role**
   (client / team / you / vendor / sub / system), flags **recent** (≤48h) and **unread**,
   sorts newest-first, and counts unread/recent per project.
3. Backfills **client name + email** into `data/projects.json` (derived from the client's
   messages) so Projects cards and the detail view show the client.

```bash
node skills/email-consolidator/consolidate.mjs --ref $(date +%F)
# → data/emails.json  (+ updates data/projects.json client fields)
```

## Matching + fields
- Match signal: project **street address** in subject/body (client name + email refine it).
- Each email → `{ from, role, subject, snippet, date, attach, read, recent, webLink }`.
- `webLink` opens the message directly in **Outlook on the web** (tap a thread row).

## Verified (live, 2026-07-14)
7 project inboxes, 18 emails. Clients backfilled on 5 projects — Nicholas Stoker
(75 East End), Ryan White (401 E 86th), Rachel Park (177 E 79th), Dean Schloyer
(535 E 86th), Jorge & Shannon (1025 Fifth). 333 E 43rd and 330 E 79th had no clearly
identifiable client in-thread (left blank rather than guessed).

## Notes
- Read/unread reflects the mailbox at fetch time.
- Future (from the SOP prompt): tag emails by type (change order / payment / RFI / general).
- No sending here — see `email-drafter`. External email is draft-only (§2 of ARCHITECTURE.md).
