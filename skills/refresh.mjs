#!/usr/bin/env node
/**
 * refresh.mjs — regenerate the whole data layer + rebuild the portal in one command.
 *
 * Runs every pure transform in dependency order against the raw snapshots in data/raw/,
 * then inlines the fresh data into portal/index.html. It does NOT fetch from the HUB/
 * Outlook itself — the agent/Routine refreshes data/raw/*.json via MCP first (that's the
 * live step), then runs this. See RUNBOOK.md.
 *
 * Usage: node skills/refresh.mjs [--ref YYYY-MM-DD]
 */
import { execFileSync } from "node:child_process";

function arg(f, d){ const i=process.argv.indexOf(f); return i!==-1&&process.argv[i+1]?process.argv[i+1]:d; }
const ref = arg("--ref", null);
const refArgs = ref ? ["--ref", ref] : [];

const steps = [
  ["hub-project-aggregator", "skills/hub-project-aggregator/normalize.mjs", refArgs],
  ["email-consolidator (backfills client)", "skills/email-consolidator/consolidate.mjs", refArgs],
  ["daily-todo-generator", "skills/daily-todo-generator/generate.mjs", refArgs],
  ["payment-tracker", "skills/payment-tracker/track.mjs", refArgs],
  ["co-tracker", "skills/payment-tracker/co-tracker.mjs", []],
  ["weekly-update-drafter", "skills/weekly-update-drafter/draft.mjs", []],
  ["task-reminder-engine", "skills/task-reminder-engine/engine.mjs", []],
  ["portal-renderer (build)", "skills/portal-renderer/build.mjs", []],
];

let failed = 0;
for (const [name, script, extra] of steps){
  try {
    const out = execFileSync("node", [script, ...extra], { encoding: "utf8", stdio: ["ignore","pipe","pipe"] });
    process.stderr.write("✓ " + name + "\n");
    if (out && out.trim()) process.stderr.write("  " + out.trim().split("\n").join("\n  ") + "\n");
  } catch (e){
    failed++;
    process.stderr.write("✗ " + name + " — " + (e.stderr || e.message || e) + "\n");
  }
}
process.stderr.write(failed ? ("\nrefresh completed with " + failed + " failure(s)\n") : "\nrefresh complete — portal/index.html rebuilt\n");
process.exit(failed ? 1 : 0);
