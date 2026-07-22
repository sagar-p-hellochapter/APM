#!/usr/bin/env node
/**
 * synthesize-weekly.mjs — regenerate data/raw/weekly-source.json's per-project bullets
 * from the week's real activity, using the Claude Messages API.
 *
 * Runs on the Friday branch of the refresh workflow, BEFORE skills/refresh.mjs (whose
 * weekly-update-drafter/draft.mjs then formats these bullets into client + internal drafts).
 *
 * Pipeline per PM project (projects.json → isMyProject):
 *   1. Gather context: financials/milestone status (data/projects.json), the last 7 days of
 *      HUB project notes (hub_search_project_notes, if HUB reachable), recent Outlook subjects
 *      (data/raw/emails-snapshot.json, if present), and the existing curated bullets as a prior.
 *   2. Ask Claude (claude-opus-4-8) to synthesize {progress, next, asks, internalFlags}.
 *   3. Write data/raw/weekly-source.json (preserving dealId/name/phase/client identity).
 *
 * SAFETY: this only regenerates *draft source bullets*. Nothing sends; external email stays
 * draft-only (see draft.mjs + settings.email.selfSendAllowlist). No writes back to the HUB.
 *
 * GUARD: if ANTHROPIC_API_KEY is unset, exits 0 without touching the file (Friday drafts then
 * fall back to the last curated bullets). If the HUB is unreachable, synthesizes from
 * financials + emails + prior bullets alone. If the API call or JSON parse fails, the existing
 * weekly-source.json is left untouched.
 *
 * Zero-dep (Node 20+ global fetch), matching the rest of scripts/. Untested against the live
 * Anthropic + HUB endpoints — verify on first scheduled run (see RUNBOOK.md).
 *
 * Usage: node scripts/synthesize-weekly.mjs [--ref YYYY-MM-DD]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { connectHub } from "./lib/mcp-http.mjs";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const NOTES_WINDOW_DAYS = 7;

function arg(f, d) { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; }
function log(s) { process.stderr.write(s + "\n"); }

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { log("synthesize-weekly: ANTHROPIC_API_KEY not set — skipping (Friday drafts keep last curated bullets)."); process.exit(0); }

const REF = arg("--ref", process.env.REF_DATE || new Date().toISOString().slice(0, 10));
const SRC_PATH = "data/raw/weekly-source.json";
const PROJECTS_PATH = "data/projects.json";
const EMAILS_PATH = "data/raw/emails-snapshot.json";

if (!existsSync(PROJECTS_PATH)) { log("synthesize-weekly: " + PROJECTS_PATH + " missing — run the aggregator first. Skipping."); process.exit(0); }

const projectsDoc = JSON.parse(readFileSync(PROJECTS_PATH, "utf8"));
const prior = existsSync(SRC_PATH) ? JSON.parse(readFileSync(SRC_PATH, "utf8")) : { projects: [] };
const priorByDeal = new Map((prior.projects || []).map((p) => [p.dealId, p]));

// PM projects only (weekly client updates are the PM's; 1025 Fifth is the designer's).
const pmProjects = (projectsDoc.projects || []).filter((p) => p.isMyProject);

// Optional context sources ---------------------------------------------------
const emailsByDeal = new Map();
if (existsSync(EMAILS_PATH)) {
  try {
    const emails = JSON.parse(readFileSync(EMAILS_PATH, "utf8"));
    for (const proj of emails.projects || []) {
      const subjects = [];
      for (const th of proj.threads || []) {
        if (th.subject) subjects.push(th.subject);
        if (subjects.length >= 8) break;
      }
      if (subjects.length) emailsByDeal.set(proj.dealId, subjects);
    }
  } catch (e) { log("synthesize-weekly: could not parse emails snapshot: " + e.message); }
}

const notesByDeal = new Map();
let hub = null;
try { hub = await connectHub(); } catch (e) { log("synthesize-weekly: HUB connect failed (" + e.message + ") — synthesizing without notes."); }
if (hub) {
  const sinceMs = Date.parse(REF + "T00:00:00Z") - NOTES_WINDOW_DAYS * 86400000;
  for (const p of pmProjects) {
    try {
      const res = await hub.call("hub_search_project_notes", { dealId: p.dealId, response_format: "json" });
      const rawNotes = res && (res.notes || res.results || (Array.isArray(res) ? res : []));
      const recent = (rawNotes || [])
        .filter((n) => { const t = Date.parse(n.createdAt || n.date || n.updatedAt || ""); return !isFinite(t) || t >= sinceMs; })
        .slice(0, 12)
        .map((n) => (n.text || n.body || n.content || n.note || "").toString().trim())
        .filter(Boolean);
      if (recent.length) notesByDeal.set(p.dealId, recent);
    } catch (e) { log("  notes skip " + p.name + ": " + e.message); }
  }
  log("synthesize-weekly: pulled notes for " + notesByDeal.size + "/" + pmProjects.length + " projects.");
} else {
  log("synthesize-weekly: HUB not reachable — using financials + emails + prior bullets only.");
}

// Build the per-project context the model reasons over ------------------------
function money(n) { return n == null ? "?" : "$" + Math.round(n).toLocaleString("en-US"); }
function milestoneLine(f) {
  const m = f && f.nextMilestone;
  if (!m) return "No milestone data.";
  if (m.status === "unscheduled") return m.label + " (" + money(m.amount) + ") is UNSCHEDULED; " + money(f.paymentsBalance) + " outstanding.";
  if (m.status === "overdue") return m.label + " (" + money(m.amount) + ") is " + m.daysOverdue + " days past its date; " + money(f.paymentsBalance) + " outstanding.";
  return m.label + " (" + money(m.amount) + ") due " + (m.date ? m.date.slice(0, 10) : "?") + "; " + money(f.paymentsBalance) + " outstanding.";
}

const contexts = pmProjects.map((p) => {
  const pr = priorByDeal.get(p.dealId) || {};
  return {
    dealId: p.dealId,
    name: p.name,
    phase: pr.phase || p.phase || "Construction",
    client: p.client || pr.client || null,
    financialSummary: milestoneLine(p.financials),
    hubNotes: notesByDeal.get(p.dealId) || [],
    recentEmailSubjects: emailsByDeal.get(p.dealId) || [],
    priorBullets: { progress: pr.progress || [], next: pr.next || [], asks: pr.asks || [], internalFlags: pr.internalFlags || [] },
  };
});

const SYSTEM = [
  "You are a project manager at Chapter, a high-end NYC residential renovation firm, writing the weekly client-update source bullets for the PM (Sagar Patel).",
  "For each project you get: its financial/milestone status, the last 7 days of internal HUB project notes (may be empty), recent Outlook email subjects (may be empty), and the prior week's bullets as a baseline.",
  "Synthesize four short bullet lists per project:",
  "  - progress: what actually happened this week (client-facing, warm, concrete). 2-3 bullets.",
  "  - next: what's coming in the next ~2 weeks. 1-2 bullets.",
  "  - asks: anything needed from the client (confirmations, selections, access). 0-2 bullets; empty if none.",
  "  - internalFlags: candid internal notes — overdue milestones/billing, financial mismatches, missing client contact, scope/change-order risks. These are NEVER shown to the client.",
  "Rules: Use the HUB notes and email subjects as the source of truth for what happened; use prior bullets only to fill gaps. Do NOT invent specifics (dates, names, dollar amounts) not present in the context. Keep client-facing bullets free of internal/financial detail. Always surface an overdue or unscheduled milestone as an internalFlag with the billing action.",
  'Respond with ONLY a JSON object, no prose, no code fences: {"projects":[{"dealId":"...","progress":[...],"next":[...],"asks":[...],"internalFlags":[...]}, ...]}. Include every dealId you were given.',
].join("\n");

const USER = "Here are this week's projects (context as JSON):\n\n" + JSON.stringify(contexts, null, 2);

// Call the Claude Messages API ------------------------------------------------
async function callClaude() {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: USER }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Anthropic API → " + res.status + " " + text.slice(0, 400));
  const json = JSON.parse(text);
  const part = (json.content || []).find((c) => c.type === "text");
  if (!part) throw new Error("no text block in response");
  return part.text;
}

function extractJson(s) {
  let t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("no JSON object found in model output");
  return JSON.parse(t.slice(a, b + 1));
}

let synthesized;
try {
  const raw = await callClaude();
  synthesized = extractJson(raw);
} catch (e) {
  log("synthesize-weekly: synthesis failed (" + e.message + ") — leaving " + SRC_PATH + " unchanged.");
  process.exit(0);
}

const synthByDeal = new Map((synthesized.projects || []).map((p) => [p.dealId, p]));

// Merge: model bullets where present, prior bullets as fallback ---------------
const nowIso = new Date().toISOString();
const refDate = new Date(Date.parse(REF + "T00:00:00Z"));
const weekOfDate = new Date(refDate.getTime() + 3 * 86400000); // Fri ref → the following Monday-ish "week of"
const weekOf = weekOfDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

const out = {
  generatedAt: nowIso,
  referenceDate: REF,
  weekOf: weekOf,
  _note: "Auto-synthesized by scripts/synthesize-weekly.mjs from HUB notes (last 7d) + recent Outlook + financials, via the Claude API. draft.mjs formats these into client + internal drafts. PM projects only.",
  projects: contexts.map((c) => {
    const s = synthByDeal.get(c.dealId) || {};
    const pick = (k) => (Array.isArray(s[k]) && s[k].length ? s[k] : c.priorBullets[k]) || [];
    return {
      dealId: c.dealId,
      name: c.name,
      phase: c.phase,
      client: c.client,
      progress: pick("progress"),
      next: pick("next"),
      asks: Array.isArray(s.asks) ? s.asks : c.priorBullets.asks, // asks legitimately empty — don't fall back on length
      internalFlags: pick("internalFlags"),
    };
  }),
};

mkdirSync(dirname(SRC_PATH), { recursive: true });
writeFileSync(SRC_PATH, JSON.stringify(out, null, 2) + "\n");
log("synthesize-weekly: wrote " + SRC_PATH + " (" + out.projects.length + " projects, " + synthByDeal.size + " synthesized).");
