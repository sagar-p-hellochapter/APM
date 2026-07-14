#!/usr/bin/env node
/**
 * task-reminder-engine / engine.mjs
 *
 * Pure transform → data/reminders.json. Decides which items warrant a reminder to the PM
 * and at what escalation level, per the SOP (A2/A4) and the interview rules:
 *   - 3 days out  → notify (portal only)
 *   - 2 days out / due today → email reminder (to the PM only)
 *   - overdue     → URGENT (portal badge + email to the PM)
 * Sources: data/today.json (tasks + milestones) and data/payments.json (sub payments).
 *
 * No false alarms: today.json already excludes done tasks. Self-alerts go ONLY to the
 * address in settings.email.selfSendAllowlist — never to clients/subs.
 *
 * Usage: node engine.mjs [--today data/today.json] [--payments data/payments.json] [--settings config/settings.json] [--out data/reminders.json]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

function arg(f, d){ const i=process.argv.indexOf(f); return i!==-1&&process.argv[i+1]?process.argv[i+1]:d; }
const TODAY = arg("--today","data/today.json");
const PAYMENTS = arg("--payments","data/payments.json");
const SETTINGS = arg("--settings","config/settings.json");
const OUT = arg("--out","data/reminders.json");

const LEVEL = { overdue:"urgent", today:"email", "2-day":"email", "3-day":"notify" };

export function engine(today, payments, settings){
  const selfTo = (settings?.email?.selfSendAllowlist || [])[0] || null;
  const subOverdueDays = settings?.subPayment?.overdueSelfAlertDays ?? 2;
  const reminders = [];

  // Tasks + milestones from today.json
  const cats = today?.byCategory || {};
  Object.keys(cats).forEach(function(k){
    (cats[k] || []).forEach(function(it){
      const level = LEVEL[it.urgency];
      if(!level) return; // soon/later → not a reminder
      const isMilestone = it.source === "milestone";
      reminders.push({
        kind: isMilestone ? "milestone" : "task",
        level: level, dealId: it.dealId, project: it.project, title: it.title,
        due: it.due || null, daysUntil: it.daysUntil, urgency: it.urgency,
        emailTo: selfTo,
        reason: isMilestone
          ? ("Milestone " + (it.note || it.urgency) + " — bill the client")
          : ("Task " + (it.urgency==="overdue" ? (Math.abs(it.daysUntil)+" days overdue") : it.urgency==="today" ? "due today" : "due in "+it.daysUntil+" days")),
      });
    });
  });

  // Subcontractor payments from payments.json (SOP A4: overdue 2+ days → self alert)
  (payments?.subPayments || []).forEach(function(x){
    let level = null;
    if(x.flag === "overdue" && (x.daysUntil==null || -x.daysUntil >= subOverdueDays)) level = "urgent";
    else if(x.flag === "due-today" || x.flag === "due-soon") level = "email";
    if(!level) return;
    reminders.push({
      kind: "sub", level: level, dealId: x.dealId, project: x.project,
      title: x.sub + " — " + x.label, due: x.dueDate, daysUntil: x.daysUntil, urgency: x.flag,
      amount: x.amount, emailTo: selfTo,
      reason: "Sub payment " + (x.flag==="overdue" ? (Math.abs(x.daysUntil)+" days overdue") : x.flag),
    });
  });

  const order = { urgent:0, email:1, notify:2 };
  reminders.sort(function(a,b){ return (order[a.level]-order[b.level]) || ((a.daysUntil??9999)-(b.daysUntil??9999)); });
  const counts = { urgent:0, email:0, notify:0 };
  reminders.forEach(function(r){ counts[r.level]++; });

  return {
    generatedAt: today?.generatedAt || null,
    referenceDate: today?.referenceDate || null,
    selfAlertTo: selfTo,
    counts: counts,
    reminders: reminders,
  };
}

if (import.meta.url === `file://${process.argv[1]}`){
  const today = JSON.parse(readFileSync(TODAY, "utf8"));
  const payments = existsSync(PAYMENTS) ? JSON.parse(readFileSync(PAYMENTS, "utf8")) : { subPayments: [] };
  const settings = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, "utf8")) : {};
  const out = engine(today, payments, settings);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const c = out.counts;
  console.error("reminders.json → " + out.reminders.length + " reminders (" + c.urgent + " urgent, " + c.email + " email, " + c.notify + " notify) → self-alerts to " + out.selfAlertTo);
}
