---
name: portal-renderer
description: Builds the mobile-first HTML portal from the normalized data layer. Produces a single self-contained, hostable index.html with embedded offline-fallback data.
---

# portal-renderer

Turns the `data/*.json` layer into the portal the PM opens every morning.

## Design (from the interview)
- **Native-app feel:** bottom tab bar (Today · Projects · Payments · Changes · Email), swipe left/right between tabs, pull-to-refresh.
- **Landing screen:** cross-project **Today** view (default).
- **Mobile-first:** ≤640px column, 44px+ tap targets, no horizontal scroll, safe-area insets, light + dark via `prefers-color-scheme`.
- **Access:** private URL, no login.
- **Health colors:** 🟢/🟡/🔴 left border + badge.
- **Offline fallback:** the latest `data/projects.json` is inlined into the HTML; when served with `data/projects.json` alongside, pull-to-refresh live-fetches it.

## Build
```bash
node skills/portal-renderer/build.mjs   # inlines data/projects.json into portal/index.html
```
The markup/CSS/JS live in `portal/index.html`; `build.mjs` only refreshes the embedded
data between the `<!--APM_DATA_START-->` / `<!--APM_DATA_END-->` markers. Edit design in
the HTML, edit data upstream (aggregator) then rebuild.

## Views
- **Today** — action items grouped by category: Payments & Billing (milestones needing
  action), Client Communication, Procurement, Site Tasks (overdue/due-today). Empty states
  where there's nothing to do.
- **Projects** — one card per project: health badge, outstanding, contract, open to-dos,
  next-milestone pill. Tap → detail.
- **Project detail** — financials, next milestone (with "bill the client" prompt when
  overdue), team. Placeholders for to-dos / emails / change orders until those skills land.
- **Payments / Changes / Email** — stubbed with what each will contain (next skills).

## Add-task (manual to-dos)
The Today tab has an **"+ Add task"** button. Because the portal is read-only to the HUB,
manual tasks are stored **client-side in `localStorage`** (`apm_manual_todos`) — not written
back to the HUB. They're merged into the Today categories with the same urgency logic
(overdue/2-day/3-day/soon/later), tagged "added", and cleared with the ✓ complete button.
Fields: title, project (optional), category, due date.

## Verified
Rendered in headless Chromium at 390×844 (light + dark), no console errors, against the
7 live projects. Portfolio header shows $678,281 outstanding · 6 red / 1 yellow / 0 green.

## Hosting
Single file — deploy `portal/` to Netlify (static). Put `data/projects.json` at
`/(data/projects.json)` alongside for live refresh; otherwise the embedded snapshot serves.
