#!/usr/bin/env node
/**
 * hub-project-aggregator / normalize.mjs
 *
 * Pure transform: reads a raw HUB snapshot (assembled by the skill runner from
 * MCP calls) and emits the normalized projects.json the portal consumes.
 *
 * Usage:
 *   node normalize.mjs [--in data/raw/hub-snapshot.json] [--out data/projects.json] [--ref YYYY-MM-DD]
 *
 * No network, no MCP — the runner makes the MCP calls, writes the snapshot,
 * then invokes this. That keeps the transform deterministic and unit-testable.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const IN = arg("--in", "data/raw/hub-snapshot.json");
const OUT = arg("--out", "data/projects.json");

const round2 = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);
const dayMs = 86400000;

function daysBetween(fromISO, toISO) {
  const a = Date.parse(fromISO);
  const b = Date.parse(toISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / dayMs);
}

export function normalize(snapshot, refDateISO) {
  const ref = refDateISO || snapshot.referenceDate || new Date().toISOString().slice(0, 10);
  const pmUserId = snapshot.pmUserId || snapshot?.hub?.pmUserId || null;
  const milestoneWindow = snapshot?.settings?.milestone?.upcomingWindowDays ?? 7;

  // Index the cross-project task signals by dealId.
  const overdueByDeal = {};
  for (const p of snapshot.overdue?.byProject || []) {
    overdueByDeal[p.dealId] = p.overdueCount || 0;
  }
  const dueWindowByDeal = {};
  for (const t of snapshot.todoList?.todos || []) {
    const key = t.dealId || t.projectId;
    if (!key) continue;
    dueWindowByDeal[key] = dueWindowByDeal[key] || { today: 0, sevenDay: 0, nextDue: null };
    if (t.tab === "Today") dueWindowByDeal[key].today++;
    if (t.tab === "7 Days") dueWindowByDeal[key].sevenDay++;
    const due = t.endDate || t.dueDate;
    if (due && (!dueWindowByDeal[key].nextDue || Date.parse(due) < Date.parse(dueWindowByDeal[key].nextDue))) {
      dueWindowByDeal[key].nextDue = due;
    }
  }

  const projects = (snapshot.projects || []).map((p) => {
    const ov = p.overview || {};
    const bal = ov.balance || {};
    const ms = bal.nextMilestone || null;
    const breakdown = Object.fromEntries((bal.incomeBreakdown || []).map((b) => [b.label, b.amount]));

    const overdueCount = overdueByDeal[p.dealId] ?? 0;
    const win = dueWindowByDeal[p.dealId] || { today: 0, sevenDay: 0, nextDue: null };
    const balance = round2(bal.paymentsBalance);

    // Milestone timing
    let milestoneStatus = "none";
    let milestoneDaysOverdue = null;
    if (ms) {
      if (!ms.date) {
        milestoneStatus = balance > 0 ? "unscheduled" : "none";
      } else {
        const d = daysBetween(ref, ms.date); // positive => ref is after milestone date
        if (d > 0 && balance > 0) {
          milestoneStatus = "overdue";
          milestoneDaysOverdue = d;
        } else if (d >= -milestoneWindow && balance > 0) {
          milestoneStatus = "upcoming";
        } else {
          milestoneStatus = "scheduled";
        }
      }
    }

    // Health (see config/settings.json health rules)
    let health = "green";
    if (overdueCount > 0 || milestoneStatus === "overdue") {
      health = "red";
    } else if (win.today > 0 || win.sevenDay > 0 || milestoneStatus === "upcoming" || milestoneStatus === "unscheduled") {
      health = "yellow";
    }

    const sh = ov.stakeholders || {};
    return {
      id: p.id,
      dealId: p.dealId,
      name: p.name,
      address: p.name, // project name is the street address at Chapter
      client: null, // TODO: sourced from proposal/deal by email-consolidator (not in overview)
      role: p.role || (sh.projectManager?.id === pmUserId ? "pm" : "other"),
      isMyProject: sh.projectManager?.id === pmUserId,
      phase: p.phase || null, // filled once task board is joined (daily-todo-generator)
      health,
      financials: {
        income: round2(bal.income),
        proposal: round2(breakdown["Proposal"] ?? null),
        changeOrders: round2(breakdown["Change Orders"] ?? 0),
        paymentsReceived: round2(bal.paymentsReceived),
        paymentsBalance: balance,
        nextMilestone: ms
          ? {
              label: ms.label,
              amount: round2(Number(ms.amount)),
              percent: ms.percent ?? null,
              date: ms.date || null,
              status: milestoneStatus,
              daysOverdue: milestoneDaysOverdue,
            }
          : null,
      },
      todos: {
        overdue: overdueCount,
        dueToday: win.today,
        dueThisWeek: win.sevenDay,
        nextDueDate: win.nextDue,
      },
      stakeholders: {
        projectManager: sh.projectManager?.name || null,
        designer: sh.designer?.name || null,
        architect: sh.architect?.name || null,
        administrator: sh.administrator?.name || null,
      },
    };
  });

  // Portfolio rollups for the home screen header.
  const summary = {
    totalProjects: projects.length,
    byHealth: { red: 0, yellow: 0, green: 0 },
    totalOutstanding: 0,
    overdueMilestones: 0,
    overdueTasks: 0,
  };
  for (const p of projects) {
    summary.byHealth[p.health]++;
    summary.totalOutstanding += p.financials.paymentsBalance || 0;
    if (p.financials.nextMilestone?.status === "overdue") summary.overdueMilestones++;
    summary.overdueTasks += p.todos.overdue || 0;
  }
  summary.totalOutstanding = round2(summary.totalOutstanding);

  return {
    generatedAt: snapshot.generatedAt || null,
    referenceDate: ref,
    source: "the HUB by Chapter (live) + config",
    summary,
    projects,
  };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const snapshot = JSON.parse(readFileSync(IN, "utf8"));
  const out = normalize(snapshot, arg("--ref", null));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const s = out.summary;
  console.error(
    `normalized ${s.totalProjects} projects → ${OUT}\n` +
      `  health: ${s.byHealth.red} red / ${s.byHealth.yellow} yellow / ${s.byHealth.green} green\n` +
      `  outstanding: $${s.totalOutstanding.toLocaleString()} | overdue milestones: ${s.overdueMilestones} | overdue tasks: ${s.overdueTasks}`
  );
}
