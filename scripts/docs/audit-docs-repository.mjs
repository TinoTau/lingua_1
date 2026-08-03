#!/usr/bin/env node
/**
 * Phase-1 docs repository audit (read-only).
 * Writes inventory / classification / duplicate / orphan / broken-link CSVs
 * into a target Acceptance Documentation pack.
 *
 * Usage:
 *   node scripts/docs/audit-docs-repository.mjs [--out <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const DEFAULT_OUT = path.join(
  REPO,
  "docs/acceptance/Documentation/2026-08-03_Docs_Repository_Governance_and_Consolidation"
);

const DOC_EXTS = new Set([
  ".md",
  ".csv",
  ".json",
  ".yml",
  ".yaml",
  ".txt",
  ".tsv",
]);

const SCAN_ROOTS = [
  { root: path.join(REPO, "docs"), label: "docs" },
  { root: path.join(REPO, "electron_node", "docs"), label: "electron_node/docs" },
  { root: path.join(REPO, "node_runtime", "docs"), label: "node_runtime/docs" },
];

/** Paths listed as Sole Authorities in docs/current/INDEX.md (canonical concerns). */
const CURRENT_AUTHORITIES = [
  {
    concern: "Document Index / Runtime Domain Index",
    path: "docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md",
  },
  {
    concern: "Framework Snapshot Entry",
    path: "docs/framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md",
  },
  {
    concern: "Overall Architecture / Lattice",
    path: "docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md",
  },
  {
    concern: "Runtime Pipeline / Runtime SSOT",
    path: "docs/tone-v2/Runtime_SSOT_Contract_Freeze.md",
  },
  {
    concern: "Evolution Rule",
    path: "docs/tone-v2/Lingua_Runtime_Evolution_Rule.md",
  },
  {
    concern: "Atomicity",
    path: "docs/tone-v2/FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md",
  },
  {
    concern: "Tone Runtime / Tone Evidence Mapping",
    path: "docs/tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md",
  },
  {
    concern: "Tone Contract Freeze",
    path: "docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md",
  },
  {
    concern: "Implementation Contract",
    path: "docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md",
  },
  {
    concern: "Domain SSOT / Lexicon Domain Contract",
    path: "docs/tone-v2/Lexicon_Domain_Contract_Freeze_V1.md",
  },
  {
    concern: "Framework Freeze Registry",
    path: "docs/fw-detector/freeze/FROZEN.md",
  },
  {
    concern: "Architecture Overview (fw-detector)",
    path: "docs/fw-detector/ARCHITECTURE.md",
  },
  {
    concern: "Domain Source Unification",
    path: "docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md",
  },
  {
    concern: "Domain Vote / Domain Recall",
    path: "docs/fw-detector/recall/DOMAIN_RECALL.md",
  },
  {
    concern: "Assembly",
    path: "docs/fw-detector/assembly/FROZEN_V1_2.md",
  },
  {
    concern: "KenLM Runtime",
    path: "docs/fw-detector/kenlm/KENLM_RUNTIME.md",
  },
  {
    concern: "JobResult / Validator Interface",
    path: "docs/fw-detector/INTERFACE_FREEZE.md",
  },
  {
    concern: "Diagnostics",
    path: "docs/fw-detector/diagnostics/FROZEN.md",
  },
  {
    concern: "CURRENT Index Entry",
    path: "docs/current/INDEX.md",
  },
];

