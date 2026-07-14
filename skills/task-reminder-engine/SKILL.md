---
name: task-reminder-engine
description: Decides which tasks/milestones/sub-payments warrant a reminder to the PM and at what escalation level. Produces data/reminders.json; drives the Today alert strip and self-alert emails.
---

# task-reminder-engine

Third skill. Produces `data/reminders.json` — the record of what needs a nudge, at what
level. Drives the **Today** tab's reminder strip and (once a send path exists) the
scheduled self-alert emails.

## Escalation rules (SOP A2/A4 + interview)
- **3 days out** → `notify` (portal only)
- **2 days out / due today** → `email` (reminder to the PM)
- **overdue** → `urgent` (portal badge + email to the PM)
- **sub payment overdue ≥ `subPayment.overdueSelfAlertDays` (2)** → `urgent` (SOP A4)

Sources: `data/today.json` (tasks + milestones, already excludes done tasks — no false
alarms) and `data/payments.json` (sub payments). Self-alerts are addressed ONLY to
`settings.email.selfSendAllowlist[0]` — never to clients or subs.

```bash
node skills/task-reminder-engine/engine.mjs   # → data/reminders.json
```

## Output
```
counts { urgent, email, notify }
selfAlertTo  // the one permitted self-alert address
reminders[] { kind(task|milestone|sub), level, dealId, project, title, due, daysUntil, urgency, reason, emailTo, amount? }
```

## How it surfaces
- Portal Today shows a strip: "N items need a reminder email · M urgent."
- The actual reminder email is generated on demand by **email-drafter** (the ✉ buttons),
  or, once the scheduler + send path are live, auto-sent to the PM only.

## Verified (2026-07-14)
11 reminders — 6 urgent (all overdue milestone billings), 3 email, 2 notify —
self-addressed to `sagar.p@hellochapter.com`.
