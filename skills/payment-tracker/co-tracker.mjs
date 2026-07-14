#!/usr/bin/env node
/**
 * payment-tracker / co-tracker.mjs
 *
 * Pure transform → data/changeorders.json (the portal's Changes tab).
 * From per-project change orders (hub_get_change_order_costs: sold/cost), computes
 * markup % and flags any CO below the SOP's 100%-minimum markup (A9: below 100%
 * requires management approval). De-dups the API's repeated rows.
 *
 * NOTE: the HUB cost endpoint does not expose CO lifecycle status
 * (Draft/Pending Client/Approved/Paid), so this tracks VALUE + MARKUP, not status.
 *
 * Usage: node co-tracker.mjs [--in data/raw/co-snapshot.json] [--out data/changeorders.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function arg(f, d){ const i=process.argv.indexOf(f); return i!==-1&&process.argv[i+1]?process.argv[i+1]:d; }
const IN = arg("--in","data/raw/co-snapshot.json");
const OUT = arg("--out","data/changeorders.json");
const round2 = (n)=> Math.round(n*100)/100;

export function trackCOs(snap){
  const projects = (snap.projects || []).map(function(p){
    const seen = {};
    const cos = [];
    (p.changeOrders || []).forEach(function(c){
      const key = c.title + "|" + c.sold + "|" + c.cost;
      if(seen[key]) return; seen[key] = true;
      const profit = round2((c.sold||0) - (c.cost||0));
      const markup = c.cost > 0 ? Math.round(((c.sold - c.cost)/c.cost)*100) : (c.sold>0 ? null : 0);
      cos.push({ title: c.title, sold: round2(c.sold||0), cost: round2(c.cost||0), profit: profit,
        markupPct: markup, belowMarkup: markup != null && markup < 100 });
    });
    const totals = cos.reduce(function(a,c){ a.sold+=c.sold; a.cost+=c.cost; a.profit+=c.profit; return a; }, {sold:0,cost:0,profit:0});
    return {
      dealId: p.dealId, name: p.name, count: cos.length,
      totals: { sold: round2(totals.sold), cost: round2(totals.cost), profit: round2(totals.profit) },
      belowMarkupCount: cos.filter(function(c){ return c.belowMarkup; }).length,
      changeOrders: cos.sort(function(a,b){ return b.sold - a.sold; }),
    };
  });
  const summary = projects.reduce(function(a,p){ a.totalSold+=p.totals.sold; a.totalProfit+=p.totals.profit; a.belowMarkup+=p.belowMarkupCount; a.count+=p.count; return a; },
    { count:0, totalSold:0, totalProfit:0, belowMarkup:0 });
  summary.totalSold = round2(summary.totalSold); summary.totalProfit = round2(summary.totalProfit);
  return { generatedAt: snap.generatedAt || null, referenceDate: snap.referenceDate || null, summary: summary, projects: projects };
}

if (import.meta.url === `file://${process.argv[1]}`){
  const snap = JSON.parse(readFileSync(IN, "utf8"));
  const out = trackCOs(snap);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const s = out.summary;
  console.error("changeorders.json → " + s.count + " COs across " + out.projects.length + " projects · sold $" + s.totalSold.toLocaleString() + " · profit $" + s.totalProfit.toLocaleString() + " · " + s.belowMarkup + " below 100% markup");
}
