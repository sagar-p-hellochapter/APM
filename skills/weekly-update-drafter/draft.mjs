#!/usr/bin/env node
/**
 * weekly-update-drafter / draft.mjs
 *
 * Pure transform → data/weekly.json. Formats per-project weekly bullets (synthesized
 * by the runner from HUB notes + recent Outlook + timeline) into:
 *   - a warm, plain-text CLIENT draft (progress this week / next 2 weeks / asks) — SOP A7,
 *   - a candid INTERNAL version (flags: overdue, financial mismatches, risks).
 * Nothing sends. Drafts land in the portal Email tab for review; the PM sends from Outlook
 * (external email is draft-only). Auto-generated Fridays.
 *
 * Usage: node draft.mjs [--in data/raw/weekly-source.json] [--settings config/settings.json] [--out data/weekly.json]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

function arg(f, d){ const i=process.argv.indexOf(f); return i!==-1&&process.argv[i+1]?process.argv[i+1]:d; }
const IN = arg("--in","data/raw/weekly-source.json");
const SETTINGS = arg("--settings","config/settings.json");
const OUT = arg("--out","data/weekly.json");

function firstName(n){ return n ? String(n).trim().split(/\s+/)[0] : null; }
const bullets = (arr)=> (arr||[]).map(function(b){ return "• " + b; }).join("\n");

export function draft(src, settings){
  const weekOf = src.weekOf || "this week";
  let sig = settings?.email?.signature || "";
  if(!sig || /PENDING/i.test(sig)) sig = (settings?.hub?.pmName || "Sagar Patel") + "\nProject Manager, Chapter";

  const projects = (src.projects || []).map(function(p){
    const greet = p.client && p.client.name ? ("Hi " + firstName(p.client.name) + ",") : "Hi there,";
    const parts = [];
    parts.push(greet, "");
    parts.push("Here's your weekly update on " + p.name + ".", "");
    if((p.progress||[]).length){ parts.push("Progress this week:", bullets(p.progress), ""); }
    if((p.next||[]).length){ parts.push("Coming up (next 2 weeks):", bullets(p.next), ""); }
    if((p.asks||[]).length){ parts.push("A couple of things we'd need from you:", bullets(p.asks), ""); }
    parts.push("As always, reach out with any questions.", "", "Best,", sig);
    const clientBody = parts.join("\n");

    const internal = [
      "INTERNAL — " + p.name + " · " + weekOf,
      "Phase: " + (p.phase || "—"),
      p.client && p.client.name ? ("Client: " + p.client.name + (p.client.email ? " <" + p.client.email + ">" : "")) : "Client: NOT IDENTIFIED",
      "",
      "Flags / risks:",
      bullets(p.internalFlags && p.internalFlags.length ? p.internalFlags : ["No flags."]),
    ].join("\n");

    return {
      dealId: p.dealId, name: p.name, client: p.client || null,
      clientReady: !!(p.client && p.client.email),
      clientDraft: { subject: p.name + " — Weekly Update (" + weekOf + ")", to: p.client && p.client.email || null, body: clientBody },
      internal: { body: internal },
    };
  });

  return { generatedAt: src.generatedAt || null, referenceDate: src.referenceDate || null, weekOf: weekOf, projects: projects };
}

if (import.meta.url === `file://${process.argv[1]}`){
  const src = JSON.parse(readFileSync(IN, "utf8"));
  const settings = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, "utf8")) : {};
  const out = draft(src, settings);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const ready = out.projects.filter(function(p){ return p.clientReady; }).length;
  console.error("weekly.json → " + out.projects.length + " drafts (" + ready + " client-ready, " + (out.projects.length-ready) + " need client contact)");
}
