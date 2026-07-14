#!/usr/bin/env node
/**
 * portal-renderer / build.mjs
 *
 * Inlines the latest data/projects.json into portal/index.html between the
 * <!--APM_DATA_START--> / <!--APM_DATA_END--> markers, so the portal works
 * standalone (offline fallback) while staying a single hostable file. When
 * served with data/projects.json alongside, the portal also live-fetches it
 * on pull-to-refresh for freshness.
 *
 * Usage: node skills/portal-renderer/build.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const HTML = "portal/index.html";
const DATA = "data/projects.json";

const data = readFileSync(DATA, "utf8").trim();
let html = readFileSync(HTML, "utf8");

const start = "<!--APM_DATA_START-->";
const end = "<!--APM_DATA_END-->";
const block =
  start +
  '\n<script id="apm-data" type="application/json">\n' +
  data +
  "\n</script>\n" +
  end;

const re = new RegExp(start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?" + end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
if (!re.test(html)) {
  console.error("ERROR: data markers not found in " + HTML);
  process.exit(1);
}
html = html.replace(re, block);
writeFileSync(HTML, html);
console.error("Inlined " + DATA + " into " + HTML + " (" + data.length + " bytes)");
