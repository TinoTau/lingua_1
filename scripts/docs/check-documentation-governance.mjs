#!/usr/bin/env node
/**
 * Documentation governance gate (enhanced residual scope).
 *
 * Usage (repo root):
 *   node scripts/docs/check-documentation-governance.mjs
 * Or:
 *   npm run docs:check  (from electron_node/electron-node)
 *
 * Gate decision after residual backlog: ENHANCE_GATE
 * — fail on UNCLASSIFIED production-relevant residuals, UNINDEXED_CURRENT,
 *   living CRITICAL broken links; warn on unindexed acceptance packs /
 *   unresolved duplicate groups when residual CSVs present.
 * — do NOT warn on PACK_MEMBER orphans, historical state links, or scratch noise.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");

const ACCEPTANCE_TYPES = new Set([
  "Development",
  "Audit",
  "Test",
  "Regression",
  "Freeze",
  "Documentation",
]);

const CURRENT_AUTHORITIES = [
  "docs/current/INDEX.md",
  "docs/current/DOCUMENTATION_GOVERNANCE.md",
  "docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md",
  "docs/framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md",
  "docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md",
  "docs/tone-v2/Runtime_SSOT_Contract_Freeze.md",
  "docs/tone-v2/Lingua_Runtime_Evolution_Rule.md",
  "docs/tone-v2/FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md",
  "docs/tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md",
  "docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md",
  "docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md",
  "docs/tone-v2/Lexicon_Domain_Contract_Freeze_V1.md",
  "docs/fw-detector/freeze/FROZEN.md",
  "docs/fw-detector/ARCHITECTURE.md",
  "docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md",
  "docs/fw-detector/recall/DOMAIN_RECALL.md",
  "docs/fw-detector/assembly/FROZEN_V1_2.md",
  "docs/fw-detector/kenlm/KENLM_RUNTIME.md",
  "docs/fw-detector/INTERFACE_FREEZE.md",
  "docs/fw-detector/diagnostics/FROZEN.md",
];

const LIVING_CRITICAL_PREFIXES = [
  "docs/INDEX.md",
  "docs/current/",
  "docs/supporting/",
  "docs/framework_snapshots/",
  "docs/architecture/",
  "docs/operating/",
  "docs/acceptance/README.md",
  "docs/archive/INDEX.md",
  "docs/archive/README.md",
];

const RESIDUAL_PACK =
  "docs/acceptance/Documentation/2026-08-04_Documentation_Governance_Residual_Backlog_Closure";

function exists(rel) {
  return fs.existsSync(path.join(REPO, rel));
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      walk(full, acc);
    } else acc.push(full);
  }
  return acc;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function rel(abs) {
  return toPosix(path.relative(REPO, abs));
}

function collectMdLinks(text) {
  const out = [];
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const t = m[2].trim().split(/\s+/)[0].replace(/^<|>$/g, "");
    if (!t || /^https?:|^mailto:|^#/.test(t)) continue;
    if (t === "..." || t.includes("<") || t.includes("YYYY-MM-DD") || t.includes("<Type>"))
      continue;
    out.push(t);
  }
  return out;
}

function resolveLink(fromRel, link) {
  let clean = link.split("#")[0];
  if (!clean) return fromRel;
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* keep raw */
  }
  const fromDir = path.posix.dirname(fromRel);
  if (clean.startsWith("docs/") || clean.startsWith("electron_node/")) return clean;
  return toPosix(path.posix.normalize(path.posix.join(fromDir, clean)));
}

function frontmatterStatus(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return "";
  const sm = m[1].match(/^status:\s*(\S+)/m);
  return sm ? sm[1].trim() : "";
}

function isLivingCritical(relPath) {
  if (CURRENT_AUTHORITIES.includes(relPath)) return true;
  if (
    LIVING_CRITICAL_PREFIXES.some(
      (p) => relPath === p || (p.endsWith("/") && relPath.startsWith(p))
    )
  ) {
    return true;
  }
  return false;
}

function parseCsvFile(relPath) {
  if (!exists(relPath)) return [];
  const text = fs.readFileSync(path.join(REPO, relPath), "utf8").replace(/^\uFEFF/, "");
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsvLine(line);
    const o = {};
    headers.forEach((h, i) => (o[h] = cols[i] ?? ""));
    return o;
  });
}

