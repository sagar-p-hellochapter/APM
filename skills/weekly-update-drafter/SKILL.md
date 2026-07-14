---
name: weekly-update-drafter
description: Generates a warm client-facing weekly update draft + a candid internal version per project. Produces data/weekly.json for the portal's Weekly Drafts view. Auto-runs Fridays.
---

# weekly-update-drafter

Sixth skill. Produces `data/weekly.json` — surfaced under the Email tab's **Weekly drafts**
segment. Auto-generated every Friday (`settings.dailyResetTime` sibling; E2 decision).

## What it does
The runner synthesizes per-project bullets from **HUB project notes (last 7 days)** +
**recent Outlook** (email-consolidator) + **timeline progress**, into a source snapshot.
`draft.mjs` (pure transform) formats them into:
- **Client draft** — warm, plain-text (SOP A7): greeting → *Progress this week* → *Coming up
  (next 2 weeks)* → *asks of client* → your signature.
- **Internal version** — candid flags: overdue milestones, financial gaps, risks.

```bash
node skills/weekly-update-drafter/draft.mjs
# → data/weekly.json
```

## Signature
Uses `settings.email.signature`; while that's the `<<PENDING>>` placeholder it falls back to
"<pmName>\nProject Manager, Chapter". Paste your real block into `config/settings.json`.

## Review + send (draft-only)
Drafts appear in the portal (Email → Weekly drafts). You review, tap **Copy client draft**,
and send from Outlook. Nothing sends automatically — external email is draft-only
(ARCHITECTURE.md §2). `clientReady` is false when the client email isn't known yet
(333 E 43rd, 330 E 79th) — the card shows **NEEDS EMAIL**.

## Verified (2026-07-14)
6 PM-project drafts (3 client-ready). 1025 Fifth is excluded (Nihaar is PM there).
Client drafts pull real activity: procurement coordination + countertop review (75 East End),
asbestos-cleared (333 E 43rd), PID Floors delivery (401 E 86th), CO approved + paid (177 E 79th).
