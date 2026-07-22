#!/usr/bin/env node
/**
 * fetch-all.mjs — CI live-pull orchestrator. Runs the HUB + Outlook fetchers, each isolated
 * so one failing source never breaks the other (or the site — the last-good snapshot stays).
 * Then the workflow runs `node skills/refresh.mjs` to rebuild the portal.
 */
import { execFileSync } from "node:child_process";

function run(script) {
  try {
    execFileSync("node", [script], { stdio: "inherit", env: process.env });
    return true;
  } catch (e) {
    process.stderr.write("fetch-all: " + script + " failed — keeping last-good snapshot.\n");
    return false;
  }
}

run("scripts/fetch-hub.mjs");
run("scripts/fetch-outlook.mjs");
process.stderr.write("fetch-all: done (sources with missing secrets were skipped).\n");
