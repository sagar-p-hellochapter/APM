#!/usr/bin/env node
/**
 * payment-tracker / track.mjs
 *
 * Pure transform → data/payments.json (the portal's Payments tab):
 *   - Client milestone-release tracker (from data/projects.json financials).
 *   - Subcontractor payment reminders (from config/subs.json — the HUB sub
 *     directory is admin-only, so subs live in config, not the HUB).
 *
 * Flags per config/settings.json: sub due within `dueSoonDays`, due today, overdue.
 * Usage: node track.mjs [--projects data/projects.json] [--subs config/subs.json] [--settings config/settings.json] [--out data/payments.json] [--ref YYYY-MM-DD]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

function arg(f, d){ const i=process.argv.indexOf(f); return i!==-1&&process.argv[i+1]?process.argv[i+1]:d; }
const PROJ = arg("--projects","data/projects.json");
const SUBS = arg("--subs","config/subs.json");
const SETTINGS = arg("--settings","config/settings.json");
const OUT = arg("--out","data/payments.json");
const dayMs = 86400000;
const round2 = (n)=> (typeof n==="number" ? Math.round(n*100)/100 : n);

export function track(projectsDoc, subsDoc, settings, refISO){
  const ref = refISO || (projectsDoc && projectsDoc.referenceDate) || new Date().toISOString().slice(0,10);
  const refMs = Date.parse(ref + "T00:00:00Z");
  const dueSoonDays = settings?.subPayment?.dueSoonDays ?? 5;
  const days = (d)=> d ? Math.round((Date.parse(d) - refMs)/dayMs) : null;

  // Client milestones
  const clientMilestones = [];
  (projectsDoc?.projects || []).forEach(function(p){
    const m = p.financials && p.financials.nextMilestone;
    if(!m) return;
    clientMilestones.push({
      dealId: p.dealId, project: p.address, label: m.label,
      amount: m.amount, percent: m.percent, date: m.date,
      status: m.status, daysOverdue: m.daysOverdue,
      outstanding: p.financials.paymentsBalance,
      action: m.status==="overdue" ? "Bill now — past due"
            : m.status==="unscheduled" ? "Schedule + bill"
            : m.status==="upcoming" ? "Bill soon" : "On schedule",
    });
  });

  // Subcontractor payments
  const subPayments = [];
  (subsDoc?.subcontractors || []).forEach(function(s){
    (s.projects || []).forEach(function(pr){
      (pr.payments || []).forEach(function(pay){
        let flag;
        if(pay.status === "paid") flag = "paid";
        else if(/held/.test(pay.status||"")) flag = "held";
        else {
          const dd = days(pay.dueDate);
          if(dd == null) flag = "unscheduled";
          else if(dd < 0) flag = "overdue";
          else if(dd === 0) flag = "due-today";
          else if(dd <= dueSoonDays) flag = "due-soon";
          else flag = "scheduled";
        }
        subPayments.push({
          sub: s.name, trade: s.trade, email: s.email || null,
          dealId: pr.dealId, project: pr.projectName, label: pay.label,
          amount: round2(pay.amount), dueDate: pay.dueDate || null,
          daysUntil: days(pay.dueDate), status: pay.status, flag: flag,
        });
      });
    });
  });
  const rank = { overdue:0, "due-today":1, "due-soon":2, unscheduled:3, scheduled:4, held:5, paid:6 };
  subPayments.sort(function(a,b){ return (rank[a.flag]??9)-(rank[b.flag]??9); });

  const summary = {
    totalOutstandingClient: round2((projectsDoc?.projects||[]).reduce(function(s,p){ return s+(p.financials?.paymentsBalance||0); },0)),
    milestonesOverdue: clientMilestones.filter(function(m){ return m.status==="overdue"; }).length,
    milestonesToAction: clientMilestones.filter(function(m){ return ["overdue","upcoming","unscheduled"].includes(m.status); }).length,
    subOverdue: subPayments.filter(function(x){ return x.flag==="overdue"; }).length,
    subDueSoon: subPayments.filter(function(x){ return x.flag==="due-soon"||x.flag==="due-today"; }).length,
  };

  return {
    generatedAt: projectsDoc?.generatedAt || null,
    referenceDate: ref,
    subsAreExample: !!(subsDoc && subsDoc._isExample),
    summary, clientMilestones, subPayments,
  };
}

if (import.meta.url === `file://${process.argv[1]}`){
  const projectsDoc = JSON.parse(readFileSync(PROJ, "utf8"));
  const subsDoc = existsSync(SUBS) ? JSON.parse(readFileSync(SUBS, "utf8")) : (existsSync("config/subs.example.json") ? JSON.parse(readFileSync("config/subs.example.json","utf8")) : {subcontractors:[]});
  const settings = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, "utf8")) : {};
  const out = track(projectsDoc, subsDoc, settings, arg("--ref", null));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const s = out.summary;
  console.error("payments.json → "+out.clientMilestones.length+" client milestones ("+s.milestonesOverdue+" overdue), "
    + out.subPayments.length+" sub payments ("+s.subOverdue+" overdue, "+s.subDueSoon+" due soon)"
    + (out.subsAreExample ? "  [subs = EXAMPLE data]" : ""));
}
