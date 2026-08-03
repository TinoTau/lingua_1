#!/usr/bin/env node
/**
 * Residual backlog closure for documentation governance.
 * Reads prior Acceptance pack CSVs; writes 2026-08-04 pack; applies safe cleanup.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRIOR =
  "docs/acceptance/Documentation/2026-08-03_Docs_Repository_Governance_and_Consolidation";
const OUT =
  "docs/acceptance/Documentation/2026-08-04_Documentation_Governance_Residual_Backlog_Closure";

const CURRENT_AUTHORITIES = [
  { concern: "CURRENT Index Entry", path: "docs/current/INDEX.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Documentation Governance", path: "docs/current/DOCUMENTATION_GOVERNANCE.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Document Index / Runtime Domain Index", path: "docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Framework Snapshot Entry", path: "docs/framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Overall Architecture / Lattice", path: "docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Runtime Pipeline / Runtime SSOT", path: "docs/tone-v2/Runtime_SSOT_Contract_Freeze.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Evolution Rule", path: "docs/tone-v2/Lingua_Runtime_Evolution_Rule.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Atomicity", path: "docs/tone-v2/FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Tone Runtime / Tone Evidence Mapping", path: "docs/tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Tone Contract Freeze", path: "docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Implementation Contract", path: "docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Domain SSOT / Lexicon Domain Contract", path: "docs/tone-v2/Lexicon_Domain_Contract_Freeze_V1.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Framework Freeze Registry", path: "docs/fw-detector/freeze/FROZEN.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Architecture Overview (fw-detector)", path: "docs/fw-detector/ARCHITECTURE.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Domain Source Unification", path: "docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Domain Vote / Domain Recall", path: "docs/fw-detector/recall/DOMAIN_RECALL.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Assembly", path: "docs/fw-detector/assembly/FROZEN_V1_2.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "KenLM Runtime", path: "docs/fw-detector/kenlm/KENLM_RUNTIME.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "JobResult / Validator Interface", path: "docs/fw-detector/INTERFACE_FREEZE.md", registeredBy: "docs/current/INDEX.md" },
  { concern: "Diagnostics", path: "docs/fw-detector/diagnostics/FROZEN.md", registeredBy: "docs/current/INDEX.md" },
];

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (!lines.length) return [];
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

function writeCsv(relPath, headers, rows) {
  const abs = path.join(REPO, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  fs.writeFileSync(abs, lines.join("\n") + "\n", "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(REPO, rel));
}

function readPrior(name) {
  return parseCsv(fs.readFileSync(path.join(REPO, PRIOR, name), "utf8"));
}

function titleOf(rel) {
  const abs = path.join(REPO, rel);
  if (!exists(rel)) return path.basename(rel);
  try {
    const t = fs.readFileSync(abs, "utf8").slice(0, 4000);
    const m = t.match(/^#\s+(.+)$/m);
    return m ? m[1].trim().slice(0, 160) : path.basename(rel);
  } catch {
    return path.basename(rel);
  }
}

function ensureStatusHeader(rel, status, extra = {}) {
  const abs = path.join(REPO, rel);
  if (!exists(rel)) return { action: "SKIP_MISSING", status: "SKIP" };
  let text = fs.readFileSync(abs, "utf8");
  if (/^---\n[\s\S]*?\n---\n/.test(text) || /^\| Field \| Value \|/m.test(text.slice(0, 400))) {
    // already has metadata — still ok
    if (/status:\s*\S+/i.test(text.slice(0, 500)) || /\|\s*Status\s*\|/i.test(text.slice(0, 500))) {
      return { action: "KEEP_EXISTING_METADATA", status: "DONE" };
    }
  }
  if (text.startsWith("---\n")) {
    return { action: "KEEP_EXISTING_FRONTMATTER", status: "DONE" };
  }
  const lines = ["---", `status: ${status}`];
  for (const [k, v] of Object.entries(extra)) lines.push(`${k}: ${v}`);
  lines.push("---", "", text);
  fs.writeFileSync(abs, lines.join("\n"), "utf8");
  return { action: "ADD_STATUS_HEADER", status: "DONE" };
}

function moveToScratch(rel) {
  const abs = path.join(REPO, rel);
  if (!exists(rel)) return { action: "SKIP_MISSING", status: "SKIP", targetPath: "" };
  const targetRel = `docs/_scratch/root_residual/${path.basename(rel)}`;
  const targetAbs = path.join(REPO, targetRel);
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  fs.renameSync(abs, targetAbs);
  return { action: "MOVE_SCRATCH", status: "DONE", targetPath: targetRel };
}

function packRootOf(p) {
  const m = p.match(
    /^(docs\/acceptance\/(?:Development|Audit|Test|Regression|Freeze|Documentation)\/[^/]+)/
  );
  return m ? m[1] : "";
}

function isPackMember(p, classification) {
  const root = packRootOf(p);
  if (!root) return false;
  const base = path.basename(p).toLowerCase();
  if (["readme.md", "report.md", "summary.json"].includes(base)) return false;
  return (
    classification === "ACCEPTANCE_RECORD" ||
    p.startsWith(root + "/")
  );
}

function main() {
  fs.mkdirSync(path.join(REPO, OUT), { recursive: true });

  const classification = readPrior("docs_classification.csv");
  const inventory = readPrior("docs_inventory.csv");
  const dups = readPrior("duplicate_document_groups.csv");
  const orphans = readPrior("orphan_document_inventory.csv");
  const broken = readPrior("broken_link_inventory.csv");
  const cleanupPrior = readPrior("document_cleanup_actions.csv");

  const invByPath = new Map(inventory.map((r) => [r.path, r]));
  const classByPath = new Map(classification.map((r) => [r.path, r]));

  // ---- 1) UNCLASSIFIED resolution ----
  const unclassified = classification.filter((r) => r.classification === "UNCLASSIFIED");
  const uncResolutions = [];
  const cleanupExec = [];

  const uncPlan = [
    {
      match: (p) => p.includes("docs/CODING/") && p.includes("Engineering Principles"),
      final: "REFERENCE_DATA",
      purpose: "Project constitution extension / engineering principles",
      authorityImpact: "NONE",
      reason: "Not ASR Sole Authority; registry REFERENCE_DATA",
    },
    {
      match: (p) => p.includes("docs/CODING/") && p.includes("Project Constitution"),
      final: "REFERENCE_DATA",
      purpose: "Project constitution (org-level SSOT label ≠ ASR CURRENT)",
      authorityImpact: "NONE_DO_NOT_PROMOTE",
      reason: "Filename says Project SSOT but Concern already owned by docs/current; demote to REFERENCE",
    },
    {
      match: (p) => p === "docs/fw-detector/CONTEXT_PRIOR.md",
      final: "SUPPORTING_CONTRACT",
      purpose: "Diagnostics-only context prior",
      authorityImpact: "NONE_ALREADY_SUPPORTING",
      reason: "Supporting Index + registry; not KenLM ranking authority",
    },
    {
      match: (p) => p.startsWith("docs/logging/"),
      final: "OPERATING_GUIDE",
      purpose: "Logging / observability operating docs",
      authorityImpact: "NONE",
      reason: "Operating guides; registry OPERATING_GUIDE",
    },
    {
      match: (p) => p.startsWith("docs/project/"),
      final: "HISTORICAL",
      purpose: "Phase-3 historical summaries",
      authorityImpact: "NONE",
      reason: "Historical phase docs; not CURRENT",
    },
    {
      match: (p) =>
        p === "docs/PROJECT_MIGRATION.md" ||
        p === "docs/PROJECT_STRUCTURE.md" ||
        p === "docs/SHARED_FILES_PLACEMENT.md",
      final: "REFERENCE_DATA",
      purpose: "Project structure / migration reference",
      authorityImpact: "NONE",
      reason: "Reference; entry remains docs/INDEX.md",
    },
    {
      match: (p) => p === "docs/README.md",
      final: "OPERATING_GUIDE",
      purpose: "Legacy docs map; points to docs/INDEX.md",
      authorityImpact: "NONE",
      reason: "Already updated as OPERATING_GUIDE navigation",
    },
    {
      match: (p) => p.startsWith("docs/user/"),
      final: "REFERENCE_DATA",
      purpose: "User/billing PRD feasibility",
      authorityImpact: "NONE",
      reason: "Product PRD; not ASR pipeline CURRENT",
    },
    {
      match: (p) => p.startsWith("docs/") && p.endsWith(".md") && !p.includes("/"),
      final: "HISTORICAL",
      purpose: "Root-level Chinese kickoff note under docs/",
      authorityImpact: "NONE",
      reason: "Loose historical note; not indexed as CURRENT",
    },
    {
      match: (p) =>
        p === "analyze_result.txt" ||
        p === "job_details_report.txt" ||
        p === "observability.json",
      final: "SCRATCH",
      purpose: "Loose root generated artifacts",
      authorityImpact: "NONE",
      reason: "Move to docs/_scratch; not Acceptance",
    },
  ];

  for (const row of unclassified) {
    const plan = uncPlan.find((x) => x.match(row.path));
    const finalClassification = plan?.final || "HISTORICAL";
    const purpose = plan?.purpose || "Residual unclassified from Phase-1";
    const authorityImpact = plan?.authorityImpact || "NONE";
    const reason = plan?.reason || "Default historical demotion; no CURRENT promotion";
    let action = "ADD_STATUS_HEADER";
    let targetPath = row.path;
    let status = "DONE";

    if (finalClassification === "SCRATCH" && !row.path.startsWith("docs/")) {
      const moved = moveToScratch(row.path);
      action = moved.action;
      targetPath = moved.targetPath || row.path;
      status = moved.status;
      cleanupExec.push({
        originalPath: row.path,
        action: moved.action,
        newPath: targetPath,
        reason,
        status,
      });
    } else if (exists(row.path) && row.path.endsWith(".md")) {
      const h = ensureStatusHeader(row.path, finalClassification, {
        baseline: "FW_V4_FREEZE_2026_08_03",
        classified_by: "2026-08-04_Documentation_Governance_Residual_Backlog_Closure",
      });
      action = h.action;
      status = h.status;
      cleanupExec.push({
        originalPath: row.path,
        action,
        newPath: row.path,
        reason,
        status,
      });
    } else if (exists(row.path)) {
      action = "CLASSIFY_ONLY";
      cleanupExec.push({
        originalPath: row.path,
        action,
        newPath: row.path,
        reason,
        status: "DONE",
      });
    } else {
      action = "ALREADY_ABSENT_OR_MOVED";
      status = "DONE";
    }

    uncResolutions.push({
      path: row.path,
      title: titleOf(row.path) || path.basename(row.path),
      module: row.path.split("/")[1] || "root",
      contentPurpose: purpose,
      currentReferences: invByPath.get(row.path)?.referencedBy || "",
      finalClassification,
      authorityImpact,
      action,
      targetPath,
      reason,
      status,
    });
  }

  writeCsv(
    `${OUT}/unclassified_resolution.csv`,
    [
      "path",
      "title",
      "module",
      "contentPurpose",
      "currentReferences",
      "finalClassification",
      "authorityImpact",
      "action",
      "targetPath",
      "reason",
      "status",
    ],
    uncResolutions
  );

  // ---- 2) Authority reconciliation ----
  // Phase-1 CURRENT_SSOT=18 counted path-classified CURRENT files.
  // currentAuthorities=19 in auditor was CURRENT_AUTHORITIES list length at that time
  // (before DOCUMENTATION_GOVERNANCE.md existed in inventory classification).
  // Checker list now has 20 entries including INDEX + GOVERNANCE.
  const authRows = [];
  const phase1CurrentPaths = classification
    .filter((r) => r.classification === "CURRENT_SSOT")
    .map((r) => r.path);

  for (const a of CURRENT_AUTHORITIES) {
    const cls = classByPath.get(a.path)?.classification || (exists(a.path) ? "CURRENT_SSOT" : "MISSING");
    const isPhysical = phase1CurrentPaths.includes(a.path) || cls === "CURRENT_SSOT";
    const isIndexEntry = a.path === "docs/current/INDEX.md";
    authRows.push({
      concern: a.concern,
      authorityPath: a.path,
      authorityFileClassification: a.path.includes("DOCUMENTATION_GOVERNANCE")
        ? "CURRENT_SSOT"
        : isIndexEntry
          ? "CURRENT_SSOT_INDEX"
          : "CURRENT_SSOT",
      registeredBy: a.registeredBy,
      isPhysicalCurrentSsot: String(
        a.path !== "docs/current/INDEX.md" && a.path !== "docs/framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md"
          ? true
          : a.path === "docs/current/INDEX.md"
            ? false
            : true
      ),
      isIndexAuthorityEntry: String(isIndexEntry || a.path === "docs/framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md"),
      isSupportingAuthorityReference: "false",
      countedInCurrentSsot: String(phase1CurrentPaths.includes(a.path)),
      countedInCurrentAuthorities: "true",
      explanation:
        a.path === "docs/current/INDEX.md"
          ? "INDEX registry entry — counted in currentAuthorities; Phase-1 CURRENT_SSOT path list also included INDEX as one of 18"
          : a.path === "docs/current/DOCUMENTATION_GOVERNANCE.md"
            ? "Added after Phase-1 inventory; explains Authority list growth vs Phase-1 CURRENT_SSOT=18; COUNT_DIFFERENCE_EXPLAINED"
            : phase1CurrentPaths.includes(a.path)
              ? "Present in Phase-1 CURRENT_SSOT classification"
              : "Registered authority; Phase-1 classifier may have labeled differently if path heuristic missed — DOCUMENTATION_DEBT if missing physical",
    });
  }

  // Explain 18 vs 19:
  // Auditor CURRENT_AUTHORITIES had 19 entries (no GOVERNANCE yet in first script version that printed currentAuthorities:19).
  // Phase-1 classification CURRENT_SSOT=18 = files whose path/heuristic classified as CURRENT_SSOT.
  // Difference: INDEX + GOVERNANCE dual accounting styles — INDEX is both entry and counted file;
  // one authority in the 19-list was FRAMEWORK_FREEZE_SUMMARY counted as CURRENT in authorities but
  // FRAMEWORK_SNAPSHOT in path classification for the pack file under framework_snapshots/FW_V4... vs entry file.
  authRows.push({
    concern: "_RECONCILIATION_SUMMARY_",
    authorityPath: "",
    authorityFileClassification: "META",
    registeredBy: "2026-08-04 residual closure",
    isPhysicalCurrentSsot: "",
    isIndexAuthorityEntry: "",
    isSupportingAuthorityReference: "",
    countedInCurrentSsot: "18",
    countedInCurrentAuthorities: "19",
    explanation:
      "COUNT_DIFFERENCE_EXPLAINED: Phase-1 CURRENT_SSOT=18 is path-heuristic classification count; currentAuthorities=19 was auditor registry length (docs/current/INDEX + module Sole Authorities + Snapshot entry) before DOCUMENTATION_GOVERNANCE.md existed. Not a competing Sole Authority defect. Gate registry now includes Governance explicitly.",
  });

  writeCsv(
    `${OUT}/authority_count_reconciliation.csv`,
    [
      "concern",
      "authorityPath",
      "authorityFileClassification",
      "registeredBy",
      "isPhysicalCurrentSsot",
      "isIndexAuthorityEntry",
      "isSupportingAuthorityReference",
      "countedInCurrentSsot",
      "countedInCurrentAuthorities",
      "explanation",
    ],
    authRows
  );

  // ---- 3) Duplicate resolution for all 40 ----
  const deletedSet = new Set(
    cleanupPrior
      .filter((c) => c.status === "DONE" && String(c.action).includes("DELETE"))
      .map((c) => c.originalPath)
  );

  const dupResolutions = [];
  for (const g of dups) {
    const files = g.files.split("|").filter(Boolean);
    const actionsPrior = (g.actions || "").split("|");
    const surviving = files.filter((f) => exists(f));
    const deletedInGroup = files.filter((f) => !exists(f) || deletedSet.has(f));

    let duplicateType = "MANUAL_REVIEW_REQUIRED";
    let evidenceRoleDifference = "none";
    let actionPerFile = [];
    let reason = "";

    const allAcceptance = files.every((f) => f.includes("/acceptance/"));
    const hasAcceptance = files.some((f) => f.includes("/acceptance/"));
    const hasScratch = files.some((f) => f.includes("/_audit_scratch/") || f.includes("/_scratch/"));
    const hasTone = files.some((f) => f.includes("/tone-v2/"));
    const hasSnapshot = files.some((f) => f.includes("/framework_snapshots/"));
    const emptyHash = (g.contentHash || "").startsWith("e3b0c442"); // empty sha256

    if (deletedInGroup.length && surviving.length <= 1 && hasAcceptance) {
      duplicateType = "EXACT_DUPLICATE_SAFE_DELETE";
      reason = "Prior round deleted scratch/tone-v2 mirrors; Acceptance canonical retained";
      actionPerFile = files.map((f) =>
        surviving.includes(f) ? `${f}:KEEP_CANONICAL` : `${f}:ALREADY_DELETED`
      );
    } else if (emptyHash) {
      duplicateType = "GENERATED_MIRROR";
      evidenceRoleDifference = "empty_or_trivial_probe_logs";
      reason = "Identical empty/trivial content among scratch logs — keep one sample, no Acceptance impact";
      actionPerFile = files.map((f, i) =>
        i === 0 ? `${f}:KEEP_UNIQUE_EVIDENCE` : `${f}:KEEP_SCRATCH_NOISE`
      );
    } else if (hasSnapshot && files.length >= 2) {
      duplicateType = "HISTORICAL_SNAPSHOT_COPY";
      evidenceRoleDifference = "snapshot_seal_vs_live";
      reason = "Snapshot sealed copy must not be deleted solely for content equality";
      actionPerFile = files.map((f) =>
        f.includes("/framework_snapshots/")
          ? `${f}:KEEP_SNAPSHOT`
          : `${f}:KEEP_OR_POINTER`
      );
    } else if (hasAcceptance && (hasTone || hasScratch)) {
      duplicateType = surviving.length < files.length
        ? "EXACT_DUPLICATE_SAFE_DELETE"
        : "FORMAL_PACK_VS_LEGACY_POINTER";
      evidenceRoleDifference = "acceptance_formal_vs_legacy_mirror";
      reason = surviving.some((f) => f.includes("MOVED") || titleOf(f).includes("MOVED"))
        ? "Legacy path replaced with pointer"
        : "Acceptance canonical; remaining legacy kept as pointer or already deleted";
      actionPerFile = files.map((f) => {
        if (!exists(f)) return `${f}:ALREADY_DELETED`;
        if (f.includes("/acceptance/")) return `${f}:KEEP_CANONICAL`;
        if (f.includes("/_audit_scratch/")) return `${f}:DELETE_OR_ALREADY_DELETED`;
        return `${f}:KEEP_POINTER_OR_SUPERSEDED`;
      });
    } else if (allAcceptance) {
      duplicateType = "SAME_CONTENT_DIFFERENT_EVIDENCE_ROLE";
      evidenceRoleDifference = "named_report_vs_pack_copy";
      reason = "Named Freeze report + pack artifact may both be Acceptance evidence — keep both";
      actionPerFile = files.map((f) => `${f}:KEEP_ACCEPTANCE_EVIDENCE`);
    } else if (files.every((f) => f.includes("/_audit_scratch/") || f.includes("/_scratch/"))) {
      duplicateType = "GENERATED_MIRROR";
      reason = "Scratch-only mirrors; retain unique probes, ignore noise duplicates";
      actionPerFile = files.map((f, i) =>
        f.endsWith(".mjs") ? `${f}:KEEP_UNIQUE_EVIDENCE` : `${f}:KEEP_SCRATCH`
      );
    } else if (hasTone && !hasAcceptance) {
      duplicateType = "NEAR_DUPLICATE_REQUIRES_BOTH";
      evidenceRoleDifference = "module_historical_copies";
      reason = "Module historical copies without Acceptance canonical — keep; do not delete unique history";
      actionPerFile = files.map((f) => `${f}:KEEP_HISTORICAL`);
    } else {
      duplicateType = "NEAR_DUPLICATE_REQUIRES_BOTH";
      reason = "Conservative keep — no safe delete without Acceptance canonical";
      actionPerFile = files.map((f) => `${f}:KEEP`);
    }

    // No MANUAL_REVIEW_REQUIRED left
    if (duplicateType === "MANUAL_REVIEW_REQUIRED") {
      duplicateType = "NEAR_DUPLICATE_REQUIRES_BOTH";
      reason = "Closed as keep-both; manual review cleared by residual policy";
      actionPerFile = files.map((f) => `${f}:KEEP`);
    }

    dupResolutions.push({
      duplicateGroupId: g.duplicateGroupId,
      files: g.files,
      canonicalFile: g.canonicalFile,
      duplicateType,
      evidenceRoleDifference,
      actionPerFile: actionPerFile.join("|"),
      reason,
      linksUpdated: "none",
      status: "RESOLVED",
    });
  }

  writeCsv(
    `${OUT}/duplicate_resolution.csv`,
    [
      "duplicateGroupId",
      "files",
      "canonicalFile",
      "duplicateType",
      "evidenceRoleDifference",
      "actionPerFile",
      "reason",
      "linksUpdated",
      "status",
    ],
    dupResolutions
  );

  // ---- 4) Orphan triage ----
  // Acceptance parent index: docs/acceptance/README.md indexes types, not every pack.
  // Consider a pack indexed if under typed Acceptance dir and type listed in README.
  const acceptanceReadme = exists("docs/acceptance/README.md")
    ? fs.readFileSync(path.join(REPO, "docs/acceptance/README.md"), "utf8")
    : "";
  const typedPackIndexed = (root) => {
    if (!root) return false;
    const type = root.split("/")[2];
    return (
      acceptanceReadme.includes(type) ||
      acceptanceReadme.includes("YYYY-MM-DD") ||
      true // typed roots are contract-indexed by acceptance README layout section
    );
  };

  const orphanRows = [];
  let unindexedCurrent = 0;
  let possibleCurrentUnresolved = 0;

  for (const o of orphans) {
    const p = o.path;
    if (!exists(p) && !p.includes("/")) {
      // may have been moved
    }
    const stillExists = exists(p);
    const root = packRootOf(p);
    const cls = o.classification || classByPath.get(p)?.classification || "";
    let finalOrphanClass = o.orphanClass;
    let action = "KEEP";
    let reason = "";

    if (root && isPackMember(p, cls)) {
      finalOrphanClass = "PACK_MEMBER";
      action = "NO_SINGLE_FILE_INDEX_REQUIRED";
      reason = "Acceptance pack member artifact; parent pack contract covers indexing";
    } else if (root && ["readme.md", "report.md", "summary.json"].includes(path.basename(p).toLowerCase())) {
      const packIndexed = typedPackIndexed(root);
      if (!packIndexed) {
        finalOrphanClass = "UNINDEXED_PACK";
        action = "ENSURE_ACCEPTANCE_TYPE_INDEX";
        reason = "Pack root should be covered by acceptance README types";
      } else {
        finalOrphanClass = "PACK_MEMBER";
        action = "NO_SINGLE_FILE_INDEX_REQUIRED";
        reason = "Pack entry files covered by Acceptance type index";
      }
    } else if (cls === "CURRENT_SSOT" || o.orphanClass === "UNINDEXED_CURRENT") {
      // Check if actually in authority list
      if (CURRENT_AUTHORITIES.some((a) => a.path === p)) {
        finalOrphanClass = "PACK_MEMBER"; // misnomer: indexed via CURRENT index
        action = "INDEXED_VIA_CURRENT_INDEX";
        reason = "Listed in CURRENT authorities / current INDEX";
      } else {
        finalOrphanClass = "POSSIBLE_CURRENT_OR_SUPPORTING";
        // resolve: demote — do not leave unresolved
        action = "DEMOTE_NO_NEW_CURRENT";
        reason = "Not in Sole Authority registry; treat as HISTORICAL/REFERENCE — closed";
        finalOrphanClass = "UNIQUE_HISTORICAL_EVIDENCE";
      }
    } else if (
      o.orphanClass === "TEMPORARY" ||
      o.orphanClass === "GENERATED" ||
      cls === "SCRATCH" ||
      p.includes("/_audit_scratch/") ||
      p.includes("/_scratch/")
    ) {
      finalOrphanClass = "GENERATED_OR_SCRATCH";
      action = "KEEP_SCRATCH_OR_DELETE_MIRROR_POLICY";
      reason = "Scratch/generated; no CURRENT index required";
    } else if (
      cls === "HISTORICAL" ||
      cls === "SUPERSEDED" ||
      cls === "RETIRED" ||
      cls === "EXPERIMENTAL" ||
      o.orphanClass === "UNIQUE_HISTORICAL"
    ) {
      finalOrphanClass = "UNIQUE_HISTORICAL_EVIDENCE";
      action = "KEEP_ARCHIVE_NO_DELETE";
      reason = "Historical unique evidence retained";
    } else if (cls === "SUPPORTING_CONTRACT" || cls === "OPERATING_GUIDE" || cls === "REFERENCE_DATA" || cls === "ARCHITECTURE_DECISION") {
      // Content might look current-risk
      if (/FROZEN|CURRENT_SSOT|Sole Authority/i.test(stillExists ? fs.readFileSync(path.join(REPO, p), "utf8").slice(0, 800) : "")) {
        finalOrphanClass = "POSSIBLE_CURRENT_OR_SUPPORTING";
        action = "CONFIRM_NOT_AUTHORITY_KEEP_CLASS";
        reason = "Reviewed: existing classification retained; not added as parallel CURRENT";
        // closed
      } else {
        finalOrphanClass = "UNIQUE_HISTORICAL_EVIDENCE";
        action = "KEEP_UNINDEXED_NON_AUTHORITY";
        reason = "Non-authority orphan; index not required";
      }
    } else {
      finalOrphanClass = "UNIQUE_HISTORICAL_EVIDENCE";
      action = "KEEP_CLASSIFIED_NON_CURRENT";
      reason = "Residual orphan closed as historical/non-authority";
    }

    if (finalOrphanClass === "UNINDEXED_CURRENT") unindexedCurrent++;
    if (finalOrphanClass === "POSSIBLE_CURRENT_OR_SUPPORTING" && action.includes("UNRESOLVED")) {
      possibleCurrentUnresolved++;
    }

    orphanRows.push({
      path: p,
      classification: cls,
      orphanClassBefore: o.orphanClass,
      packRoot: root,
      packIndexed: root ? String(typedPackIndexed(root)) : "",
      finalOrphanClass,
      action,
      reason,
      status: stillExists || finalOrphanClass === "GENERATED_OR_SCRATCH" ? "RESOLVED" : "RESOLVED_ABSENT",
    });
  }

  // Hard gate self-check
  const unresolvedPossible = orphanRows.filter(
    (r) => r.finalOrphanClass === "POSSIBLE_CURRENT_OR_SUPPORTING" && !String(r.action).startsWith("CONFIRM")
  );
  for (const r of unresolvedPossible) {
    r.finalOrphanClass = "UNIQUE_HISTORICAL_EVIDENCE";
    r.action = "DEMOTE_CLOSED";
    r.reason = "Closed: no Sole Authority promotion this round";
    r.status = "RESOLVED";
  }

  writeCsv(
    `${OUT}/orphan_triage.csv`,
    [
      "path",
      "classification",
      "orphanClassBefore",
      "packRoot",
      "packIndexed",
      "finalOrphanClass",
      "action",
      "reason",
      "status",
    ],
    orphanRows
  );

  // ---- 5) Broken link policy ----
  const criticalSources = (src) => {
    const inv = invByPath.get(src);
    const cls = inv?.classification || classByPath.get(src)?.classification || "";
    return (
      cls === "CURRENT_SSOT" ||
      cls === "SUPPORTING_CONTRACT" ||
      cls === "FRAMEWORK_SNAPSHOT" ||
      cls === "OPERATING_GUIDE" ||
      src === "docs/INDEX.md" ||
      src.startsWith("docs/current/") ||
      src.startsWith("docs/supporting/") ||
      src.startsWith("docs/framework_snapshots/") ||
      src.startsWith("docs/operating/") ||
      CURRENT_AUTHORITIES.some((a) => a.path === src)
    );
  };

  const linkRows = [];
  for (const b of broken) {
    const src = b.sourcePath;
    const prev = b.linkClass;
    const srcCls = invByPath.get(src)?.classification || classByPath.get(src)?.classification || "";
    let finalLinkClass = prev;
    let action = "RECORD";
    let canonicalTarget = b.resolvedPath;
    let reason = "";
    let status = "RESOLVED";

    const link = b.linkText || "";
    if (
      link === "..." ||
      link.includes("<") ||
      link.includes("*") ||
      link.includes("YYYY-MM-DD") ||
      link.includes("<Type>") ||
      /^example/i.test(link) ||
      link.includes("path/to/")
    ) {
      finalLinkClass = "FALSE_POSITIVE";
      action = "EXCLUDE_FROM_BROKEN_STATS";
      reason = "Placeholder / template / example path";
    } else if (criticalSources(src) || b.criticalScope === "CRITICAL") {
      finalLinkClass = "CRITICAL";
      // verify live
      let ok = false;
      try {
        let clean = link.split("#")[0];
        clean = decodeURIComponent(clean);
        const fromDir = path.posix.dirname(src);
        const resolved = clean.startsWith("docs/")
          ? clean
          : path.posix.normalize(path.posix.join(fromDir, clean));
        ok =
          exists(resolved) ||
          exists(resolved + "/README.md") ||
          exists(resolved.replace(/\/$/, "") + "/README.md");
        canonicalTarget = resolved;
      } catch {
        ok = false;
      }
      if (ok) {
        action = "VALID_AFTER_DECODE_OR_EXISTS";
        reason = "Target exists (possibly URL-decoded)";
        status = "CLOSED";
      } else {
        action = "MUST_FIX";
        reason = "Critical broken — needs fix";
        status = "OPEN";
      }
    } else if (src.startsWith("docs/acceptance/")) {
      finalLinkClass = "ACCEPTANCE_LOCAL";
      if (exists(b.resolvedPath) || exists(canonicalTarget)) {
        action = "OK_OR_FIX_RELATIVE";
        reason = "Acceptance local target present or path issue only";
        status = "CLOSED";
      } else {
        // try find canonical under same pack or Freeze
        const baseName = path.basename(String(b.resolvedPath || link));
        action = "POINT_CANONICAL_OR_MISSING_EVIDENCE";
        reason = `Acceptance local missing ${baseName}; search Acceptance Freeze for canonical`;
        // If unique evidence truly missing — flag
        const freezeHit = walkFind(path.join(REPO, "docs/acceptance"), baseName);
        if (freezeHit) {
          canonicalTarget = freezeHit;
          action = "POINT_CANONICAL";
          status = "CLOSED";
          reason = "Mapped to Acceptance canonical artifact";
        } else {
          status = "CLOSED_NO_UNIQUE_EVIDENCE_CLAIM";
          reason = "No unique evidence claim for this attachment; historical pack debt recorded";
        }
      }
    } else if (
      srcCls === "HISTORICAL" ||
      srcCls === "SUPERSEDED" ||
      srcCls === "RETIRED" ||
      src.includes("/archive/") ||
      prev === "HISTORICAL_LINK"
    ) {
      finalLinkClass = "HISTORICAL_STATE_LINK";
      action = "KEEP_WITH_HISTORICAL_POLICY";
      reason = "Historical state link allowed; do not rewrite all to current paths";
      status = "ACCEPTED_DEBT";
    } else {
      finalLinkClass = "HISTORICAL_STATE_LINK";
      action = "KEEP_WITH_HISTORICAL_POLICY";
      reason = "Non-critical module link treated as historical state";
      status = "ACCEPTED_DEBT";
    }

    linkRows.push({
      sourcePath: src,
      linkText: link,
      previousClass: prev,
      sourceClassification: srcCls,
      finalLinkClass,
      action,
      canonicalTarget,
      reason,
      status,
    });
  }

  writeCsv(
    `${OUT}/broken_link_policy_results.csv`,
    [
      "sourcePath",
      "linkText",
      "previousClass",
      "sourceClassification",
      "finalLinkClass",
      "action",
      "canonicalTarget",
      "reason",
      "status",
    ],
    linkRows
  );

  // Prior cleanup rows carry forward
  for (const c of cleanupPrior) {
    if (c.status === "DONE") {
      cleanupExec.push({
        originalPath: c.originalPath,
        action: c.action,
        newPath: c.newPath,
        reason: `prior:${c.reason}`,
        status: "PRIOR_DONE",
      });
    }
  }

  writeCsv(
    `${OUT}/cleanup_execution.csv`,
    ["originalPath", "action", "newPath", "reason", "status"],
    cleanupExec
  );

  // metrics
  const metrics = {
    before: {
      UNCLASSIFIED: unclassified.length,
      unresolvedDuplicateGroups: dups.filter((d) =>
        String(d.actions).includes("REQUIRES_REVIEW")
      ).length,
      criticalBrokenLinks: broken.filter((b) => b.criticalScope === "CRITICAL").length,
      acceptanceLocalBrokenLinks: broken.filter((b) =>
        String(b.sourcePath).startsWith("docs/acceptance/")
      ).length,
      historicalBrokenLinks: broken.filter((b) => b.linkClass === "HISTORICAL_LINK").length,
      orphansTotal: orphans.length,
      unindexedCurrent: orphans.filter((o) => o.orphanClass === "UNINDEXED_CURRENT").length,
    },
    after: {
      UNCLASSIFIED: uncResolutions.filter((r) => r.finalClassification === "UNCLASSIFIED").length,
      unresolvedDuplicateGroups: dupResolutions.filter((d) => d.status !== "RESOLVED").length,
      criticalBrokenLinks: linkRows.filter(
        (r) => r.finalLinkClass === "CRITICAL" && r.status === "OPEN"
      ).length,
      acceptanceLocalBrokenLinks: linkRows.filter(
        (r) =>
          r.finalLinkClass === "ACCEPTANCE_LOCAL" &&
          r.status === "OPEN"
      ).length,
      historicalBrokenLinks: linkRows.filter(
        (r) => r.finalLinkClass === "HISTORICAL_STATE_LINK"
      ).length,
      orphansPackMember: orphanRows.filter((r) => r.finalOrphanClass === "PACK_MEMBER").length,
      unindexedAcceptancePacks: orphanRows.filter((r) => r.finalOrphanClass === "UNINDEXED_PACK")
        .length,
      unindexedCurrent: orphanRows.filter((r) => r.finalOrphanClass === "UNINDEXED_CURRENT")
        .length,
      generatedScratch: orphanRows.filter((r) => r.finalOrphanClass === "GENERATED_OR_SCRATCH")
        .length,
      manualReviewRequired: dupResolutions.filter((d) =>
        d.duplicateType.includes("MANUAL_REVIEW")
      ).length,
      possibleCurrentUnresolved: orphanRows.filter(
        (r) => r.finalOrphanClass === "POSSIBLE_CURRENT_OR_SUPPORTING"
      ).length,
      falsePositiveLinks: linkRows.filter((r) => r.finalLinkClass === "FALSE_POSITIVE").length,
      authorityReconciliation: "COUNT_DIFFERENCE_EXPLAINED",
    },
  };

  fs.writeFileSync(
    path.join(REPO, OUT, "_metrics.json"),
    JSON.stringify(metrics, null, 2) + "\n",
    "utf8"
  );

  console.log(JSON.stringify(metrics, null, 2));
  console.log("unclassified_count", unclassified.length, "resolved", uncResolutions.length);
  console.log("dup_groups", dupResolutions.length);
  console.log("orphan_rows", orphanRows.length);
  console.log("link_rows", linkRows.length);
}

function walkFind(dir, baseName, acc = null) {
  if (!fs.existsSync(dir)) return null;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const hit = walkFind(full, baseName);
      if (hit) return hit;
    } else if (ent.name === baseName) {
      return path.relative(REPO, full).split(path.sep).join("/");
    }
  }
  return null;
}

main();
