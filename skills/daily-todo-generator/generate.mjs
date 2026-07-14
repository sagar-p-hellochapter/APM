#!/usr/bin/env node
/**
 * daily-todo-generator / generate.mjs
 *
 * Builds the prioritized daily to-do list the portal's Today tab renders.
 * Pure transform: consumes a task snapshot (not-done tasks per project, assembled
 * by the runner from hub_get_project_tasks) + data/projects.json (for milestone /
 * payment action items), and emits data/today.json.
 *
 * Urgency is computed directly from task endDate vs. the reference date — NOT from
 * the HUB To-Do tab, which was observed to under-report (see SKILL.md). Rules from
 * config/settings.json: warn at 3 and 2 days out, escalate when overdue.
 *
 * Usage: node generate.mjs [--tasks data/raw/tasks-snapshot.json] [--projects data/projects.json] [--out data/today.json] [--ref YYYY-MM-DD]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

function arg(flag, fb){ const i=process.argv.indexOf(flag); return i!==-1&&process.argv[i+1]?process.argv[i+1]:fb; }
const TASKS = arg("--tasks","data/raw/tasks-snapshot.json");
const PROJECTS = arg("--projects","data/projects.json");
const OUT = arg("--out","data/today.json");
const dayMs = 86400000;

const CATEGORY_RULES = [
  ["payments",      /invoic|payment|cash\s*flow|balance|deposit|milestone|collect|billing/i],
  ["communication", /client|update|sign\s*off|pass\s*off|walkthrough|conference|call|meeting|email|review|survey|kickoff/i],
  ["procurement",   /material|order|purchase|\bpo\b|procure|deliver|submittal|takeoff|take\s*off|spec/i],
  ["changeorder",   /change\s*order/i],
];
function categorize(title, phase){
  var t = (title||"") + " " + (phase||"");
  for (var i=0;i<CATEGORY_RULES.length;i++){ if(CATEGORY_RULES[i][1].test(t)) return CATEGORY_RULES[i][0]; }
  return "site";
}

export function generate(snapshot, projectsDoc, refDateISO){
  var ref = refDateISO || snapshot.referenceDate || new Date().toISOString().slice(0,10);
  var refMs = Date.parse(ref + "T00:00:00Z");
  var windowDays = snapshot.windowDays ?? 7;
  var warn = snapshot.warningDays || [3,2];
  var maxWarn = Math.max.apply(null, warn);

  function urgency(days){
    if (days < 0) return "overdue";
    if (days === 0) return "today";
    if (days <= Math.min.apply(null, warn)) return warn[warn.length-1] + "-day"; // e.g. "2-day"
    if (days <= maxWarn) return maxWarn + "-day";                                // e.g. "3-day"
    return "soon";
  }
  var rank = { overdue:0, today:1, "2-day":2, "3-day":3, soon:4 };

  var items = [];

  // 1) Task-derived items (only not-done, within the window or overdue)
  (snapshot.projects || []).forEach(function(p){
    (p.tasks || []).forEach(function(t){
      if (t.done) return;
      if (!t.endDate) return;
      var days = Math.round((Date.parse(t.endDate) - refMs)/dayMs);
      if (days > windowDays) return; // beyond the daily horizon
      items.push({
        source: "task",
        dealId: p.dealId,
        project: p.name,
        title: t.title,
        due: t.endDate,
        daysUntil: days,
        urgency: urgency(days),
        category: categorize(t.title, t.phase),
        phase: t.phase || null,
        assigned: (t.assigned || []).map(function(a){ return a.name || a; }),
        clientVisible: !!t.portal,
      });
    });
  });

  // 2) Payment / milestone action items from projects.json (portfolio-wide)
  var byDeal = {};
  (projectsDoc && projectsDoc.projects || []).forEach(function(pr){
    byDeal[pr.dealId] = pr;
    var m = pr.financials && pr.financials.nextMilestone;
    if (m && (m.status==="overdue" || m.status==="upcoming" || m.status==="unscheduled")){
      items.push({
        source: "milestone",
        dealId: pr.dealId,
        project: pr.address,
        title: "Bill client — " + m.label + " (" + money(m.amount) + ")",
        due: m.date,
        daysUntil: m.date ? Math.round((Date.parse(m.date)-refMs)/dayMs) : null,
        urgency: m.status==="overdue" ? "overdue" : (m.status==="upcoming" ? "3-day" : "soon"),
        category: "payments",
        note: m.status==="overdue" ? (m.daysOverdue + " days overdue") : m.status,
        amount: m.amount,
      });
    }
  });

  // Sort each category by urgency then soonest due
  items.sort(function(a,b){
    var r=(rank[a.urgency]??9)-(rank[b.urgency]??9); if(r) return r;
    return (a.daysUntil??9999)-(b.daysUntil??9999);
  });

  var cats = { payments:[], communication:[], procurement:[], changeorder:[], site:[] };
  items.forEach(function(it){ (cats[it.category] || cats.site).push(it); });

  // Per-project grouping
  var byProject = {};
  items.forEach(function(it){
    (byProject[it.dealId] = byProject[it.dealId] || { dealId:it.dealId, project:it.project, items:[] }).items.push(it);
  });

  var counts = { overdue:0, today:0, "2-day":0, "3-day":0, soon:0 };
  items.forEach(function(it){ if(counts[it.urgency]!=null) counts[it.urgency]++; });

  return {
    generatedAt: snapshot.generatedAt || (projectsDoc && projectsDoc.generatedAt) || null,
    referenceDate: ref,
    windowDays: windowDays,
    taskCoverage: (snapshot.projects||[]).map(function(p){return p.dealId;}),
    summary: { total: items.length, counts: counts },
    byCategory: cats,
    byProject: byProject,
  };
}

function money(n){ return n==null ? "—" : "$" + Math.round(n).toLocaleString("en-US"); }

if (import.meta.url === `file://${process.argv[1]}`){
  var snap = JSON.parse(readFileSync(TASKS,"utf8"));
  var proj = existsSync(PROJECTS) ? JSON.parse(readFileSync(PROJECTS,"utf8")) : {projects:[]};
  var out = generate(snap, proj, arg("--ref", null));
  mkdirSync(dirname(OUT),{recursive:true});
  writeFileSync(OUT, JSON.stringify(out,null,2)+"\n");
  var c=out.summary.counts;
  console.error("today.json → "+out.summary.total+" items ("+c.overdue+" overdue, "+c.today+" today, "+c["2-day"]+" 2-day, "+c["3-day"]+" 3-day, "+c.soon+" soon)");
}