function parseArgs(argv) {
  let out = DEFAULT_OUT;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out = path.resolve(argv[++i]);
    }
  }
  return { out };
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      walkFiles(full, acc);
    } else if (ent.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function relRepo(abs) {
  return toPosix(path.relative(REPO, abs));
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function extractTitle(text, fileName) {
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim().slice(0, 200);
  return path.basename(fileName, path.extname(fileName));
}

function extractMetaField(text, key) {
  const re = new RegExp(
    `(?:^|\\n)(?:\\|\\s*)?${key}\\s*(?:\\|\\s*)?(?:\\*\\*)?([^\\n|*]+)`,
    "i"
  );
  const m = text.match(re);
  if (m) return m[1].replace(/\*\*/g, "").trim().slice(0, 120);
  const yaml = text.match(
    new RegExp(`^${key}:\\s*(.+)$`, "im")
  );
  if (yaml) return yaml[1].trim().slice(0, 120);
  return "";
}

function classify(rel, text) {
  const lower = rel.toLowerCase();
  const base = path.basename(rel).toLowerCase();

  if (lower.includes("/_audit_scratch/") || lower.includes("/_scratch/")) {
    return { classification: "SCRATCH", recommendedAction: "KEEP_SCRATCH" };
  }
  if (/(?:\s\(1\)|\s\(2\)|copy|final2|latest_copy)/i.test(base)) {
    return {
      classification: "DUPLICATE",
      recommendedAction: "DELETE_OR_REVIEW",
    };
  }
  if (lower.startsWith("docs/current/")) {
    if (base === "documentation_governance.md") {
      return {
        classification: "CURRENT_SSOT",
        recommendedAction: "KEEP_CURRENT",
      };
    }
    return {
      classification: "CURRENT_SSOT",
      recommendedAction: "KEEP_CURRENT",
    };
  }
  if (lower.startsWith("docs/supporting/")) {
    return {
      classification: "SUPPORTING_CONTRACT",
      recommendedAction: "KEEP_SUPPORTING",
    };
  }
  if (lower.startsWith("docs/framework_snapshots/")) {
    return {
      classification: "FRAMEWORK_SNAPSHOT",
      recommendedAction: "KEEP_SNAPSHOT",
    };
  }
  if (lower.startsWith("docs/acceptance/")) {
    return {
      classification: "ACCEPTANCE_RECORD",
      recommendedAction: "KEEP_ACCEPTANCE",
    };
  }
  if (lower.startsWith("docs/architecture/")) {
    return {
      classification: "ARCHITECTURE_DECISION",
      recommendedAction: "KEEP_ADR",
    };
  }
  if (lower.startsWith("docs/operating/") || lower.startsWith("docs/setup/") || lower.startsWith("docs/troubleshooting/")) {
    return {
      classification: "OPERATING_GUIDE",
      recommendedAction: "KEEP_OPERATING",
    };
  }
  if (lower.startsWith("docs/reference/") || lower.startsWith("docs/changelog/")) {
    return {
      classification: "REFERENCE_DATA",
      recommendedAction: "KEEP_REFERENCE",
    };
  }
  if (lower.startsWith("docs/archive/retired/")) {
    return { classification: "RETIRED", recommendedAction: "KEEP_ARCHIVE" };
  }
  if (lower.startsWith("docs/archive/superseded/")) {
    return { classification: "SUPERSEDED", recommendedAction: "KEEP_ARCHIVE" };
  }
  if (lower.startsWith("docs/archive/experiment/")) {
    return { classification: "EXPERIMENTAL", recommendedAction: "KEEP_ARCHIVE" };
  }
  if (lower.startsWith("docs/archive/")) {
    return { classification: "HISTORICAL", recommendedAction: "KEEP_ARCHIVE" };
  }
  if (lower.startsWith("docs/decision/")) {
    return {
      classification: "ARCHITECTURE_DECISION",
      recommendedAction: "MIGRATE_TO_ARCHITECTURE_OR_ARCHIVE",
    };
  }

  const isAuthority = CURRENT_AUTHORITIES.some((a) => a.path === rel);
  if (isAuthority) {
    return {
      classification: "CURRENT_SSOT",
      recommendedAction: "KEEP_CURRENT_IN_PLACE",
    };
  }

  if (/^#\s*MOVED\b/i.test(text) || /stub\s*→|→\s*`?docs\/archive/i.test(text.slice(0, 400))) {
    return {
      classification: "SUPERSEDED",
      recommendedAction: "KEEP_POINTER_STUB",
    };
  }

  if (
    /status:\s*\*\*current\*\*|status\s*\|\s*\*\*current\*\*/i.test(text.slice(0, 800)) ||
    /\bCURRENT_SSOT\b/.test(text.slice(0, 800))
  ) {
    return {
      classification: "UNCLASSIFIED",
      recommendedAction: "REQUIRES_REVIEW_CURRENT_CLAIM",
    };
  }

  if (
    lower.includes("fw_repair") ||
    lower.includes("audit") ||
    lower.includes("acceptance") ||
    lower.includes("report")
  ) {
    if (lower.startsWith("docs/tone-v2/") || lower.startsWith("docs/fw-detector/") || lower.startsWith("docs/kenlm audit") || lower.startsWith("docs/fw quality audit")) {
      return {
        classification: "HISTORICAL",
        recommendedAction: "INDEX_OR_ARCHIVE",
      };
    }
  }

  if (lower.startsWith("docs/tone-v2/") || lower.startsWith("docs/fw-detector/") || lower.startsWith("docs/lexicon") || lower.startsWith("docs/pinyin") || lower.startsWith("docs/tone-module") || lower.startsWith("docs/train")) {
    return {
      classification: "HISTORICAL",
      recommendedAction: "KEEP_MODULE_HISTORICAL_OR_REFERENCE",
    };
  }

  if (lower.startsWith("electron_node/docs/") || lower.startsWith("kenlm/") || lower.endsWith(".md") && !lower.startsWith("docs/")) {
    return {
      classification: "REFERENCE_DATA",
      recommendedAction: "KEEP_MODULE_DOCS",
    };
  }

  return {
    classification: "UNCLASSIFIED",
    recommendedAction: "REQUIRES_REVIEW",
  };
}

function moduleOf(rel) {
  const parts = rel.split("/");
  if (parts[0] === "docs" && parts[1]) return parts[1];
  if (parts[0] === "electron_node") return "electron_node";
  if (parts[0] === "kenLM" || parts[0] === "kenlm") return "kenLM";
  return parts[0] || "root";
}

function collectMarkdownLinks(text, fromRel) {
  const links = [];
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const target = m[2].trim().split(/\s+/)[0].replace(/^<|>$/g, "");
    if (!target || target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:") || target.startsWith("#")) {
      continue;
    }
    links.push(target);
  }
  // bare path mentions in backticks that look like docs/
  const bare = text.matchAll(/`((?:docs|electron_node\/docs)\/[^`\n]+)`/g);
  for (const b of bare) {
    if (!b[1].includes("*") && !b[1].includes(" ")) links.push(b[1]);
  }
  return links;
}

function resolveLink(fromRel, link) {
  const clean = link.split("#")[0];
  if (!clean) return { status: "VALID", resolved: fromRel };
  const fromDir = path.posix.dirname(fromRel);
  let resolved;
  if (clean.startsWith("/")) {
    resolved = clean.replace(/^\//, "");
  } else if (clean.startsWith("docs/") || clean.startsWith("electron_node/")) {
    resolved = clean;
  } else {
    resolved = toPosix(path.posix.normalize(path.posix.join(fromDir, clean)));
  }
  const abs = path.join(REPO, resolved);
  if (fs.existsSync(abs)) return { status: "VALID", resolved };
  // try decode
  try {
    const decoded = decodeURIComponent(resolved);
    if (fs.existsSync(path.join(REPO, decoded))) {
      return { status: "VALID", resolved: decoded };
    }
  } catch {
    /* ignore */
  }
  if (fromRel.includes("/archive/") || fromRel.includes("/HISTORICAL/") || fromRel.includes("/SUPERSEDED/") || fromRel.includes("/RETIRED/") || fromRel.includes("/EXPERIMENT/")) {
    return { status: "HISTORICAL_LINK", resolved };
  }
  if (fromRel.includes("/_audit_scratch/") || fromRel.includes("/_scratch/")) {
    return { status: "HISTORICAL_LINK", resolved };
  }
  return { status: "MISSING_TARGET", resolved };
}

function hashFile(abs, maxBytes = 2_000_000) {
  const st = fs.statSync(abs);
  if (st.size > maxBytes) {
    return `size:${st.size}`;
  }
  const buf = fs.readFileSync(abs);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function main() {
  const { out } = parseArgs(process.argv);
  fs.mkdirSync(out, { recursive: true });

  const files = [];
  for (const { root } of SCAN_ROOTS) {
    for (const abs of walkFiles(root)) {
      const ext = path.extname(abs).toLowerCase();
      if (!DOC_EXTS.has(ext)) continue;
      files.push(abs);
    }
  }
  // root markdown
  for (const abs of walkFiles(REPO).filter((f) => {
    const rel = relRepo(f);
    return !rel.includes("/") && DOC_EXTS.has(path.extname(f).toLowerCase());
  })) {
    files.push(abs);
  }
  // kenLM markdown only (avoid model binaries)
  const kenlm = path.join(REPO, "kenLM");
  if (fs.existsSync(kenlm)) {
    for (const abs of walkFiles(kenlm)) {
      if (path.extname(abs).toLowerCase() === ".md") files.push(abs);
    }
  }

  const unique = [...new Set(files)];
  const inventory = [];
  const pathSet = new Set(unique.map(relRepo));
  const contentHashGroups = new Map();
  const referencedBy = new Map();
  const references = new Map();
  const brokenLinks = [];

  for (const abs of unique) {
    const rel = relRepo(abs);
    let text = "";
    let size = 0;
    try {
      const st = fs.statSync(abs);
      size = st.size;
      if (size <= 1_500_000 && [".md", ".txt", ".yml", ".yaml", ".json"].includes(path.extname(abs).toLowerCase())) {
        text = fs.readFileSync(abs, "utf8");
      }
    } catch {
      continue;
    }

    const { classification, recommendedAction } = classify(rel, text);
    const title = text ? extractTitle(text, abs) : path.basename(abs);
    const declaredStatus =
      extractMetaField(text, "Status") ||
      extractMetaField(text, "status") ||
      "";
    const declaredVersion =
      extractMetaField(text, "Version") ||
      extractMetaField(text, "baseline") ||
      "";
    const declaredDate =
      extractMetaField(text, "Date") ||
      extractMetaField(text, "reviewed_at") ||
      "";

    const containsCurrentClaim = /\bCURRENT(_SSOT)?\b|\*\*CURRENT\*\*/i.test(
      text.slice(0, 2000)
    );
    const containsFrozenClaim = /\bFROZEN\b|FREEZE/i.test(text.slice(0, 2000));
    const containsRetiredClaim = /\bRETIRED\b|SUPERSEDED\b|#\s*MOVED/i.test(
      text.slice(0, 2000)
    );

    let hash = "";
    try {
      hash = hashFile(abs);
      if (!contentHashGroups.has(hash)) contentHashGroups.set(hash, []);
      contentHashGroups.get(hash).push(rel);
    } catch {
      /* ignore */
    }

    const links = text ? collectMarkdownLinks(text, rel) : [];
    references.set(rel, links);
    for (const link of links) {
      const { status, resolved } = resolveLink(rel, link);
      if (!referencedBy.has(resolved)) referencedBy.set(resolved, []);
      referencedBy.get(resolved).push(rel);

      const isCritical =
        rel.startsWith("docs/current/") ||
        rel.startsWith("docs/supporting/") ||
        rel.startsWith("docs/framework_snapshots/") ||
        rel.startsWith("docs/INDEX.md") ||
        CURRENT_AUTHORITIES.some((a) => a.path === rel);

      if (status !== "VALID") {
        brokenLinks.push({
          sourcePath: rel,
          linkText: link,
          resolvedPath: resolved,
          linkClass: status,
          criticalScope: isCritical ? "CRITICAL" : "NON_CRITICAL",
          recommendedAction:
            status === "HISTORICAL_LINK"
              ? "ADD_HISTORICAL_BANNER_IF_MISSING"
              : isCritical
                ? "FIX_LINK"
                : "RECORD_ONLY",
        });
      }
    }

    inventory.push({
      path: rel,
      fileName: path.basename(abs),
      extension: path.extname(abs).toLowerCase(),
      size,
      createdOrFirstCommit: "",
      lastModifiedOrLastCommit: "",
      title,
      declaredStatus,
      declaredVersion,
      declaredDate,
      module: moduleOf(rel),
      documentType: classification,
      referencedBy: "",
      references: links.slice(0, 20).join("|"),
      containsCurrentClaim: containsCurrentClaim ? "true" : "false",
      containsFrozenClaim: containsFrozenClaim ? "true" : "false",
      containsRetiredClaim: containsRetiredClaim ? "true" : "false",
      duplicateGroup: hash ? hash.slice(0, 12) : "",
      classification,
      recommendedAction,
      contentHash: hash,
    });
  }

  // fill referencedBy
  for (const row of inventory) {
    const refs = referencedBy.get(row.path) || [];
    row.referencedBy = refs.slice(0, 15).join("|");
  }

  writeCsv(
    path.join(out, "docs_inventory.csv"),
    [
      "path",
      "fileName",
      "extension",
      "size",
      "createdOrFirstCommit",
      "lastModifiedOrLastCommit",
      "title",
      "declaredStatus",
      "declaredVersion",
      "declaredDate",
      "module",
      "documentType",
      "referencedBy",
      "references",
      "containsCurrentClaim",
      "containsFrozenClaim",
      "containsRetiredClaim",
      "duplicateGroup",
      "classification",
      "recommendedAction",
    ],
    inventory
  );

  writeCsv(
    path.join(out, "docs_classification.csv"),
    ["path", "classification", "module", "recommendedAction", "declaredStatus", "containsCurrentClaim"],
    inventory.map((r) => ({
      path: r.path,
      classification: r.classification,
      module: r.module,
      recommendedAction: r.recommendedAction,
      declaredStatus: r.declaredStatus,
      containsCurrentClaim: r.containsCurrentClaim,
    }))
  );

  // duplicates: same content hash with >1 file, prefer docs-like
  const dupRows = [];
  let dupId = 1;
  for (const [hash, group] of contentHashGroups) {
    if (group.length < 2) continue;
    if (hash.startsWith("size:")) continue;
    const sorted = [...group].sort();
    const canonical =
      sorted.find((p) => p.startsWith("docs/acceptance/")) ||
      sorted.find((p) => p.startsWith("docs/current/")) ||
      sorted.find((p) => p.startsWith("docs/supporting/")) ||
      sorted.find((p) => p.startsWith("docs/framework_snapshots/")) ||
      sorted[0];
    const actions = sorted.map((p) =>
      p === canonical
        ? "KEEP_CANONICAL"
        : p.startsWith("docs/tone-v2/") || p.startsWith("docs/_scratch")
          ? "DELETE_EXACT_DUPLICATE"
          : "REQUIRES_REVIEW"
    );
    dupRows.push({
      duplicateGroupId: `DUP-${String(dupId++).padStart(4, "0")}`,
      files: sorted.join("|"),
      fileCount: sorted.length,
      canonicalFile: canonical,
      reasonCanonical: canonical.startsWith("docs/acceptance/")
        ? "Acceptance formal pack preferred"
        : "First stable hierarchy path",
      actions: actions.join("|"),
      contentHash: hash.slice(0, 16),
    });
  }
  writeCsv(
    path.join(out, "duplicate_document_groups.csv"),
    [
      "duplicateGroupId",
      "files",
      "fileCount",
      "canonicalFile",
      "reasonCanonical",
      "actions",
      "contentHash",
    ],
    dupRows
  );

  // SSOT conflict matrix
  const ssotRows = [];
  const concerns = [
    "Overall Architecture",
    "Runtime Pipeline",
    "ASR Post-Processing",
    "Tone Runtime",
    "Tone Training",
    "Syllable / Window",
    "Recall",
    "Lexicon Source",
    "Atomicity",
    "Domain SSOT",
    "Domain Vote",
    "Assembly",
    "CrossPath",
    "KenLM Runtime",
    "KenLM Training",
    "JobResult",
    "Diagnostics",
    "Testing",
    "Framework Snapshot",
    "Documentation Governance",
  ];

  const authorityByConcern = {
    "Overall Architecture":
      "docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md",
    "Runtime Pipeline": "docs/tone-v2/Runtime_SSOT_Contract_Freeze.md",
    "ASR Post-Processing": "docs/current/INDEX.md",
    "Tone Runtime":
      "docs/tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md",
    "Tone Training": "docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md",
    "Syllable / Window":
      "docs/supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md",
    Recall: "docs/supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md",
    "Lexicon Source": "docs/tone-v2/Lexicon_Domain_Contract_Freeze_V1.md",
    Atomicity:
      "docs/tone-v2/FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md",
    "Domain SSOT": "docs/tone-v2/Lexicon_Domain_Contract_Freeze_V1.md",
    "Domain Vote": "docs/fw-detector/recall/DOMAIN_RECALL.md",
    Assembly: "docs/fw-detector/assembly/FROZEN_V1_2.md",
    CrossPath: "docs/tone-v2/Runtime_SSOT_Contract_Freeze.md",
    "KenLM Runtime": "docs/fw-detector/kenlm/KENLM_RUNTIME.md",
    "KenLM Training": "docs/fw-detector/kenlm/KENLM_RUNTIME.md",
    JobResult: "docs/fw-detector/INTERFACE_FREEZE.md",
    Diagnostics: "docs/fw-detector/diagnostics/FROZEN.md",
    Testing: "docs/acceptance/README.md",
    "Framework Snapshot":
      "docs/framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md",
    "Documentation Governance": "docs/current/DOCUMENTATION_GOVERNANCE.md",
  };

  for (const concern of concerns) {
    const currentAuthority = authorityByConcern[concern] || "";
    const competing = inventory
      .filter(
        (r) =>
          r.classification === "CURRENT_SSOT" &&
          r.path !== currentAuthority &&
          (r.containsCurrentClaim === "true" ||
            r.path.includes("FROZEN") ||
            r.path.includes("Freeze"))
      )
      .map((r) => r.path)
      .filter((p) => {
        // light heuristic overlap
        const c = concern.toLowerCase();
        const pl = p.toLowerCase();
        if (c.includes("kenlm") && pl.includes("kenlm")) return true;
        if (c.includes("domain") && pl.includes("domain")) return true;
        if (c.includes("tone") && pl.includes("tone")) return true;
        if (c.includes("recall") && pl.includes("recall")) return true;
        if (c.includes("assembly") && pl.includes("assembly")) return true;
        if (c.includes("documentation") && pl.includes("documentation"))
          return true;
        return false;
      })
      .slice(0, 8);

    // Supporting Index dual-listing of CURRENT paths
    const dualListedInSupporting =
      concern !== "Documentation Governance" &&
      currentAuthority &&
      (currentAuthority.startsWith("docs/fw-detector/") ||
        currentAuthority.startsWith("docs/tone-v2/"));

    ssotRows.push({
      concern,
      currentAuthority,
      competingDocuments: competing.join("|"),
      conflictType: dualListedInSupporting
        ? "DUAL_INDEX_LISTING_SUPPORTING_AND_CURRENT"
        : competing.length
          ? "POTENTIAL_OVERLAP_CLAIM"
          : "NONE",
      recommendedAuthority: currentAuthority,
      documentsToDemote: dualListedInSupporting
        ? "docs/supporting/INDEX.md listing (demote to pointer-only)"
        : competing.slice(0, 3).join("|"),
      action: dualListedInSupporting
        ? "UPDATE_SUPPORTING_INDEX_REMOVE_AUTHORITY_CLAIM"
        : competing.length
          ? "REQUIRES_REVIEW"
          : "KEEP",
    });
  }

  writeCsv(
    path.join(out, "ssot_conflict_matrix.csv"),
    [
      "concern",
      "currentAuthority",
      "competingDocuments",
      "conflictType",
      "recommendedAuthority",
      "documentsToDemote",
      "action",
    ],
    ssotRows
  );

  writeCsv(
    path.join(out, "broken_link_inventory.csv"),
    [
      "sourcePath",
      "linkText",
      "resolvedPath",
      "linkClass",
      "criticalScope",
      "recommendedAction",
    ],
    brokenLinks
  );

  // orphans: md under docs not referenced and not index/authority/acceptance root
  const orphanRows = [];
  for (const row of inventory) {
    if (!row.path.startsWith("docs/")) continue;
    if (row.extension !== ".md") continue;
    const refs = referencedBy.get(row.path) || [];
    if (refs.length > 0) continue;
    if (
      row.path.endsWith("/INDEX.md") ||
      row.path.endsWith("/README.md") ||
      row.path === "docs/current/INDEX.md" ||
      CURRENT_AUTHORITIES.some((a) => a.path === row.path)
    ) {
      continue;
    }
    let orphanClass = "UNKNOWN";
    if (row.classification === "ACCEPTANCE_RECORD") orphanClass = "UNINDEXED_ACCEPTANCE";
    else if (row.classification === "CURRENT_SSOT") orphanClass = "UNINDEXED_CURRENT";
    else if (
      row.classification === "HISTORICAL" ||
      row.classification === "SUPERSEDED" ||
      row.classification === "RETIRED"
    )
      orphanClass = "UNIQUE_HISTORICAL";
    else if (row.classification === "SCRATCH" || row.classification === "EXPERIMENTAL")
      orphanClass = "TEMPORARY";
    else if (row.path.includes("/_audit_scratch/")) orphanClass = "GENERATED";

    orphanRows.push({
      path: row.path,
      classification: row.classification,
      orphanClass,
      recommendedAction:
        orphanClass === "UNINDEXED_CURRENT"
          ? "ADD_TO_CURRENT_INDEX_OR_DEMOTE"
          : orphanClass === "UNINDEXED_ACCEPTANCE"
            ? "ENSURE_PACK_README_AND_PARENT_INDEX"
            : "KEEP_OR_ARCHIVE_NO_DELETE",
    });
  }
  writeCsv(
    path.join(out, "orphan_document_inventory.csv"),
    ["path", "classification", "orphanClass", "recommendedAction"],
    orphanRows
  );

  const counts = {};
  for (const r of inventory) {
    counts[r.classification] = (counts[r.classification] || 0) + 1;
  }

  const summary = {
    scannedFiles: inventory.length,
    classificationCounts: counts,
    duplicateGroups: dupRows.length,
    brokenLinksTotal: brokenLinks.length,
    brokenLinksCritical: brokenLinks.filter((b) => b.criticalScope === "CRITICAL")
      .length,
    orphans: orphanRows.length,
    currentAuthorities: CURRENT_AUTHORITIES.length,
    outDir: relRepo(out),
  };
  fs.writeFileSync(
    path.join(out, "_phase1_audit_summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
    "utf8"
  );

  console.log(JSON.stringify(summary, null, 2));
}

main();
