#!/usr/bin/env node
/**
 * fetch-hub.mjs — CI live-pull from the HUB → rewrites data/raw/{hub,tasks,co}-snapshot.json.
 * Needs env HUB_MCP_URL + HUB_TOKEN (+ optional HUB_USER_ID). If missing, exits 0 without
 * touching snapshots (the site keeps last-good data). Untested against live HUB — see RUNBOOK.
 */
import { writeFileSync } from "node:fs";
import { connectHub } from "./lib/mcp-http.mjs";

const REF = process.env.REF_DATE || new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString();
const dayMs = 86400000;
const WINDOW_DAYS = 35;

function log(s){ process.stderr.write(s + "\n"); }
const emailQuery = (name) => (name.split("#")[0] || name).trim();

const hub = await connectHub();
if (!hub) { log("fetch-hub: HUB_MCP_URL/HUB_TOKEN not set — skipping HUB pull."); process.exit(0); }

const role = process.env.HUB_ROLE || "pm";
const userId = process.env.HUB_USER_ID; // defaults server-side to HUB_DEFAULT_USER_ID
const listArgs = { role, response_format: "json" };
if (userId) listArgs.userId = userId;

const list = await hub.call("hub_list_projects", listArgs);
const projects = (list.projects || []).map((p) => ({ id: p.id, name: p.name, dealId: p.dealId }));
log("fetch-hub: " + projects.length + " projects");

const hubSnapshot = { generatedAt: stamp, referenceDate: REF, pmUserId: (list.userId || null), settings: { milestone: { upcomingWindowDays: 7 } }, todoList: { todos: [] }, overdue: { byProject: [] }, projects: [] };
const tasksSnapshot = { generatedAt: stamp, referenceDate: REF, windowDays: 7, warningDays: [3, 2], projects: [] };
const coSnapshot = { generatedAt: stamp, referenceDate: REF, projects: [] };

for (const p of projects) {
  const overview = await hub.call("hub_get_project_overview", { dealId: p.dealId, response_format: "json" });
  hubSnapshot.projects.push({ id: p.id, name: p.name, dealId: p.dealId, role, overview });

  const board = await hub.call("hub_get_project_tasks", { dealId: p.dealId, role: "finance", onlyOverdue: false, includeSubtasks: true, response_format: "json" });
  const tasks = [];
  const phases = board.tasksByPhase || {};
  for (const phase of Object.keys(phases)) {
    for (const t of phases[phase]) {
      if (t.done) continue;
      if (!t.endDate) continue;
      const days = Math.round((Date.parse(t.endDate) - Date.parse(REF + "T00:00:00Z")) / dayMs);
      if (days > WINDOW_DAYS) continue;
      tasks.push({ title: t.title, endDate: t.endDate, done: false, status: (t.status && t.status.id) || "TODO", phase: t.phase || phase, assigned: (t.assigned || []).map((a) => ({ name: a.name })), portal: !!t.portal });
    }
  }
  tasksSnapshot.projects.push({ dealId: p.dealId, name: p.name, tasks });

  try {
    const co = await hub.call("hub_get_change_order_costs", { dealId: p.dealId, response_format: "json" });
    if (co && (co.changeOrders || (co.byChangeOrder || []).length)) {
      coSnapshot.projects.push({ dealId: p.dealId, name: p.name, changeOrders: (co.byChangeOrder || []).map((c) => ({ title: c.title, sold: c.sold, cost: c.cost })) });
    }
  } catch (e) { log("  CO skip " + p.name + ": " + e.message); }
}

writeFileSync("data/raw/hub-snapshot.json", JSON.stringify(hubSnapshot, null, 2) + "\n");
writeFileSync("data/raw/tasks-snapshot.json", JSON.stringify(tasksSnapshot, null, 2) + "\n");
writeFileSync("data/raw/co-snapshot.json", JSON.stringify(coSnapshot, null, 2) + "\n");
log("fetch-hub: wrote hub/tasks/co snapshots (" + coSnapshot.projects.length + " projects with COs)");

// Emit the address queries so fetch-outlook can reuse the live project list.
writeFileSync("data/raw/projects-index.json", JSON.stringify({ generatedAt: stamp, projects: projects.map((p) => ({ dealId: p.dealId, name: p.name, emailQuery: emailQuery(p.name) })) }, null, 2) + "\n");
