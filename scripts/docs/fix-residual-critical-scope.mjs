#!/usr/bin/env node
/**
 * Fix residual "critical" false scope: dated troubleshooting incident docs
 * are HISTORICAL, not living Operating Guides.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT =
  "docs/acceptance/Documentation/2026-08-04_Documentation_Governance_Residual_Backlog_Closure";

const HISTORICAL_SOURCES = [
  "docs/troubleshooting/SERVICE_CONFIG_UPDATE_2026_01_19.md",
  "docs/troubleshooting/SERVICE_DISCOVERY_FLOW_2026_01_19.md",
  "docs/troubleshooting/TYPESCRIPT_COMPILATION_FIX_2026_01_19.md",
  "docs/troubleshooting/UI_SERVICE_DISPLAY_FIX_2026_01_19.md",
  "docs/troubleshooting/UTTERANCE_SEGMENTATION_AND_CONTEXT_MERGE_REQUIREMENT.md",
  "docs/troubleshooting/长句前半句丢失_turn亲和写入时机修复_2026_01.md",
];

function ensureHistorical(rel) {
  const abs = path.join(REPO, rel);
  if (!fs.existsSync(abs)) return false;
  let text = fs.readFileSync(abs, "utf8");
  if (/^---\n[\s\S]*?status:\s*HISTORICAL/m.test(text)) return true;
  if (text.startsWith("---\n")) {
    text = text.replace(/^---\n/, "---\nstatus: HISTORICAL\n");
  } else {
    text =
      `---\nstatus: HISTORICAL\nhistorical_baseline: pre-FW_V4\nreason: Dated troubleshooting incident report; paths may refer to repository state at that date.\nclassified_by: 2026-08-04_Documentation_Governance_Residual_Backlog_Closure\n---\n\n` +
      text;
  }
  // banner
  if (!/Historical document; paths may refer/i.test(text.slice(0, 600))) {
    text = text.replace(
      /^---\n([\s\S]*?)\n---\n/,
      (m) =>
        m +
        "\n> Historical document; paths may refer to repository state at that date.\n"
    );
  }
  fs.writeFileSync(abs, text, "utf8");
  return true;
}

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

const cleanup = [];
for (const rel of HISTORICAL_SOURCES) {
  const ok = ensureHistorical(rel);
  cleanup.push({
    originalPath: rel,
    action: "ADD_STATUS_HEADER",
    newPath: rel,
    reason: "Demote dated troubleshooting incident to HISTORICAL; links become HISTORICAL_STATE_LINK",
    status: ok ? "DONE" : "SKIP",
  });
}

const linkPath = `${OUT}/broken_link_policy_results.csv`;
const { headers, rows } = parseCsv(fs.readFileSync(path.join(REPO, linkPath), "utf8"));
const histSet = new Set(HISTORICAL_SOURCES);
for (const r of rows) {
  if (histSet.has(r.sourcePath) && r.finalLinkClass === "CRITICAL") {
    r.finalLinkClass = "HISTORICAL_STATE_LINK";
    r.sourceClassification = "HISTORICAL";
    r.action = "KEEP_WITH_HISTORICAL_POLICY";
    r.reason =
      "Source demoted to HISTORICAL dated incident report; broken paths accepted as historical state links";
    r.status = "ACCEPTED_DEBT";
  }
}
writeCsv(linkPath, headers, rows);

const cleanupPath = `${OUT}/cleanup_execution.csv`;
const prev = parseCsv(fs.readFileSync(path.join(REPO, cleanupPath), "utf8"));
writeCsv(cleanupPath, prev.headers, [...prev.rows, ...cleanup]);

const openCritical = rows.filter(
  (r) => r.finalLinkClass === "CRITICAL" && r.status === "OPEN"
).length;
const metrics = JSON.parse(
  fs.readFileSync(path.join(REPO, OUT, "_metrics.json"), "utf8")
);
metrics.after.criticalBrokenLinks = openCritical;
metrics.after.historicalBrokenLinks = rows.filter(
  (r) => r.finalLinkClass === "HISTORICAL_STATE_LINK"
).length;
metrics.after.troubleshootingDemotedToHistorical = HISTORICAL_SOURCES.length;
fs.writeFileSync(
  path.join(REPO, OUT, "_metrics.json"),
  JSON.stringify(metrics, null, 2) + "\n"
);
console.log(JSON.stringify({ openCritical, metricsAfter: metrics.after }, null, 2));
