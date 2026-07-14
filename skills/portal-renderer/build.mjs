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
let html = readFileSync(HTML, "utf8");

function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function inline(file, startTag, endTag, id){
  const data = readFileSync(file, "utf8").trim();
  const block = startTag + '\n<script id="' + id + '" type="application/json">\n' + data + "\n</script>\n" + endTag;
  const re = new RegExp(esc(startTag) + "[\\s\\S]*?" + esc(endTag));
  if (!re.test(html)) { console.error("ERROR: markers " + startTag + " not found in " + HTML); process.exit(1); }
  html = html.replace(re, block);
  console.error("Inlined " + file + " (" + data.length + " bytes)");
}

inline("data/projects.json", "<!--APM_DATA_START-->", "<!--APM_DATA_END-->", "apm-data");
inline("data/today.json", "<!--APM_TODAY_START-->", "<!--APM_TODAY_END-->", "apm-today");
inline("data/emails.json", "<!--APM_EMAILS_START-->", "<!--APM_EMAILS_END-->", "apm-emails");
inline("data/payments.json", "<!--APM_PAYMENTS_START-->", "<!--APM_PAYMENTS_END-->", "apm-payments");
writeFileSync(HTML, html);
