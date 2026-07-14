#!/usr/bin/env node
/**
 * email-consolidator / consolidate.mjs
 *
 * Pure transform: takes the per-project Outlook snapshot (assembled by the runner
 * from outlook_email_search, matched on street address) and emits data/emails.json —
 * per-project threads with readable sender + role, recency/unread flags, sorted newest
 * first. Also backfills client name/email into data/projects.json so the Projects and
 * detail views can show the client.
 *
 * Usage: node consolidate.mjs [--in data/raw/emails-snapshot.json] [--out data/emails.json] [--projects data/projects.json] [--ref YYYY-MM-DD]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

function arg(f, d){ const i=process.argv.indexOf(f); return i!==-1&&process.argv[i+1]?process.argv[i+1]:d; }
const IN = arg("--in","data/raw/emails-snapshot.json");
const OUT = arg("--out","data/emails.json");
const PROJ = arg("--projects","data/projects.json");
const dayMs = 86400000;

export function consolidate(snap, refISO){
  const ref = refISO || snap.referenceDate || new Date().toISOString().slice(0,10);
  const refMs = Date.parse(ref + "T23:59:59Z");
  const projects = (snap.projects || []).map(function(p){
    const emails = (p.emails || []).map(function(e){
      const ageH = e.date ? (refMs - Date.parse(e.date))/3600000 : null;
      return {
        from: e.from, role: e.role || "vendor", subject: e.subject, snippet: e.snippet || "",
        date: e.date, attach: !!e.attach, read: e.read !== false,
        recent: ageH != null && ageH <= 48, webLink: e.webLink || null,
      };
    }).sort(function(a,b){ return Date.parse(b.date||0) - Date.parse(a.date||0); });
    return {
      dealId: p.dealId, name: p.name, client: p.client || null,
      unreadCount: emails.filter(function(e){ return !e.read; }).length,
      recentCount: emails.filter(function(e){ return e.recent; }).length,
      total: emails.length,
      emails: emails,
    };
  });
  return { generatedAt: snap.generatedAt || null, referenceDate: ref, projects: projects };
}

if (import.meta.url === `file://${process.argv[1]}`){
  const snap = JSON.parse(readFileSync(IN, "utf8"));
  const out = consolidate(snap, arg("--ref", null));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  // Backfill client into projects.json
  if (existsSync(PROJ)){
    const pj = JSON.parse(readFileSync(PROJ, "utf8"));
    const byDeal = {}; out.projects.forEach(function(p){ if(p.client) byDeal[p.dealId] = p.client; });
    let n = 0;
    (pj.projects || []).forEach(function(pr){ if(byDeal[pr.dealId]){ pr.client = byDeal[pr.dealId]; n++; } });
    writeFileSync(PROJ, JSON.stringify(pj, null, 2) + "\n");
    console.error("backfilled client on " + n + " projects in " + PROJ);
  }
  const t = out.projects.reduce(function(s,p){ return s+p.total; }, 0);
  console.error("emails.json → " + out.projects.length + " projects, " + t + " emails");
}
