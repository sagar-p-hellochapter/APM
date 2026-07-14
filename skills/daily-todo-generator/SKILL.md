---
name: daily-todo-generator
description: Builds the prioritized daily to-do list (data/today.json) from HUB task boards + milestone/payment flags, with 3-day / 2-day / overdue urgency, grouped by category.
---

# daily-todo-generator

Second skill in the pipeline. Produces `data/today.json` — what the portal's **Today**
tab renders. Recomputed nightly at 11:00 PM (config `dailyResetTime`).

## What it does
1. Takes a **task snapshot** (`data/raw/tasks-snapshot.json`) — the not-done tasks per
   project, assembled by the runner from `hub_get_project_tasks` (full board per project).
2. Computes **urgency** from each task's `endDate` vs. the reference date:
   `overdue` · `today` · `2-day` · `3-day` · `soon` (≤ `windowDays`, default 7). Tasks
   beyond the window are dropped from the daily list.
3. Folds in **milestone / payment action items** from `data/projects.json` (portfolio-wide).
4. **Categorizes** every item — payments · communication · procurement · changeorder · site —
   by keyword on title + phase.
5. Sorts by urgency then soonest due, and groups both **by category** (for the Today tabs)
   and **by project**.

```bash
node skills/daily-todo-generator/generate.mjs --ref $(date +%F)
# → data/today.json
```

## Why not use the HUB To-Do tab directly
`hub_get_todo_list` and `hub_get_user_overdue_tasks` **under-reported** during live
verification — both returned 0 while the raw board for 75 East End had "Design/PM Project
Pass Off" due the next day and "Job Start Date" due in 6 days, neither done. So urgency is
computed here directly from task `endDate`, which matches the SOP's 3-day / 2-day / overdue
intent and is complete. (No false alarms: `done` tasks are excluded before flagging.)

## Output (`data/today.json`)
```
summary { total, counts { overdue, today, 2-day, 3-day, soon } }
byCategory { payments[], communication[], procurement[], changeorder[], site[] }
byProject { <dealId>: { project, items[] } }
taskCoverage [ dealId... ]   // which projects' task boards are included this run
item { source(task|milestone), dealId, project, title, due, daysUntil, urgency,
       category, phase?, assigned[]?, clientVisible?, note?, amount? }
```

## Coverage note
Milestone/payment items are portfolio-wide (from projects.json). Task items depend on which
boards the runner fetched — `taskCoverage` lists them, and the portal shows "Task items: N
of M projects." The nightly runner fetches all active boards; the committed sample covers
75 East End Avenue #17A.

## Verified
Against the live 75 East End board (2026-07-14): 9 items — 6 overdue milestones, 1
unscheduled milestone, "Pass Off" as a 2-day warning, "Job Start" as upcoming; correct
category + urgency ranking.
