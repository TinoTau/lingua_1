#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const actions = [];

function rel(p) {
  return path.relative(REPO, p).split(path.sep).join("/");
}

function hash(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function delFile(relPath, reason) {
  const abs = path.join(REPO, relPath);
  if (!fs.existsSync(abs)) {
    actions.push({
      originalPath: relPath,
      action: "DELETE_EXACT_DUPLICATE",
      newPath: "",
      reason: "Already absent",
      status: "SKIP",
    });
    return;
  }
  fs.unlinkSync(abs);
  actions.push({
    originalPath: relPath,
    action: "DELETE_EXACT_DUPLICATE",
    newPath: "",
    reason,
    status: "DONE",
  });
}

function delDir(relPath, reason) {
  const abs = path.join(REPO, relPath);
  if (!fs.existsSync(abs)) {
    actions.push({
      originalPath: relPath,
      action: "DELETE_EXACT_DUPLICATE",
      newPath: "",
      reason: "Already absent",
      status: "SKIP",
    });
    return;
  }
  fs.rmSync(abs, { recursive: true, force: true });
  actions.push({
    originalPath: relPath,
    action: "DELETE_EXACT_DUPLICATE",
    newPath: "",
    reason,
    status: "DONE",
  });
}

for (const f of [
  "docs/tone-v2/FW_Repair_V4_Candidate_Generation_Failure_Audit_2026_08_03.md",
  "docs/tone-v2/FW_Repair_V4_KenLM_A_Class_Upstream_Candidate_Coverage_Audit_2026_08_03.md",
  "docs/tone-v2/kenlm_validation_case_inventory_resolved.csv",
]) {
  delFile(f, "Exact duplicate of Acceptance formal artifact");
}

for (const d of [
  "docs/tone-v2/_audit_scratch/candidate_generation_failure_2026_08_03",
  "docs/tone-v2/_audit_scratch/kenlm_a_class_upstream_2026_08_03",
  "docs/tone-v2/_audit_scratch/kenlm_capability_baseline_2026_08_03",
]) {
  delDir(d, "Scratch mirror of Acceptance pack");
}

const capTone = "docs/tone-v2/FW_Repair_V4_KenLM_Capability_Baseline_Audit_2026_08_03.md";
const capAcc =
  "docs/acceptance/Freeze/FW_Repair_V4_KenLM_Capability_Baseline_Audit_2026_08_03.md";
const toneAbs = path.join(REPO, capTone);
const accAbs = path.join(REPO, capAcc);
if (fs.existsSync(toneAbs) && fs.existsSync(accAbs)) {
  if (hash(toneAbs) === hash(accAbs)) {
    fs.unlinkSync(toneAbs);
    actions.push({
      originalPath: capTone,
      action: "DELETE_EXACT_DUPLICATE",
      newPath: capAcc,
      reason: "Exact hash match Acceptance",
      status: "DONE",
    });
  } else {
    fs.writeFileSync(
      toneAbs,
      `---
status: SUPERSEDED
superseded_by: ${capAcc}
---

# MOVED

Canonical Acceptance report:

\`${capAcc}\`
`,
      "utf8"
    );
    actions.push({
      originalPath: capTone,
      action: "REPLACE_WITH_POINTER",
      newPath: capAcc,
      reason: "Content differed; pointer stub",
      status: "DONE",
    });
  }
} else if (fs.existsSync(toneAbs)) {
  actions.push({
    originalPath: capTone,
    action: "REQUIRES_REVIEW",
    newPath: "",
    reason: "Acceptance counterpart missing",
    status: "KEEP",
  });
}

const out =
  "docs/acceptance/Documentation/2026-08-03_Docs_Repository_Governance_and_Consolidation/document_cleanup_actions.csv";
const headers = ["originalPath", "action", "newPath", "reason", "status"];
const lines = [headers.join(",")];
for (const a of actions) {
  lines.push(
    headers
      .map((h) => {
        const s = String(a[h] ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(",")
  );
}
fs.writeFileSync(path.join(REPO, out), lines.join("\n") + "\n", "utf8");
console.log(JSON.stringify(actions, null, 2));
