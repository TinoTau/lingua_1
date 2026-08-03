#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = split(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = split(line);
    const o = {};
    headers.forEach((h, i) => (o[h] = cols[i] ?? ""));
    return o;
  });
}
function split(line) {
  const cols = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      cols.push(cur);
      cur = "";
    } else cur += ch;
  }
  cols.push(cur);
  return cols;
}

const p =
  "docs/acceptance/Documentation/2026-08-04_Documentation_Governance_Residual_Backlog_Closure";
const u = parseCsv(fs.readFileSync(`${p}/unclassified_resolution.csv`, "utf8"));
console.log("UNCLASSIFIED resolutions:");
for (const r of u) console.log(`${r.path} => ${r.finalClassification} | ${r.action} | ${r.status}`);
const b = parseCsv(fs.readFileSync(`${p}/broken_link_policy_results.csv`, "utf8")).filter(
  (r) => r.finalLinkClass === "CRITICAL" && r.status === "OPEN"
);
console.log("\nOPEN CRITICAL", b.length);
for (const r of b) console.log(`${r.sourcePath} -> ${r.linkText} :: ${r.canonicalTarget}`);
