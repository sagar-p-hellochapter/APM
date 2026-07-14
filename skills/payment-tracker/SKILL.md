---
name: payment-tracker
description: Tracks client milestone releases and subcontractor payments, flagging what's due/overdue. Produces data/payments.json for the Payments tab.
---

# payment-tracker

Fourth skill. Produces `data/payments.json` — the portal's **Payments** tab.

## Two sides
- **Client milestones** (source: `data/projects.json` financials) — next milestone per
  project with status (overdue / upcoming / unscheduled / scheduled), amount, %, and the
  outstanding balance. Action label: *Bill now* / *Schedule + bill* / *Bill soon* / *On schedule*.
- **Subcontractor payments** (source: `config/subs.json`) — the HUB sub directory is
  admin-only, so subs + payment schedules live in config. Each scheduled payment is flagged:
  `overdue` · `due-today` · `due-soon` (≤ `subPayment.dueSoonDays`, default 5) · `scheduled`
  · `held` (retainage) · `paid`.

```bash
node skills/payment-tracker/track.mjs --ref $(date +%F)
# → data/payments.json
```

## Output
```
summary { totalOutstandingClient, milestonesOverdue, milestonesToAction, subOverdue, subDueSoon }
clientMilestones[] { dealId, project, label, amount, percent, date, status, daysOverdue, outstanding, action }
subPayments[] { sub, trade, email, dealId, project, label, amount, dueDate, daysUntil, status, flag }
subsAreExample   // true until you replace config/subs.json with real data
```

## Verified (live, 2026-07-14)
7 client milestones (6 overdue, $678,280.93 outstanding). Sub payments run off the
**example** `config/subs.json` — the portal shows a banner until it's replaced. Example:
Plumbing rough-in $21,000 flagged **due-soon** (4 days), retainage **held**, deposit **paid**.

## To make sub tracking real
Replace `config/subs.json` with your subcontractors and their payment schedules (match to a
project by `dealId`). Sub *paid* status can't be pulled (QuickBooks sub access unavailable),
so `status` is maintained in that file. Overdue-2-day self-alerts (SOP A4) are drafted by
`email-drafter` to your own address only.

## Not yet wired
Change-order billing detail (pending/approved/paid per CO) needs the HUB CO endpoints
(`hub_get_change_order_costs` / `hub_office_change_orders`) — that's the Changes tab, still stubbed.
