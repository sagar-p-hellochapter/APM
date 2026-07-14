---
name: hub-project-aggregator
description: Fetches all active projects from the HUB, joins financials + cross-project task signals, and normalizes them to the portal's standard schema (data/projects.json).
---

# hub-project-aggregator

First skill in the pipeline. Produces `data/projects.json` — the project cards and
portfolio rollup the portal home screen renders.

## What it does

1. **List projects** — `hub_list_projects` (role `pm`) → the PM's active projects
   (`id`, `name`, `dealId`). Optionally also role `designer` for projects the PM
   supports as designer.
2. **Per-project financials** — `hub_get_project_overview` (by `dealId`) → income,
   proposal vs. change-order split, payments received, balance outstanding, and the
   next milestone (label, amount, %, date). Also the stakeholder team.
3. **Cross-project task signals** (one call each, not per project):
   - `hub_get_todo_list` (role `pm`) → Overdue / Today / 7-Days tabs.
   - `hub_get_user_overdue_tasks` (personUserId = PM) → overdue count per project.
4. **Normalize** — write the raw responses into `data/raw/hub-snapshot.json`, then
   run `normalize.mjs` to emit `data/projects.json`.

## Running it

The MCP calls are made by the skill runner (an interactive session or the scheduled
Routine). Assemble the responses into `data/raw/hub-snapshot.json` (see the committed
example), then:

```bash
node skills/hub-project-aggregator/normalize.mjs --ref $(date +%F)
# → data/projects.json
```

`normalize.mjs` is pure (no network), so it is deterministic and unit-testable.
`--ref YYYY-MM-DD` sets "today" for overdue/upcoming math (defaults to the system date).

## Output schema (`data/projects.json`)

```
summary { totalProjects, byHealth{red,yellow,green}, totalOutstanding,
          overdueMilestones, overdueTasks }
projects[] {
  id, dealId, name, address, client, role, isMyProject, phase, health,
  financials { income, proposal, changeOrders, paymentsReceived, paymentsBalance,
               nextMilestone { label, amount, percent, date, status, daysOverdue } },
  todos { overdue, dueToday, dueThisWeek, nextDueDate },
  stakeholders { projectManager, designer, architect, administrator }
}
```

### Health rules (config/settings.json → `health`)
- 🔴 **red** — any task overdue OR next milestone date is in the past with a balance outstanding.
- 🟡 **yellow** — a task due within 2 days OR next milestone due within 7 days OR milestone unscheduled with balance due.
- 🟢 **green** — otherwise.

### Milestone `status` values
`overdue` (date passed, balance due) · `upcoming` (within window) · `unscheduled`
(no date, balance due) · `scheduled` · `none`.

## Known constraints (from live verification, 2026-07-14)
- **Subcontractors are NOT available via this token.** `hub_list_subcontractors` returns
  *"access denied: admin-only."* The `payment-tracker` skill therefore reads sub schedules
  from `config/subs.json`, not the HUB.
- **`client` is null here** — client name/email aren't in the overview payload. The
  `email-consolidator` skill sources them from the proposal/deal section and backfills.
- **`phase` is null here** — the current phase is derived once the full task board is
  joined by `daily-todo-generator`.
- **Milestone dates in the sample are all in the past** — either stale HUB dates or real
  uncollected balances; the portal flags them rather than hiding them.
