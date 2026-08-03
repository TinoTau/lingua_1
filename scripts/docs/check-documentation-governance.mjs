#!/usr/bin/env node
/**
 * Documentation governance gate.
 *
 * Usage (repo root):
 *   node scripts/docs/check-documentation-governance.mjs
 * Or:
 *   npm run docs:check  (from electron_node/electron-node)
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

const CRITICAL_PREFIXES = [
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

function isCritical(relPath) {
  return (
    CRITICAL_PREFIXES.some(
      (p) => relPath === p || (p.endsWith("/") && relPath.startsWith(p))
    ) || CURRENT_AUTHORITIES.includes(relPath)
  );
}

function main() {
  const failures = [];
  const warnings = [];

  // Required governance files
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
    if (!exists(r)) failures.push(`MISSING_REQUIRED:${r}`);
  }

  // CURRENT authorities reachable
  for (const a of CURRENT_AUTHORITIES) {
    if (!exists(a)) failures.push(`MISSING_CURRENT_AUTHORITY:${a}`);
  }

  // Forbidden filename suffixes under docs/
  const badNameRe = /(?:\s\(1\)|\s\(2\)|copy|final2)/i;
  for (const abs of walk(path.join(REPO, "docs"))) {
    const name = path.basename(abs);
    if (badNameRe.test(name)) {
      failures.push(`FORBIDDEN_FILENAME:${rel(abs)}`);
    }
  }

  // Root-level Acceptance-like reports
  for (const abs of fs.readdirSync(REPO)) {
    const full = path.join(REPO, abs);
    if (!fs.statSync(full).isFile()) continue;
    if (/FW_Repair_V4_.*\.(md|csv|json)$/i.test(abs) || /_Audit_.*\.md$/i.test(abs)) {
      failures.push(`ROOT_ACCEPTANCE_REPORT:${abs}`);
    }
  }

  // Acceptance pack contract for dated dirs
  const acceptanceRoot = path.join(REPO, "docs", "acceptance");
  if (fs.existsSync(acceptanceRoot)) {
    for (const typeEnt of fs.readdirSync(acceptanceRoot, { withFileTypes: true })) {
      if (!typeEnt.isDirectory()) continue;
      if (typeEnt.name === "node_modules") continue;
      // allow README at acceptance root files
      if (!ACCEPTANCE_TYPES.has(typeEnt.name)) {
        // legacy non-typed dirs under acceptance are warning
        if (["Development", "Audit", "Test", "Regression", "Freeze", "Documentation"].includes(typeEnt.name))
          continue;
        warnings.push(`NONSTANDARD_ACCEPTANCE_TYPE_DIR:docs/acceptance/${typeEnt.name}`);
        continue;
      }
      const typeDir = path.join(acceptanceRoot, typeEnt.name);
      for (const packEnt of fs.readdirSync(typeDir, { withFileTypes: true })) {
        if (!packEnt.isDirectory()) continue;
        const packName = packEnt.name;
        const packRel = `docs/acceptance/${typeEnt.name}/${packName}`;
        if (!/^\d{4}-\d{2}-\d{2}_/.test(packName)) {
          // allow legacy Freeze subdirs without date prefix as warning
          warnings.push(`ACCEPTANCE_PACK_NAME:${packRel}`);
          continue;
        }
        const packDir = path.join(typeDir, packName);
        for (const need of ["README.md", "report.md", "summary.json"]) {
          if (!fs.existsSync(path.join(packDir, need))) {
            // Documentation/Audit packs must have them; warn for incomplete legacy
            if (typeEnt.name === "Documentation" || typeEnt.name === "Audit") {
              failures.push(`ACCEPTANCE_PACK_MISSING:${packRel}/${need}`);
            } else {
              warnings.push(`ACCEPTANCE_PACK_MISSING:${packRel}/${need}`);
            }
          }
        }
        // Acceptance must not claim CURRENT_SSOT in summary
        const summaryPath = path.join(packDir, "summary.json");
        if (fs.existsSync(summaryPath)) {
          try {
            const s = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
            if (s.status === "CURRENT_SSOT" || s.documentStatus === "CURRENT_SSOT") {
              failures.push(`ACCEPTANCE_MARKED_CURRENT:${packRel}`);
            }
          } catch {
            warnings.push(`ACCEPTANCE_SUMMARY_UNPARSEABLE:${packRel}`);
          }
        }
      }
    }
  }

  // Critical broken links
  const criticalFiles = [];
  for (const abs of walk(path.join(REPO, "docs"))) {
    const r = rel(abs);
    if (!r.endsWith(".md")) continue;
    if (!isCritical(r)) continue;
    criticalFiles.push(r);
  }
  for (const r of criticalFiles) {
    let text;
    try {
      text = fs.readFileSync(path.join(REPO, r), "utf8");
    } catch {
      continue;
    }
    for (const link of collectMdLinks(text)) {
      const resolved = resolveLink(r, link);
      if (!exists(resolved)) {
        // allow missing trailing slash dirs if README exists
        if (exists(resolved.replace(/\/$/, "") + "/README.md")) continue;
        if (exists(resolved + "/README.md")) continue;
        failures.push(`BROKEN_CRITICAL_LINK:${r} -> ${link} (${resolved})`);
      }
    }
  }

  // Dual CURRENT claim heuristic: supporting INDEX should not label rows as sole authority
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

  // Snapshot pack presence
  const snap = "docs/framework_snapshots/FW_V4_FREEZE_2026_08_03";
  for (const f of [
    "FRAMEWORK_FREEZE_SUMMARY.md",
    "snapshot.json",
    "13_Recovery_Guide.md",
  ]) {
    if (!exists(`${snap}/${f}`)) failures.push(`SNAPSHOT_MISSING:${snap}/${f}`);
  }

  const report = {
    ok: failures.length === 0,
    failureCount: failures.length,
    warningCount: warnings.length,
    failures,
    warnings: warnings.slice(0, 200),
  };

  const outDir = path.join(
    REPO,
    "docs/acceptance/Documentation/2026-08-03_Docs_Repository_Governance_and_Consolidation"
  );
  if (fs.existsSync(path.dirname(outDir))) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "docs_check_result.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8"
    );
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main();
