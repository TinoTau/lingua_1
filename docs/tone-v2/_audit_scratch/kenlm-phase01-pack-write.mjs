#!/usr/bin/env node
/**
 * KenLM Phase 01 pack writer — honest competition baseline from real evidence.
 * READ ONLY relative to production code/models.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.join(REPO, "docs/acceptance/Audit/2026-08-04_KenLM_Phase01_Baseline");

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
function writeCsv(file, headers, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n") +
      "\n",
    "utf8"
  );
}

const capabilityCand = parseCsv(
  fs.readFileSync(
    path.join(
      REPO,
      "docs/acceptance/Freeze/2026-08-03_KenLM_Capability_Baseline_Audit/kenlm_capability_baseline_candidates.csv"
    ),
    "utf8"
  )
);
const diversity = JSON.parse(
  fs.readFileSync(
    path.join(
      REPO,
      "docs/acceptance/Freeze/2026-08-03_KenLM_Capability_Baseline_Audit/diversity_analysis.json"
    ),
    "utf8"
  )
);
const recoveryKenlm = parseCsv(
  fs.readFileSync(
    path.join(
      REPO,
      "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/runtime_kenlm_input.csv"
    ),
    "utf8"
  )
);
const recoveryCross = parseCsv(
  fs.readFileSync(
    path.join(
      REPO,
      "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/runtime_crosspath_candidates.csv"
    ),
    "utf8"
  )
);
const dialogExport = parseCsv(
  fs.readFileSync(
    path.join(
      REPO,
      "docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv"
    ),
    "utf8"
  )
);

// --- dialog_200 KenLM input stage only ---
const kenlmStage = dialogExport.filter((r) => r.stage === "kenlmInput");
const kenlmByCase = new Map();
for (const r of kenlmStage) {
  if (!kenlmByCase.has(r.caseId)) kenlmByCase.set(r.caseId, []);
  kenlmByCase.get(r.caseId).push(r);
}
let dialogKenlmDistinctComp = 0;
let dialogKenlmSingleOrIdent = 0;
const dialogHist = {};
const dialogSelection = [];
for (const [caseId, rs] of kenlmByCase) {
  const texts = [...new Set(rs.map((r) => r.candidateText))];
  dialogHist[texts.length] = (dialogHist[texts.length] || 0) + 1;
  const n = rs.length;
  if (n >= 2 && texts.length >= 2) {
    dialogKenlmDistinctComp++;
    dialogSelection.push({
      caseId,
      suite: "dialog_200_kenlmInput_stage",
      rawSentence: rs[0].rawText,
      candidateCount: n,
      distinctTextCount: texts.length,
      selected: "INCLUDED",
      exclusionReason: "",
      evidence: "dialog200_all_candidate_sentences.csv#kenlmInput",
    });
  } else {
    dialogKenlmSingleOrIdent++;
    dialogSelection.push({
      caseId,
      suite: "dialog_200_kenlmInput_stage",
      rawSentence: rs[0].rawText,
      candidateCount: n,
      distinctTextCount: texts.length,
      selected: "EXCLUDED",
      exclusionReason:
        n < 2
          ? "No Competition (kenlmInput count<2)"
          : "No Competition (identical kenlmInput texts)",
      evidence: "dialog200_all_candidate_sentences.csv#kenlmInput",
    });
  }
}

// --- capability baseline: nominal vs distinct ---
const capBy = new Map();
for (const r of capabilityCand) {
  if (!capBy.has(r.caseId)) capBy.set(r.caseId, []);
  capBy.get(r.caseId).push(r);
}
let capDistinct = 0;
let capIdent = 0;
const capHist = {};
const ranking = [];
const kenlmInput = [];
const kenlmOutput = [];
const scoreDist = [];
const selection = [...dialogSelection];

for (const [caseId, rs] of capBy) {
  const texts = [...new Set(rs.map((r) => r.candidateText))];
  capHist[rs.length] = (capHist[rs.length] || 0) + 1;
  if (texts.length >= 2) {
    capDistinct++;
    selection.push({
      caseId,
      suite: rs[0].suite + "_capability_baseline",
      rawSentence: rs[0].rawText,
      candidateCount: rs.length,
      distinctTextCount: texts.length,
      selected: "INCLUDED",
      exclusionReason: "",
      evidence: "kenlm_capability_baseline_candidates.csv",
    });
    let ord = 0;
    for (const r of rs) {
      ranking.push({
        caseId,
        rawSentence: r.rawText,
        candidateId: r.candidateId,
        candidateText: r.candidateText,
        candidateSource: r.sourcePath || "",
        bucket: r.bucketDomain || "",
        isRaw: r.isRaw,
        candidateRankBeforeKenLM: r.isRaw === "true" ? 0 : "",
        kenlmRank: r.rank,
        kenlmScore: r.kenlmScore,
        normalizedScore: r.normalizedScore,
        selected: String(r.selectedText === r.candidateText),
        deltaVsRaw: r.deltaVsRaw,
      });
      kenlmInput.push({
        caseId,
        candidateId: r.candidateId,
        candidateText: r.candidateText,
        inputOrder: ord++,
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
        lengthPenalty: "",
        oovPenalty: "",
        note: "Feature columns empty — prior baseline did not export length/oov penalties",
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
  } else {
    capIdent++;
    selection.push({
      caseId,
      suite: rs[0].suite + "_capability_baseline",
      rawSentence: rs[0].rawText,
      candidateCount: rs.length,
      distinctTextCount: texts.length,
      selected: "EXCLUDED",
      exclusionReason: "No Competition (identical texts despite candidateCount>=2)",
      evidence: "kenlm_capability_baseline_candidates.csv + diversity_analysis.json",
    });
    // Still export KenLM in/out for transparency of what was scored (identical pool)
    let ord = 0;
    for (const r of rs) {
      kenlmInput.push({
        caseId,
        candidateId: r.candidateId,
        candidateText: r.candidateText,
        inputOrder: ord++,
        isRaw: r.isRaw,
        poolNote: "identical_text_pool_not_evaluable",
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
        lengthPenalty: "",
        oovPenalty: "",
        poolNote: "identical_text_pool_not_evaluable",
      });
      scoreDist.push({
        caseId,
        candidateId: r.candidateId,
        isRaw: r.isRaw,
        lmScore: r.kenlmScore,
        deltaVsRaw: r.deltaVsRaw,
        rank: r.rank,
        poolNote: "identical_text_pool_not_evaluable",
      });
    }
  }
}

// --- recovery: the only known distinct CrossPath competition ---
const recoveryBy = new Map();
for (const r of recoveryKenlm) {
  if (!recoveryBy.has(r.caseId)) recoveryBy.set(r.caseId, []);
  recoveryBy.get(r.caseId).push(r);
}
const recoveryComp = [];
for (const [caseId, rs] of recoveryBy) {
  const texts = [...new Set(rs.map((r) => r.sentence))];
  const eligible = rs.filter((r) => r.eligible === "true" || r.kenlmScore !== "SKIPPED_NO_REPAIR_CANDIDATE_IN_CROSSPATH");
  if (texts.length >= 2) {
    recoveryComp.push({ caseId, texts, rows: rs });
    selection.push({
      caseId,
      suite: "recall_candidate_recovery_runtime",
      rawSentence: rs.find((r) => r.isRaw === "true")?.sentence || rs[0].sentence,
      candidateCount: rs.length,
      distinctTextCount: texts.length,
      selected: "INCLUDED_POOL_BUT_SCORES_UNUSABLE",
      exclusionReason:
        "Distinct Raw+nonRaw present in CrossPath/KenLM input CSV, but kenlmScore recorded as 0 / not a discriminative scored batch for Phase01 ranking metrics",
      evidence: "runtime_kenlm_input.csv",
    });
    let ord = 0;
    for (const r of rs) {
      const cid = `${caseId}:rec:${ord}`;
      ranking.push({
        caseId,
        rawSentence: rs.find((x) => x.isRaw === "true")?.sentence || "",
        candidateId: cid,
        candidateText: r.sentence,
        candidateSource: "CrossPath",
        bucket: "",
        isRaw: r.isRaw,
        candidateRankBeforeKenLM: ord,
        kenlmRank: "",
        kenlmScore: r.kenlmScore,
        normalizedScore: "",
        selected: "",
        deltaVsRaw: "",
        note: "Recovery probe; scores not usable for ranking baseline",
      });
      kenlmInput.push({
        caseId,
        candidateId: cid,
        candidateText: r.sentence,
        inputOrder: ord,
        isRaw: r.isRaw,
        poolNote: "recovery_distinct_pool",
      });
      kenlmOutput.push({
        caseId,
        candidateId: cid,
        candidateText: r.sentence,
        lmScore: r.kenlmScore,
        normalizedScore: "",
        rank: "",
        selected: "",
        deltaVsRaw: "",
        lengthPenalty: "",
        oovPenalty: "",
        poolNote: "recovery_distinct_pool_scores_unusable",
      });
      ord++;
    }
  } else {
    selection.push({
      caseId,
      suite: "recall_candidate_recovery_runtime",
      rawSentence: rs[0].sentence,
      candidateCount: rs.length,
      distinctTextCount: texts.length,
      selected: "EXCLUDED",
      exclusionReason: rs[0].firstFailure
        ? `No Competition — ${rs[0].kenlmScore || rs[0].firstFailure}`
        : "No Competition (raw-only)",
      evidence: "runtime_kenlm_input.csv",
    });
  }
}

const evaluableScoredDistinct = capDistinct; // 0 from capability
const realDistinctPools = evaluableScoredDistinct + recoveryComp.length;

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
    "evidence",
  ],
  selection
);

writeCsv(path.join(OUT, "candidate_distribution.csv"), ["bucket", "count", "note"], [
  {
    bucket: "dialog200_kenlmInput_cases",
    count: kenlmByCase.size,
    note: "stage=kenlmInput only",
  },
  {
    bucket: "dialog200_kenlmInput_distinctText>=2",
    count: dialogKenlmDistinctComp,
    note: "true ranking competition at KenLM gate",
  },
  {
    bucket: "dialog200_kenlmInput_no_competition",
    count: dialogKenlmSingleOrIdent,
    note: "count<2 or identical texts",
  },
  {
    bucket: "capability_baseline_cases",
    count: capBy.size,
    note: "scored via real scoreBatch",
  },
  {
    bucket: "capability_baseline_distinctText>=2",
    count: capDistinct,
    note: "evaluable for ranking metrics",
  },
  {
    bucket: "capability_baseline_identical_pool_count>=2",
    count: capIdent,
    note: "NOT evaluable — Raw duplicated / same sentence",
  },
  {
    bucket: "recovery_runtime_distinctText>=2",
    count: recoveryComp.length,
    note: "center-01 only; scores unusable (0)",
  },
  ...Object.entries(dialogHist).map(([k, v]) => ({
    bucket: `dialog200_kenlmInput_distinctHist_${k}`,
    count: v,
    note: "histogram of distinct texts per case",
  })),
  ...Object.entries(capHist).map(([k, v]) => ({
    bucket: `capability_candidateCountHist_${k}`,
    count: v,
    note: "nominal candidateCount histogram",
  })),
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
    "note",
  ],
  ranking
);
writeCsv(
  path.join(OUT, "kenlm_input.csv"),
  ["caseId", "candidateId", "candidateText", "inputOrder", "isRaw", "poolNote"],
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
    "lengthPenalty",
    "oovPenalty",
    "poolNote",
    "note",
  ],
  kenlmOutput
);
writeCsv(
  path.join(OUT, "kenlm_score_distribution.csv"),
  ["caseId", "candidateId", "isRaw", "lmScore", "deltaVsRaw", "rank", "poolNote"],
  scoreDist
);

writeCsv(
  path.join(OUT, "failure_analysis.csv"),
  ["caseId", "failureClass", "reason", "evidence"],
  [
    {
      caseId: "_CORPUS_",
      failureClass: "OTHER",
      reason:
        "dialog_200 restored corpus: Raw already equals intended text for nearly all cases → CrossPath/KenLM pools lack distinct alternate sentences",
      evidence: "diversity_analysis.json; dialog200 kenlmInput distinct competition=0",
    },
    {
      caseId: "_CAPABILITY_BASELINE_",
      failureClass: "LM_SCORE_CLOSE",
      reason:
        "Where candidateCount>=2, texts are identical → maxDelta=0, scoreTieRate=1; ranking metrics undefined",
      evidence: "kenlm_capability_case_summary.csv; summary.json scoreTieRate",
    },
    {
      caseId: "center-01",
      failureClass: "OTHER",
      reason:
        "Only recovery Case with Raw+Correct distinct CrossPath texts; KenLM scores recorded as 0 in recovery export — cannot claim ranking ability",
      evidence: "runtime_kenlm_input.csv",
    },
    {
      caseId: "_NOISE_INVENTORY_",
      failureClass: "OTHER",
      reason:
        "6/7 noise cases Raw-only at KenLM (no repair candidate); excluded as No Competition",
      evidence: "Recall Candidate Recovery + A-class upstream audits",
    },
  ]
);

writeCsv(
  path.join(OUT, "oov_analysis.csv"),
  ["caseId", "candidateId", "oovTokens", "oovCount", "note"],
  [
    {
      caseId: "_ALL_",
      candidateId: "",
      oovTokens: "",
      oovCount: "",
      note: "No per-candidate OOV fields in frozen capability baseline export; warmup sampleOov=0 only. Not inferred.",
    },
  ]
);

const summary = {
  baseline: "FW_V4_FREEZE_2026_08_03",
  task: "KENLM_PHASE01_BASELINE_AUDIT",
  phase: "KENLM Phase 01",
  nature: "READ_ONLY",
  codeChanged: false,
  modelChanged: false,
  recallChanged: false,
  definition: {
    competitionForKenlmEval:
      "candidateCount>=2 AND distinct candidateText>=2 on the sentences actually sent to KenLM",
    excluded: "Raw-only pools; identical-text duplicate pools; fabricated expected sentences",
  },
  evidence: {
    capabilityBaseline:
      "docs/acceptance/Freeze/2026-08-03_KenLM_Capability_Baseline_Audit/",
    dialog200Export:
      "docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv",
    recovery:
      "docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/",
  },
  metrics: {
    dialog200_kenlmInput_cases: kenlmByCase.size,
    dialog200_kenlmInput_distinctCompetition: dialogKenlmDistinctComp,
    capability_scored_cases: capBy.size,
    capability_distinctCompetition: capDistinct,
    recovery_distinctCompetitionPools: recoveryComp.length,
    recovery_scoredUsableForRanking: 0,
    evaluableScoredDistinctCompetitionCases: evaluableScoredDistinct,
    realDistinctPoolsObservedIncludingUnscored: realDistinctPools,
  },
  diversityPrior: diversity,
  answers: {
    Q1_realCompetitionCases: evaluableScoredDistinct,
    Q1_detail: {
      dialog200_kenlmInput_distinct: dialogKenlmDistinctComp,
      capability_baseline_distinct: capDistinct,
      recovery_distinct_pool_but_scores_unusable: recoveryComp.length,
    },
    Q2_candidatesKenlmActuallyRankedEvaluable: 0,
    Q2_note:
      "KenLM scored 207 capability cases via scoreBatch, but 0 had distinct-text competition; identical pools are not ranking evaluations",
    Q3_rawLongTermFirst:
      "Among identical-text dialog_200/capability pools: Raw always selected (pickedIsRaw=true) with maxDelta=0 — not evidence of ranking skill",
    Q4_clearRankingAbility: "CANNOT_EVALUATE — insufficient distinct-text competition sample with usable scores",
    Q5_next:
      "Collect more Runtime Trace / CrossPath cases where Raw and at least one distinct non-Raw sentence both reach KenLM (prefer noise/repair dialogs). Do NOT retrain KenLM or expand corpus for ranking claims until that sample exists. Lexicon/Recall quality work may be needed upstream to create competition — that is not KenLM model tuning.",
  },
  rankingMetrics: {
    Top1Accuracy: null,
    Top2Recall: null,
    MRR: null,
    MeanRank: null,
    AverageScoreGap: null,
    reason: "No ground-truth ranking eval set with distinct scored competitors",
  },
  runtimeBlocked: false,
  finalVerdict: "KENLM_DATA_INSUFFICIENT",
};

fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
