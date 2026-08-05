#!/usr/bin/env node
/**
 * KenLM Phase 01 — analyze existing real-runtime candidate exports
 * for distinct-text competition (READ ONLY; no model/runtime changes).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.join(
  REPO,
  "docs/acceptance/Audit/2026-08-04_KenLM_Phase01_Baseline"
);

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
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
function writeCsv(file, headers, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

const sources = {
  capabilityCandidates: path.join(
    REPO,
    "docs/acceptance/Freeze/2026-08-03_KenLM_Capability_Baseline_Audit/kenlm_capability_baseline_candidates.csv"
  ),
  capabilitySummary: path.join(
    REPO,
    "docs/acceptance/Freeze/2026-08-03_KenLM_Capability_Baseline_Audit/kenlm_capability_case_summary.csv"
  ),
  diversity: path.join(
    REPO,
    "docs/acceptance/Freeze/2026-08-03_KenLM_Capability_Baseline_Audit/diversity_analysis.json"
  ),
  recoveryKenlm: path.join(
    REPO,
    "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/runtime_kenlm_input.csv"
  ),
  recoveryCross: path.join(
    REPO,
    "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/runtime_crosspath_candidates.csv"
  ),
  recoveryDiff: path.join(
    REPO,
    "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/runtime_candidate_diff.csv"
  ),
  dialog200Export: path.join(
    REPO,
    "docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv"
  ),
};

const cand = parseCsv(fs.readFileSync(sources.capabilityCandidates, "utf8"));
const byCase = new Map();
for (const r of cand) {
  if (!byCase.has(r.caseId)) byCase.set(r.caseId, []);
  byCase.get(r.caseId).push(r);
}

const selection = [];
const ranking = [];
const kenlmInput = [];
const kenlmOutput = [];
const scoreDist = [];
const failure = [];
const hist = {};

let competitionDistinct = 0;
let nominalCount2Plus = 0;
let noCompetitionIdentical = 0;
let scoredCandidates = 0;
let rawAlwaysTop1 = 0;
let nonRawTop1 = 0;
let nonzeroGap = 0;

for (const [caseId, rows] of byCase) {
  const texts = [...new Set(rows.map((r) => r.candidateText))];
  const n = rows.length;
  hist[n] = (hist[n] || 0) + 1;
  const distinct = texts.length;
  const raw = rows.find((r) => r.isRaw === "true") || rows[0];
  const sorted = [...rows].sort(
    (a, b) => Number(a.rank) - Number(b.rank) || Number(b.kenlmScore) - Number(a.kenlmScore)
  );

  if (n >= 2) nominalCount2Plus++;

  const isRealCompetition = distinct >= 2;
  if (!isRealCompetition) {
    noCompetitionIdentical++;
    selection.push({
      caseId,
      suite: rows[0].suite,
      rawSentence: raw?.rawText || raw?.candidateText || "",
      candidateCount: n,
      distinctTextCount: distinct,
      selected: "EXCLUDED",
      exclusionReason: n < 2 ? "No Competition (count<2)" : "No Competition (identical texts; count>=2 but not ranking-evaluable)",
      maxDelta: rows[0].maxDelta || "0",
      top1IsRaw: sorted[0]?.isRaw === "true" ? "true" : "false",
    });
    continue;
  }

  competitionDistinct++;
  selection.push({
    caseId,
    suite: rows[0].suite,
    rawSentence: raw?.rawText || "",
    candidateCount: n,
    distinctTextCount: distinct,
    selected: "INCLUDED",
    exclusionReason: "",
    maxDelta: rows.map((r) => Number(r.deltaVsRaw || 0)).reduce((a, b) => Math.max(a, Math.abs(b)), 0),
    top1IsRaw: sorted[0]?.isRaw === "true" ? "true" : "false",
  });

  let inputOrder = 0;
  for (const r of rows) {
    scoredCandidates++;
    const beforeRank = r.isRaw === "true" ? 0 : Number(r.rank) || "";
    ranking.push({
      caseId,
      rawSentence: r.rawText,
      candidateId: r.candidateId,
      candidateText: r.candidateText,
      candidateSource: r.sourcePath || r.replacementProvenance || "",
      bucket: r.bucketDomain || "",
      isRaw: r.isRaw,
      candidateRankBeforeKenLM: beforeRank,
      kenlmRank: r.rank,
      kenlmScore: r.kenlmScore,
      normalizedScore: r.normalizedScore,
      selected: r.selectedText === r.candidateText ? "true" : "false",
      deltaVsRaw: r.deltaVsRaw,
    });
    kenlmInput.push({
      caseId,
      candidateId: r.candidateId,
      candidateText: r.candidateText,
      inputOrder: inputOrder++,
      isRaw: r.isRaw,
    });
    kenlmOutput.push({
      caseId,
      candidateId: r.candidateId,
      candidateText: r.candidateText,
      lmScore: r.kenlmScore,
      normalizedScore: r.normalizedScore,
      rank: r.rank,
      selected: String(r.selectedText === r.candidateText),
      deltaVsRaw: r.deltaVsRaw,
      kenlmSubprocessMs: r.kenlmSubprocessMs,
      kenlmSubprocessErrorReason: r.kenlmSubprocessErrorReason,
    });
    scoreDist.push({
      caseId,
      candidateId: r.candidateId,
      isRaw: r.isRaw,
      lmScore: r.kenlmScore,
      deltaVsRaw: r.deltaVsRaw,
      rank: r.rank,
    });
  }

  const top1 = sorted[0];
  if (top1?.isRaw === "true") rawAlwaysTop1++;
  else nonRawTop1++;
  const deltas = rows.map((r) => Math.abs(Number(r.deltaVsRaw || 0)));
  if (Math.max(...deltas) > 1e-9) nonzeroGap++;
  else {
    failure.push({
      caseId,
      failureClass: "LM_SCORE_CLOSE",
      reason: "All candidates share identical KenLM score / zero delta vs raw (no discriminative ranking signal)",
      distinctTextCount: distinct,
      maxAbsDelta: 0,
      top1IsRaw: top1?.isRaw === "true",
    });
  }
}

// Recovery pack: real CrossPath / KenLM input with possible distinct texts
function analyzeRecovery() {
  const out = { cases: [], competition: 0, noComp: 0 };
  if (!fs.existsSync(sources.recoveryKenlm)) return out;
  const rows = parseCsv(fs.readFileSync(sources.recoveryKenlm, "utf8"));
  const m = new Map();
  for (const r of rows) {
    const id = r.caseId || r.utteranceId || r.id || "unknown";
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(r);
  }
  for (const [caseId, rs] of m) {
    const textKey =
      rs[0].candidateText != null
        ? "candidateText"
        : rs[0].text != null
          ? "text"
          : rs[0].sentence != null
            ? "sentence"
            : null;
    if (!textKey) {
      out.noComp++;
      out.cases.push({ caseId, distinct: 0, count: rs.length, note: "no text column" });
      continue;
    }
    const texts = [...new Set(rs.map((r) => r[textKey]))];
    const distinct = texts.length;
    if (distinct >= 2) {
      out.competition++;
      out.cases.push({ caseId, distinct, count: rs.length, texts: texts.slice(0, 5).join(" | ") });
    } else {
      out.noComp++;
      out.cases.push({ caseId, distinct, count: rs.length, note: "identical or single" });
    }
  }
  return out;
}

const recovery = analyzeRecovery();

// dialog200 export if present
function analyzeDialogExport() {
  const out = { present: false, competition: 0, cases: 0 };
  if (!fs.existsSync(sources.dialog200Export)) return out;
  out.present = true;
  const rows = parseCsv(fs.readFileSync(sources.dialog200Export, "utf8"));
  const m = new Map();
  for (const r of rows) {
    const id = r.caseId || r.dialogId || r.id;
    if (!id) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(r);
  }
  out.cases = m.size;
  for (const [, rs] of m) {
    const textKey = ["candidateText", "sentence", "text", "assembledText"].find((k) => rs[0][k] != null);
    if (!textKey) continue;
    const distinct = new Set(rs.map((r) => r[textKey])).size;
    if (distinct >= 2) out.competition++;
  }
  return out;
}
const dialogExport = analyzeDialogExport();

const diversity = fs.existsSync(sources.diversity)
  ? JSON.parse(fs.readFileSync(sources.diversity, "utf8"))
  : null;

fs.mkdirSync(OUT, { recursive: true });

writeCsv(
  path.join(OUT, "runtime_case_selection.csv"),
  [
    "caseId",
    "suite",
    "rawSentence",
    "candidateCount",
    "distinctTextCount",
    "selected",
    "exclusionReason",
    "maxDelta",
    "top1IsRaw",
  ],
  selection
);

writeCsv(path.join(OUT, "candidate_distribution.csv"), ["candidateCount", "caseCount"], [
  ...Object.entries(hist)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([candidateCount, caseCount]) => ({ candidateCount, caseCount })),
  {
    candidateCount: "distinctText>=2_evaluable",
    caseCount: competitionDistinct,
  },
  {
    candidateCount: "nominal_count>=2_but_identical_text",
    caseCount: noCompetitionIdentical,
  },
]);

writeCsv(
  path.join(OUT, "candidate_ranking.csv"),
  [
    "caseId",
    "rawSentence",
    "candidateId",
    "candidateText",
    "candidateSource",
    "bucket",
    "isRaw",
    "candidateRankBeforeKenLM",
    "kenlmRank",
    "kenlmScore",
    "normalizedScore",
    "selected",
    "deltaVsRaw",
  ],
  ranking
);
writeCsv(
  path.join(OUT, "kenlm_input.csv"),
  ["caseId", "candidateId", "candidateText", "inputOrder", "isRaw"],
  kenlmInput
);
writeCsv(
  path.join(OUT, "kenlm_output.csv"),
  [
    "caseId",
    "candidateId",
    "candidateText",
    "lmScore",
    "normalizedScore",
    "rank",
    "selected",
    "deltaVsRaw",
    "kenlmSubprocessMs",
    "kenlmSubprocessErrorReason",
  ],
  kenlmOutput
);
writeCsv(
  path.join(OUT, "kenlm_score_distribution.csv"),
  ["caseId", "candidateId", "isRaw", "lmScore", "deltaVsRaw", "rank"],
  scoreDist
);
writeCsv(
  path.join(OUT, "failure_analysis.csv"),
  ["caseId", "failureClass", "reason", "distinctTextCount", "maxAbsDelta", "top1IsRaw"],
  failure
);

// OOV: prior export may not have per-token oov; derive from summary/invocation if available
const oovRows = [];
for (const r of cand.slice(0, 5)) {
  // placeholder note row if no oov column
}
if (!cand[0] || cand[0].oovCount == null) {
  writeCsv(
    path.join(OUT, "oov_analysis.csv"),
    ["caseId", "candidateId", "oovTokens", "oovCount", "note"],
    [
      {
        caseId: "_ALL_",
        candidateId: "",
        oovTokens: "",
        oovCount: "",
        note: "Prior capability baseline CSV has no per-candidate OOV columns; invocationProof sampleOov=0 on warmup only. Phase01 does not invent OOV without scoreBatch oov fields.",
      },
    ]
  );
}

const summary = {
  baseline: "FW_V4_FREEZE_2026_08_03",
  task: "KENLM_PHASE01_BASELINE_AUDIT",
  nature: "READ_ONLY",
  evidenceSource:
    "docs/acceptance/Freeze/2026-08-03_KenLM_Capability_Baseline_Audit (real scoreBatch dialog_200 + noise inventory)",
  definition: {
    nominalCompetition: "candidateCount >= 2",
    evaluableCompetition: "candidateCount >= 2 AND distinct candidateText >= 2",
  },
  counts: {
    totalCasesInEvidence: byCase.size,
    nominalCandidateCount2Plus: nominalCount2Plus,
    excludedNoCompetitionIdenticalOrSingle: noCompetitionIdentical,
    evaluableDistinctCompetitionCases: competitionDistinct,
    candidatesScoredInEvaluableCases: scoredCandidates,
    rawTop1AmongEvaluable: rawAlwaysTop1,
    nonRawTop1AmongEvaluable: nonRawTop1,
    evaluableWithNonZeroScoreGap: nonzeroGap,
  },
  diversityPrior: diversity,
  recoveryPack: {
    path: "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/",
    competitionDistinct: recovery.competition,
    noCompetition: recovery.noComp,
    sample: recovery.cases.slice(0, 20),
  },
  dialog200CandidateExport: dialogExport,
  answers: {
    Q1_realCompetitionCases: competitionDistinct,
    Q1_note:
      "Nominal count>=2 is large, but diversity_analysis shows distinctText competition = 0 on dialog_200/noise inventory in prior baseline.",
    Q2_candidatesScoredInEvaluable: scoredCandidates,
    Q3_rawLongTermFirst:
      competitionDistinct === 0
        ? "N/A_NO_EVALUABLE_COMPETITION — among identical-text pools Raw is always selected (pickedIsRaw=true) with maxDelta=0"
        : rawAlwaysTop1 === competitionDistinct
          ? "YES"
          : "MIXED",
    Q4_clearRankingAbility:
      competitionDistinct === 0
        ? "CANNOT_EVALUATE — no distinct-text competition sample"
        : nonzeroGap > 0
          ? "HAS_SIGNAL"
          : "NO_DISCRIMINATIVE_SIGNAL",
    Q5_nextOptimizeModelOrCorpus:
      competitionDistinct === 0
        ? "NEITHER_YET — first collect Runtime cases with Raw + distinct non-Raw CrossPath candidates (candidateCount>=2 AND distinctText>=2); do not retrain KenLM on identical-pool data"
        : "DATA_DRIVEN",
  },
  runtimeBlocked: false,
  finalVerdict:
    competitionDistinct >= 30
      ? "KENLM_BASELINE_READY"
      : "KENLM_DATA_INSUFFICIENT",
};

fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
fs.writeFileSync(
  path.join(OUT, "recovery_competition_probe.json"),
  JSON.stringify(recovery, null, 2) + "\n"
);
console.log(JSON.stringify(summary, null, 2));