function splitCsvLine(line) {
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

function main() {
  const hardFailures = [];
  const warnings = [];
  const informationalBacklog = [];

  informationalBacklog.push(
    "GATE_SCOPE:ENHANCE_GATE — living CRITICAL + residual CSV hard gates; historical/PACK_MEMBER/scratch are informational only"
  );

  const required = [
    "docs/INDEX.md",
    "docs/current/INDEX.md",
    "docs/current/DOCUMENTATION_GOVERNANCE.md",
    "docs/supporting/INDEX.md",
    "docs/architecture/INDEX.md",
    "docs/architecture/adr/ADR-0001-Adopt-Repository-Documentation-Governance.md",
    "docs/acceptance/README.md",
    "docs/archive/INDEX.md",
    "docs/operating/INDEX.md",
    "docs/framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md",
  ];
  for (const r of required) {
    if (!exists(r)) hardFailures.push(`MISSING_REQUIRED:${r}`);
  }

  for (const a of CURRENT_AUTHORITIES) {
    if (!exists(a)) hardFailures.push(`MISSING_CURRENT_AUTHORITY:${a}`);
  }

  const badNameRe = /(?:\s\(1\)|\s\(2\)|copy|final2)/i;
  for (const abs of walk(path.join(REPO, "docs"))) {
    const name = path.basename(abs);
    if (badNameRe.test(name)) hardFailures.push(`FORBIDDEN_FILENAME:${rel(abs)}`);
  }

  for (const name of fs.readdirSync(REPO)) {
    const full = path.join(REPO, name);
    if (!fs.statSync(full).isFile()) continue;
    if (/FW_Repair_V4_.*\.(md|csv|json)$/i.test(name) || /_Audit_.*\.md$/i.test(name)) {
      hardFailures.push(`ROOT_ACCEPTANCE_REPORT:${name}`);
    }
  }

  const acceptanceRoot = path.join(REPO, "docs", "acceptance");
  if (fs.existsSync(acceptanceRoot)) {
    for (const typeEnt of fs.readdirSync(acceptanceRoot, { withFileTypes: true })) {
      if (!typeEnt.isDirectory()) continue;
      if (!ACCEPTANCE_TYPES.has(typeEnt.name)) {
        warnings.push(`NONSTANDARD_ACCEPTANCE_TYPE_DIR:docs/acceptance/${typeEnt.name}`);
        continue;
      }
      const typeDir = path.join(acceptanceRoot, typeEnt.name);
      for (const packEnt of fs.readdirSync(typeDir, { withFileTypes: true })) {
        if (!packEnt.isDirectory()) continue;
        const packRel = `docs/acceptance/${typeEnt.name}/${packEnt.name}`;
        if (!/^\d{4}-\d{2}-\d{2}_/.test(packEnt.name)) {
          warnings.push(`ACCEPTANCE_PACK_NAME:${packRel}`);
          continue;
        }
        const packDir = path.join(typeDir, packEnt.name);
        for (const need of ["README.md", "report.md", "summary.json"]) {
          if (!fs.existsSync(path.join(packDir, need))) {
            if (typeEnt.name === "Documentation" || typeEnt.name === "Audit") {
              hardFailures.push(`ACCEPTANCE_PACK_MISSING:${packRel}/${need}`);
            } else {
              warnings.push(`ACCEPTANCE_PACK_MISSING:${packRel}/${need}`);
            }
          }
        }
        const summaryPath = path.join(packDir, "summary.json");
        if (fs.existsSync(summaryPath)) {
          try {
            const s = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
            if (s.status === "CURRENT_SSOT" || s.documentStatus === "CURRENT_SSOT") {
              hardFailures.push(`ACCEPTANCE_MARKED_CURRENT:${packRel}`);
            }
          } catch {
            warnings.push(`ACCEPTANCE_SUMMARY_UNPARSEABLE:${packRel}`);
          }
        }
      }
    }
  }

  // Living critical broken links (skip HISTORICAL/SUPERSEDED/RETIRED frontmatter)
  for (const abs of walk(path.join(REPO, "docs"))) {
    const r = rel(abs);
    if (!r.endsWith(".md")) continue;
    if (!isLivingCritical(r)) continue;
    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const st = frontmatterStatus(text);
    if (["HISTORICAL", "SUPERSEDED", "RETIRED", "SCRATCH", "EXPERIMENTAL"].includes(st)) {
      continue;
    }
    for (const link of collectMdLinks(text)) {
      const resolved = resolveLink(r, link);
      if (
        exists(resolved) ||
        exists(resolved.replace(/\/$/, "") + "/README.md") ||
        exists(resolved + "/README.md")
      ) {
        continue;
      }
      hardFailures.push(`BROKEN_CRITICAL_LINK:${r} -> ${link} (${resolved})`);
    }
  }

  const supportingIndex = path.join(REPO, "docs/supporting/INDEX.md");
  if (fs.existsSync(supportingIndex)) {
    const t = fs.readFileSync(supportingIndex, "utf8");
    if (
      /\bSole Authority\b/i.test(t) &&
      !/不是\s*Sole Authority|不得成为|不得.*Sole Authority|非 Supporting 权威|指针（非 Supporting/i.test(
        t
      )
    ) {
      warnings.push("SUPPORTING_INDEX_MAY_CLAIM_AUTHORITY");
    }
  }

  const snap = "docs/framework_snapshots/FW_V4_FREEZE_2026_08_03";
  for (const f of ["FRAMEWORK_FREEZE_SUMMARY.md", "snapshot.json", "13_Recovery_Guide.md"]) {
    if (!exists(`${snap}/${f}`)) hardFailures.push(`SNAPSHOT_MISSING:${snap}/${f}`);
  }

  // Residual CSV hard/warn gates (ENHANCE_GATE)
  const unc = parseCsvFile(`${RESIDUAL_PACK}/unclassified_resolution.csv`);
  if (unc.length) {
    const left = unc.filter((r) => r.finalClassification === "UNCLASSIFIED" || !r.finalClassification);
    if (left.length) {
      for (const r of left) hardFailures.push(`UNCLASSIFIED_REMAINING:${r.path}`);
    } else {
      informationalBacklog.push(`UNCLASSIFIED_CLOSED:${unc.length}`);
    }
  } else {
    warnings.push("RESIDUAL_UNCLASSIFIED_CSV_MISSING");
  }

  const dups = parseCsvFile(`${RESIDUAL_PACK}/duplicate_resolution.csv`);
  if (dups.length) {
    const unresolved = dups.filter(
      (r) => r.status !== "RESOLVED" || String(r.duplicateType).includes("MANUAL_REVIEW")
    );
    if (unresolved.length) {
      for (const r of unresolved.slice(0, 20)) {
        warnings.push(`UNRESOLVED_DUPLICATE_GROUP:${r.duplicateGroupId}`);
      }
    } else {
      informationalBacklog.push(`DUPLICATE_GROUPS_RESOLVED:${dups.length}`);
    }
  }

  const orphans = parseCsvFile(`${RESIDUAL_PACK}/orphan_triage.csv`);
  if (orphans.length) {
    const unindexedCurrent = orphans.filter((r) => r.finalOrphanClass === "UNINDEXED_CURRENT");
    for (const r of unindexedCurrent) hardFailures.push(`UNINDEXED_CURRENT:${r.path}`);
    const possible = orphans.filter(
      (r) =>
        r.finalOrphanClass === "POSSIBLE_CURRENT_OR_SUPPORTING" &&
        !String(r.status).startsWith("RESOLVED")
    );
    for (const r of possible) hardFailures.push(`POSSIBLE_CURRENT_UNRESOLVED:${r.path}`);
    const packMembers = orphans.filter((r) => r.finalOrphanClass === "PACK_MEMBER").length;
    const unindexedPacks = orphans.filter((r) => r.finalOrphanClass === "UNINDEXED_PACK");
    for (const r of unindexedPacks.slice(0, 20)) {
      warnings.push(`UNINDEXED_ACCEPTANCE_PACK:${r.packRoot || r.path}`);
    }
    informationalBacklog.push(`ORPHAN_PACK_MEMBER_COUNT:${packMembers}`);
    informationalBacklog.push(`ORPHAN_TRIAGED_TOTAL:${orphans.length}`);
  }

  const links = parseCsvFile(`${RESIDUAL_PACK}/broken_link_policy_results.csv`);
  if (links.length) {
    const openCrit = links.filter(
      (r) => r.finalLinkClass === "CRITICAL" && r.status === "OPEN"
    );
    for (const r of openCrit) {
      hardFailures.push(`RESIDUAL_CRITICAL_LINK_OPEN:${r.sourcePath} -> ${r.linkText}`);
    }
    const missingEvidence = links.filter(
      (r) =>
        r.finalLinkClass === "ACCEPTANCE_LOCAL" &&
        (r.status === "OPEN" || /^MISSING_EVIDENCE$/i.test(r.status))
    );
    for (const r of missingEvidence) {
      hardFailures.push(`ACCEPTANCE_MISSING_UNIQUE_EVIDENCE:${r.sourcePath} -> ${r.linkText}`);
    }
    const closedNoEvidence = links.filter((r) =>
      /CLOSED_NO_UNIQUE_EVIDENCE/i.test(r.status)
    ).length;
    if (closedNoEvidence) {
      informationalBacklog.push(
        `ACCEPTANCE_LOCAL_CLOSED_WITHOUT_UNIQUE_EVIDENCE_CLAIM:${closedNoEvidence}`
      );
    }
    const hist = links.filter((r) => r.finalLinkClass === "HISTORICAL_STATE_LINK").length;
    informationalBacklog.push(`HISTORICAL_STATE_LINKS:${hist}`);
  }

  const report = {
    ok: hardFailures.length === 0,
    gateScopeDecision: "ENHANCE_GATE",
    hardFailures,
    warnings: warnings.slice(0, 200),
    informationalBacklog: informationalBacklog.slice(0, 200),
    failureCount: hardFailures.length,
    warningCount: warnings.length,
    informationalCount: informationalBacklog.length,
    // backward compatible aliases
    failures: hardFailures,
  };

  const outTargets = [
    RESIDUAL_PACK,
    "docs/acceptance/Documentation/2026-08-03_Docs_Repository_Governance_and_Consolidation",
  ];
  for (const outDir of outTargets) {
    if (!exists(path.dirname(outDir))) continue;
    fs.mkdirSync(path.join(REPO, outDir), { recursive: true });
    fs.writeFileSync(
      path.join(REPO, outDir, "docs_check_result.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8"
    );
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(hardFailures.length ? 1 : 0);
}

main();
