# Chapter PM Assistant Portal — Architecture Plan

**Status:** Awaiting approval (planning phase — no application code written yet)
**Prepared for:** Sagar P. (`sagar.p@hellochapter.com`)
**Source docs:** Chapter PM SOP + HUB Workflow Guide v2.0 (90 pp) · Claude Code Planning Prompt
**Date:** 2026‑07‑14

---

## 1. Confirmed decisions (interview)

| # | Topic | Decision |
|---|-------|----------|
| A1 | Active projects | **5–10** at a time (light lazy-loading; no heavy pagination) |
| A2 | Subcontractor data | **Not in the HUB.** You provide the sub list + payment schedules at build time → maintained in a data file |
| A3 | Payment source of truth | **Clients → HUB Invoices tab (live).** **Subs → QuickBooks, but no access** → sub reminders are schedule/due‑date driven from the data file |
| A4 | Write scope | **Read + email‑send only.** No writes back to the HUB. HUB stays the system of record |
| C1 | Client email CC | **No fixed default** — per‑email CC field, filled before sending |
| C2 | Weekly update format | **Clean plain‑text** email |
| C3 | Signature | **You will paste your exact signature block** (pending) |
| C4 | Self‑alert CC | **You only** — no supervisor/super CC |
| D1 | App feel | **Native‑app feel** — bottom tab bar, swipe gestures, pull‑to‑refresh |
| D2 | Access | **Private unguessable URL** — no login/passcode |
| D3 | Mobile landing | **Cross‑project "Today" view** is the default screen |
| D4 | Notifications | **Email alerts only** — no push/PWA notifications required |
| E1 | Daily reset | **11:00 PM** (recompute the day's to‑dos overnight) |
| E2 | Friday update | **Auto‑generate** drafts every Friday (still preview‑before‑send) |
| E3 | Health status | 🟢 on track · 🟡 task due ≤2 days or payment pending · 🔴 any overdue item |

---

## 2. Connector reality check ⚠️

What's actually wired up in this environment right now:

| Connector | Status | What we can do |
|-----------|--------|----------------|
| **the HUB by Chapter** (MCP) | ⚠️ **Needs authorization** | The primary data source. Registered but not authorized in this session, so no live HUB calls yet. Must be connected (claude.ai connector settings, or `/mcp` interactively) before we can test any skill against real project data. |
| **Microsoft 365** (MCP) | ✅ Connected — **read/search only** | `outlook_email_search`, `read_resource`, `outlook_calendar_search`, `sharepoint_search`, `sharepoint_folder_search`, `get_me`. **No send/draft tool exists.** |
| **QuickBooks** (MCP) | ✅ Connected | Can read AR/AP aging & invoices, and **can send** invoices / reminders / payment links. Sub‑payment data is **not accessible** to us (per A3), so QB is only relevant to *client* invoicing if we choose to use it. |

### The email‑send gap (decision needed — see §11)
Requirement #4 is "send emails on my behalf via Outlook." The Microsoft 365 MCP **cannot send** — it only reads. Options:

- **Option A (recommended): serverless Graph `sendMail`.** A small hosted function calls the Microsoft Graph `/sendMail` endpoint using your token (you said "I handle credentials — assume tokens are available"). This is independent of the read‑only MCP and gives true "send from my Outlook, appears in my Sent Items" behavior. Preview is rendered in the portal; the function only fires after you click **Send**.
- **Option B: QuickBooks for client‑money emails only.** Milestone invoices / payment reminders / payment links to clients go out through QuickBooks' send tools; everything else (weekly updates, CO notices, task reminders) waits for Option A.
- **Option C: draft‑only.** Portal generates copy‑paste‑ready drafts (subject + body + recipients); you send from Outlook yourself. Zero send infrastructure, zero risk, but one manual step.

My recommendation: **A for general email, with B available for client invoice reminders.** Ship **C as the day‑one fallback** so the portal is useful before send infrastructure is stood up.

---

## 3. System architecture

```
                      ┌───────────────────────────────────────────┐
                      │   SCHEDULED SKILL RUNNER  (Claude Code)     │
                      │   • nightly 11:00 PM  → rebuild to-dos      │
                      │   • Fridays          → weekly update drafts │
                      │   • on-demand refresh (Refresh button)      │
                      └───────────────┬─────────────────────────────┘
                                      │ invokes skills, which call MCP tools
        ┌─────────────────────────────┼──────────────────────────────┐
        │                             │                              │
   ┌────▼─────┐                 ┌─────▼──────┐                 ┌─────▼──────┐
   │ HUB MCP  │                 │ M365 MCP    │                 │ subs.json  │
   │ projects │                 │ Outlook +   │                 │ (manually  │
   │ tasks    │                 │ SharePoint  │                 │ maintained)│
   │ invoices │                 │ (read only) │                 │            │
   │ COs      │                 └─────────────┘                 └────────────┘
   └──────────┘                        │
        └──────────────┬───────────────┘
                       ▼
              ┌──────────────────┐        writes
              │  data/ layer     │◄─────────────── skills normalize everything
              │  • projects.json │                 to one schema (§6)
              │  • today.json    │
              │  • project-*.json│
              │  • drafts.json   │
              └────────┬─────────┘
                       │ consumed by (static fetch + embedded fallback)
                       ▼
         ┌───────────────────────────────────┐
         │   MOBILE-FIRST HTML PORTAL         │
         │   bottom nav · swipe · pull-refresh│
         │   Today · Projects · Payments ·    │
         │   Change Orders · Email            │
         └───────────────┬───────────────────┘
                          │ "Send" click → preview → confirm
                          ▼
              ┌──────────────────────────┐
              │  send function (Option A) │  Graph /sendMail  (or QB for invoices)
              │  ALWAYS preview first     │
              └──────────────────────────┘
```

**Principles carried from the SOP:** HUB is the system of record (we never write to it); discussion‑is‑not‑documentation (every send is logged as a draft record + timestamp); no false alarms (a reminder checks task `Done` status before firing).

---

## 4. Repository structure

```
APM/
├── ARCHITECTURE.md            ← this document
├── SKILLS.md                  ← per-skill documentation (deliverable)
├── RUNBOOK.md                 ← run / refresh / maintain guide (deliverable)
├── README.md
├── config/
│   ├── subs.json              ← subcontractors + payment schedules (you maintain)
│   ├── projects.seed.json     ← project list you give me at kickoff (client, address, emails)
│   ├── templates/             ← email templates (§9)
│   │   ├── weekly-update.txt
│   │   ├── change-order.txt
│   │   ├── milestone-invoice.txt
│   │   └── sub-payment-reminder.txt
│   └── settings.json          ← reset time, thresholds, signature, health rules
├── skills/
│   ├── hub-project-aggregator/
│   ├── daily-todo-generator/
│   ├── task-reminder-engine/
│   ├── payment-tracker/
│   ├── email-consolidator/
│   ├── weekly-update-drafter/
│   ├── email-sender/
│   └── portal-renderer/
├── data/                      ← generated live layer (git-ignored except samples)
│   ├── projects.json
│   ├── today.json
│   ├── project-<id>.json
│   └── drafts.json
├── portal/
│   ├── index.html             ← the app shell (single-page, mobile-first)
│   ├── app.js
│   ├── styles.css
│   └── assets/
└── functions/                 ← serverless (Netlify) — send + on-demand refresh
    ├── send-email.js          ← Option A: Graph /sendMail (preview already shown)
    └── refresh.js
```

---

## 5. The eight skills

Each skill is discrete and composable, reads from the sources noted, and writes normalized JSON into `data/`. MCP tool names for the HUB are marked *TBD* until the connector is authorized and I can inspect its actual tool surface.

| Skill | Reads from | Produces | MCP tools used |
|-------|-----------|----------|----------------|
| **hub-project-aggregator** | HUB | `projects.json` — all active projects normalized (id, name, address, client, phase, tasks, invoices, COs) | HUB: list projects / get project / tasks / invoices / change-orders *(TBD tool names)* |
| **daily-todo-generator** | `projects.json`, `subs.json` | `today.json` + `project-<id>.json` — prioritized tasks grouped by project → category (payments / communication / procurement / site) | none (pure transform) |
| **task-reminder-engine** | HUB task due dates + `Done` status | urgency flags (3‑day / 2‑day / OVERDUE), reminder queue → `drafts.json` | HUB: task status read *(TBD)*; checks `Done` before flagging (no false alarms) |
| **payment-tracker** | HUB (client invoices/milestones/COs) + `subs.json` (sub schedules) | payment flags: sub due ≤5d/today/overdue, milestone ready‑to‑release, CO billing status | HUB: invoices + change-orders read *(TBD)*; QB optional for client reminders |
| **email-consolidator** | Outlook + `projects.seed.json` | per‑project email thread view; matches on client name + email + street address; flags unread/<48h | M365: `outlook_email_search`, `read_resource` |
| **weekly-update-drafter** | HUB notes/timeline (7d) + Outlook (7d) | client‑facing draft (plain‑text) + candid internal version → `drafts.json` | M365: `outlook_email_search`; HUB notes *(TBD)*; Claude for drafting |
| **email-sender** | `drafts.json` | preview → on confirm, sends; logs sent record | **Option A:** Graph `/sendMail` via function · **Option B:** QB `send_invoice`/`send_invoice_reminder`/`send_payment_link` |
| **portal-renderer** | all `data/*.json` | the mobile‑first HTML portal + embedded offline fallback snapshot | none (build step) |

---

## 6. Normalized data schema (`projects.json` excerpt)

```jsonc
{
  "generatedAt": "2026-07-14T23:00:00-04:00",
  "projects": [{
    "id": "proj-123",
    "name": "Park Ave Renovation",
    "address": "123 Park Ave, New York, NY",
    "client": { "name": "Jane Doe", "email": "jane@example.com" },
    "phase": "17 Rough-Ins",
    "health": "yellow",
    "openTodos": 6,
    "nextDueDate": "2026-07-16",
    "tasks": [{ "name":"Electrical rough-in","due":"2026-07-16","status":"open","urgency":"2-day","category":"site","clientVisible":false }],
    "invoices": [{ "title":"Milestone 3 - Rough Complete","amount":42000,"due":"2026-07-20","status":"unreleased","readyToRelease":true }],
    "changeOrders": [{ "no":"CO-003","title":"Relocate island electrical","status":"pending-client","sentDate":"2026-07-09","awaitingDays":5 }]
  }]
}
```

---

## 7. Automation / scheduling

The portal is static; automation runs in the **scheduled skill runner** (Claude Code Routine / cron / Netlify scheduled function):

- **11:00 PM nightly** → run `hub-project-aggregator` → `daily-todo-generator` → `task-reminder-engine` → `payment-tracker`, rebuild `data/*.json`, queue any reminder drafts.
- **Fridays** → additionally run `weekly-update-drafter`; drafts land in the portal's Email tab for review.
- **On‑demand** → Refresh button / pull‑to‑refresh hits `functions/refresh.js`.
- **Nothing auto‑sends.** Reminder + weekly drafts always wait for your **Send** click (per prompt + SOP).

---

## 8. Email templates (I will draft — SOP has none)

The SOP specifies *what* each email must contain but includes no copy. I'll draft these for your approval, wired to your pasted signature (C3) and per‑email CC (C1):

1. **Weekly client update** — progress this week · next 2 weeks · asks of client (plain‑text, C2).
2. **Change‑order notice** — cost / schedule / lead‑time impact summary (SOP A9 requires this in writing).
3. **Milestone invoice / payment request** — milestone unlocked → request.
4. **Sub‑payment reminder (to you)** — sub · amount · project · due · days overdue.
5. **Task escalation (to you)** — project · task · due date · days overdue.

---

## 9. Health logic (confirmed E3)

```
red    = any task overdue OR any invoice/milestone overdue
yellow = (task due within 2 days) OR (payment pending / milestone ready to release)
green  = otherwise
```

---

## 10. Build sequence (skill‑by‑skill, tested against real HUB data)

1. **Authorize the HUB connector** (blocker for everything data‑related).
2. `hub-project-aggregator` → verify against 1 real project, then all.
3. `daily-todo-generator` + `task-reminder-engine` → Today view.
4. `payment-tracker` (clients via HUB, subs via `subs.json`).
5. `email-consolidator` (Outlook matching).
6. `portal-renderer` → mobile shell (Today · Projects · Payments · COs · Email).
7. `weekly-update-drafter`.
8. `email-sender` (per §11 decision).
9. Deliverables: `SKILLS.md`, `RUNBOOK.md`, hostable portal.

---

## 11. Open decisions — I need your call

1. **Email sending (§2):** A (Graph serverless), B (QuickBooks for client invoices only), C (draft‑only), or **A+B with C as fallback** (my recommendation)?
2. **Hosting target:** Netlify (as the prompt suggests) — confirm, or do you have a preferred host?
3. **Scheduler:** for the 11 PM / Friday automation — Netlify scheduled functions, a Claude Code Routine, or GitHub Actions cron? (Affects where the runner lives.)
4. **Kickoff data:** when we start building, I'll need (a) your **project list** (name, address, client name + email), (b) your **subs + payment schedules**, and (c) your **signature block**.
5. **HUB authorization:** please connect the HUB MCP so I can inspect its real tool surface and test skills against live data.
```
