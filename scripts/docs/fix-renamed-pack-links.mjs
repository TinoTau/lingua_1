#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT =
  "docs/acceptance/Documentation/2026-08-04_Documentation_Governance_Residual_Backlog_Closure";

const replacements = [
  {
    files: [
      "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/report.md",
      "docs/acceptance/Freeze/FW_Repair_V4_Recall_Candidate_Recovery_Development_Report_2026_08_03.md",
    ],
    from: "docs/acceptance/Freeze/recall_candidate_recovery_2026_08_03/",
    to: "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/",
  },
  {
    files: [
      "docs/acceptance/Freeze/2026-08-03_Recall_Query_Builder_Audit/report.md",
      "docs/acceptance/Freeze/FW_Repair_V4_Recall_Query_Builder_Audit_2026_08_03.md",
    ],
    from: "docs/acceptance/Freeze/recall_query_builder_audit_2026_08_03/",
    to: "docs/acceptance/Freeze/2026-08-03_Recall_Query_Builder_Audit/",
  },
];

const cleanup = [];
for (const r of replacements) {
  for (const f of r.files) {
    const abs = path.join(REPO, f);
    if (!fs.existsSync(abs)) continue;
    let t = fs.readFileSync(abs, "utf8");
    if (!t.includes(r.from)) continue;
    t = t.split(r.from).join(r.to);
    fs.writeFileSync(abs, t, "utf8");
    cleanup.push({
      originalPath: f,
      action: "FIX_ACCEPTANCE_LOCAL_LINK",
      newPath: r.to,
      reason: `Update renamed pack pointer ${r.from} -> ${r.to}`,
      status: "DONE",
    });
  }
}

// update broken_link_policy_results for these
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = split(lines[0]);
  return {
    headers,
    rows: lines.slice(1).filter(Boolean).map((line) => {
      const cols = split(line);
      const o = {};
      headers.forEach((h, i) => (o[h] = cols[i] ?? ""));
      return o;
    }),
  };
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
function writeCsv(rel, headers, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  fs.writeFileSync(path.join(REPO, rel), lines.join("\n") + "\n", "utf8");
}

const linkFile = `${OUT}/broken_link_policy_results.csv`;
const parsed = parseCsv(fs.readFileSync(path.join(REPO, linkFile), "utf8"));
for (const row of parsed.rows) {
  if (
    row.linkText.includes("recall_candidate_recovery_2026_08_03") ||
    row.linkText.includes("recall_query_builder_audit_2026_08_03")
  ) {
    row.action = "POINT_CANONICAL";
    row.status = "CLOSED";
    row.reason = "Updated source markdown to renamed dated Freeze pack path";
    if (row.linkText.includes("recall_candidate_recovery")) {
      row.canonicalTarget =
        "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/";
    } else {
      row.canonicalTarget =
        "docs/acceptance/Freeze/2026-08-03_Recall_Query_Builder_Audit/";
    }
  }
}
writeCsv(linkFile, parsed.headers, parsed.rows);

const cleanupFile = `${OUT}/cleanup_execution.csv`;
const prev = parseCsv(fs.readFileSync(path.join(REPO, cleanupFile), "utf8"));
writeCsv(cleanupFile, prev.headers, [...prev.rows, ...cleanup]);
console.log(JSON.stringify(cleanup, null, 2));
