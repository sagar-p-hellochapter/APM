#!/usr/bin/env node
/**
 * fetch-outlook.mjs — CI live-pull from Microsoft Graph → data/raw/emails-snapshot.json.
 * Needs env GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_USER (mailbox UPN).
 * If missing, exits 0 without touching the snapshot. Untested against live Graph — see RUNBOOK.
 * App needs Mail.Read (application) admin-consented.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const stamp = new Date().toISOString();
function log(s){ process.stderr.write(s + "\n"); }

const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_USER } = process.env;
if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !GRAPH_USER) {
  log("fetch-outlook: Graph creds not set — skipping Outlook pull."); process.exit(0);
}

// Project list + address queries: prefer the live index from fetch-hub, else reuse the existing snapshot.
let projects = [];
if (existsSync("data/raw/projects-index.json")) {
  projects = JSON.parse(readFileSync("data/raw/projects-index.json", "utf8")).projects || [];
} else if (existsSync("data/raw/emails-snapshot.json")) {
  projects = (JSON.parse(readFileSync("data/raw/emails-snapshot.json", "utf8")).projects || []).map((p) => ({ dealId: p.dealId, name: p.name, emailQuery: (p.name.split("#")[0] || p.name).trim() }));
}
if (!projects.length) { log("fetch-outlook: no project index — skipping."); process.exit(0); }

async function token() {
  const body = new URLSearchParams({ client_id: GRAPH_CLIENT_ID, client_secret: GRAPH_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  const r = await fetch("https://login.microsoftonline.com/" + GRAPH_TENANT_ID + "/oauth2/v2.0/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error("token " + r.status + " " + (await r.text()).slice(0, 200));
  return (await r.json()).access_token;
}

const PERSONAL = /@(gmail|hotmail|outlook|yahoo|icloud|aol)\./i;
function role(email, clientEmail) {
  const s = (email || "").toLowerCase();
  if (clientEmail && s === clientEmail.toLowerCase()) return "client";
  if (/donotreply|no-?reply|chapter-ai|notification\.intuit|quickbooks/.test(s)) return "system";
  if (s === (GRAPH_USER || "").toLowerCase()) return "you";
  if (/@hellochapter\.com$/.test(s)) return "team";
  return "vendor";
}

const tok = await token();
const out = { generatedAt: stamp, referenceDate: process.env.REF_DATE || stamp.slice(0, 10), projects: [] };

for (const p of projects) {
  const url = "https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(GRAPH_USER) +
    "/messages?$search=" + encodeURIComponent('"' + p.emailQuery + '"') +
    "&$top=6&$select=subject,from,receivedDateTime,hasAttachments,isRead,webLink,bodyPreview";
  let msgs = [];
  try {
    const r = await fetch(url, { headers: { authorization: "Bearer " + tok } });
    if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 150));
    msgs = (await r.json()).value || [];
  } catch (e) { log("  email skip " + p.name + ": " + e.message); }

  // Heuristic client = most-recent personal-domain, non-vendor external sender.
  let client = null;
  for (const m of msgs) {
    const addr = m.from && m.from.emailAddress;
    if (addr && PERSONAL.test(addr.address || "")) { client = { name: addr.name || addr.address, email: addr.address }; break; }
  }
  const emails = msgs.map((m) => {
    const addr = (m.from && m.from.emailAddress) || {};
    return { from: addr.name || addr.address || "Unknown", role: role(addr.address, client && client.email), subject: m.subject || "(no subject)", snippet: (m.bodyPreview || "").replace(/\s+/g, " ").trim().slice(0, 140), date: m.receivedDateTime, attach: !!m.hasAttachments, read: m.isRead !== false, webLink: m.webLink || null };
  });
  out.projects.push({ dealId: p.dealId, name: p.name, client, emails });
}

writeFileSync("data/raw/emails-snapshot.json", JSON.stringify(out, null, 2) + "\n");
log("fetch-outlook: wrote emails snapshot for " + out.projects.length + " projects");
