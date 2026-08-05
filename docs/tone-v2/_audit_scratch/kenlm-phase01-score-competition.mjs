#!/usr/bin/env node
/**
 * KenLM Phase 01 — score REAL dialog_200 kenlmInput competition pools (READ ONLY).
 * Uses existing CrossPath/KenLM-input texts from dialog200 export; calls scoreBatch only.
 * No model retrain, no Recall/Assembly/Framework changes.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "../../..");
const electronRoot = path.join(repo, "electron_node/electron-node");
const dist = path.join(electronRoot, "dist/main/electron-node/main/src");
const OUT = path.join(repo, "docs/acceptance/Audit/2026-08-04_KenLM_Phase01_Baseline");
const EXPORT_CSV = path.join(
  repo,
  "docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv"
);

fs.mkdirSync(OUT, { recursive: true });
process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, "package.json"));

const { createKenlmBatchScorer } = require(
  path.join(dist, "asr-repair/sentence-rerank/kenlm-scorer.js")
);
const {
  resolveCharLmModelPath,
  resolveKenlmQueryPath,
  isKenlmSubprocessRunnable,
  getSentenceKenlmRuntimeStatus,
  runKenlmQueryBatch,
} = require(path.join(dist, "phonetic-correction/lm-scorer.js"));
const { tokenizeForLm } = require(path.join(dist, "phonetic-correction/char-tokenize.js"));

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
  fs.writeFileSync(
    file,
    [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n") +
      "\n",
    "utf8"
  );
}
function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

const rows = parseCsv(fs.readFileSync(EXPORT_CSV, "utf8")).filter((r) => r.stage === "kenlmInput");
const byCase = new Map();
for (const r of rows) {
  if (!byCase.has(r.caseId)) byCase.set(r.caseId, []);
  byCase.get(r.caseId).push(r);
}

const competition = [];
const excluded = [];
for (const [caseId, rs] of byCase) {
  // dedupe by candidateText preserving order
  const seen = new Set();
  const uniq = [];
  for (const r of rs) {
    if (seen.has(r.candidateText)) continue;
    seen.add(r.candidateText);
    uniq.push(r);
  }
  if (uniq.length >= 2) {
    competition.push({ caseId, rawText: rs[0].rawText, candidates: uniq });
  } else {
    excluded.push({
      caseId,
      rawSentence: rs[0].rawText,
      candidateCount: rs.length,
      distinctTextCount: uniq.length,
      selected: "EXCLUDED",
      exclusionReason: "No Competition",
      evidence: "kenlmInput stage",
    });
  }
}

console.log(
  JSON.stringify(
    {
      kenlmInputCases: byCase.size,
      competitionCases: competition.length,
      excluded: excluded.length,
    },
    null,
    2
  )
);

const modelPath = resolveCharLmModelPath();
const queryPath = resolveKenlmQueryPath();
const status = getSentenceKenlmRuntimeStatus();
const runnable = modelPath ? isKenlmSubprocessRunnable(modelPath, queryPath) : false;

if (!runnable || !modelPath || !fs.existsSync(modelPath)) {
  const summary = {
    baseline: "FW_V4_FREEZE_2026_08_03",
    task: "KENLM_PHASE01_BASELINE_AUDIT",
    finalVerdict: "KENLM_RUNTIME_BLOCKED",
    reason: "KenLM subprocess not runnable or model missing",
    modelPath,
    queryPath,
    runnable,
    status,
    competitionCasesFound: competition.length,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(2);
}

const proofToken = tokenizeForLm("你好世界");
let warmup = await runKenlmQueryBatch(modelPath, queryPath, [proofToken], 120000);
if (!warmup.ok) warmup = await runKenlmQueryBatch(modelPath, queryPath, [proofToken], 120000);
console.log("warmup", warmup?.ok, warmup?.ok ? warmup.wallMs : warmup?.reason);

const scorer = createKenlmBatchScorer();
if (!scorer) {
  console.error("createKenlmBatchScorer returned null");
  process.exit(2);
}

const selection = [...excluded];
const ranking = [];
const kenlmInput = [];
const kenlmOutput = [];
const scoreDist = [];
const failure = [];
const oovRows = [];
const hist = {};

let rawTop1 = 0;
let nonRawTop1 = 0;
let scoredCand = 0;
const gaps = [];
const rawFirstAlwaysFlags = [];

for (const c of competition) {
  const texts = c.candidates.map((x) => x.candidateText);
  hist[texts.length] = (hist[texts.length] || 0) + 1;

  // Identify raw: exact match to rawText
  const marked = c.candidates.map((cand, i) => ({
    ...cand,
    candidateId: `${c.caseId}:k${i}`,
    isRaw: cand.candidateText === c.rawText,
    inputOrder: i,
  }));
  // ensure at least one raw flag if raw present in pool
  if (!marked.some((m) => m.isRaw) && texts.includes(c.rawText)) {
    const hit = marked.find((m) => m.candidateText === c.rawText);
    if (hit) hit.isRaw = true;
  }

  selection.push({
    caseId: c.caseId,
    rawSentence: c.rawText,
    candidateCount: marked.length,
    distinctTextCount: marked.length,
    selected: "INCLUDED",
    exclusionReason: "",
    evidence: "dialog200 kenlmInput distinct texts",
  });

  const scoreRes = await scorer.scoreBatch(texts);
  const scores = scoreRes?.scores || [];
  const lmScores = texts.map((_, i) => {
    const s = scores[i];
    if (s == null) return { score: NaN, oov: null };
    return {
      score: Number(s.score ?? NaN),
      oov: s.oovCount ?? null,
    };
  });

  const baselineRaw =
    marked.find((m) => m.isRaw)?.candidateText != null
      ? lmScores[marked.findIndex((m) => m.isRaw)]?.score
      : lmScores[0]?.score;

  const ranked = marked
    .map((m, i) => ({
      ...m,
      lmScore: lmScores[i].score,
      oovCount: lmScores[i].oov,
      deltaVsRaw:
        baselineRaw != null && Number.isFinite(baselineRaw)
          ? lmScores[i].score - baselineRaw
          : "",
    }))
    .sort((a, b) => b.lmScore - a.lmScore); // higher log score better? KenLM raw log is typically more negative = worse. Check prior: scores like -79, higher (less negative) is better.

  // Prior baseline used kenlmScore negative; rank 1 = best = max score (least negative)
  ranked.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  const top1 = ranked[0];
  if (top1.isRaw) rawTop1++;
  else nonRawTop1++;
  rawFirstAlwaysFlags.push(top1.isRaw);

  const absGaps = ranked
    .filter((r) => !r.isRaw)
    .map((r) => Math.abs(Number(r.deltaVsRaw)));
  if (absGaps.length) gaps.push(...absGaps);
  const maxGap = absGaps.length ? Math.max(...absGaps) : 0;

  if (maxGap < 1e-9) {
    failure.push({
      caseId: c.caseId,
      failureClass: "LM_SCORE_CLOSE",
      reason: "All competitors have ~identical KenLM score vs raw",
      maxAbsDelta: maxGap,
      top1IsRaw: top1.isRaw,
    });
  } else if (!top1.isRaw) {
    failure.push({
      caseId: c.caseId,
      failureClass: "OTHER",
      reason: "Non-raw candidate ranked Top1 (score gap present) — inspect domain/noise",
      maxAbsDelta: maxGap,
      top1IsRaw: false,
      top1Text: top1.candidateText,
    });
  }

  for (const m of marked) {
    scoredCand++;
    const scored = ranked.find((r) => r.candidateId === m.candidateId);
    kenlmInput.push({
      caseId: c.caseId,
      candidateId: m.candidateId,
      candidateText: m.candidateText,
      inputOrder: m.inputOrder,
      isRaw: m.isRaw,
    });
    kenlmOutput.push({
      caseId: c.caseId,
      candidateId: m.candidateId,
      candidateText: m.candidateText,
      lmScore: scored.lmScore,
      normalizedScore: "",
      rank: scored.rank,
      selected: scored.rank === 1 ? "true" : "false",
      deltaVsRaw: scored.deltaVsRaw,
      lengthPenalty: "",
      oovPenalty: "",
      oovCount: scored.oovCount ?? "",
    });
    ranking.push({
      caseId: c.caseId,
      rawSentence: c.rawText,
      candidateId: m.candidateId,
      candidateText: m.candidateText,
      candidateSource: "kenlmInput_trace",
      bucket: m.bucketDomain || "",
      isRaw: m.isRaw,
      candidateRankBeforeKenLM: m.inputOrder,
      kenlmRank: scored.rank,
      kenlmScore: scored.lmScore,
      normalizedScore: "",
      selected: scored.rank === 1 ? "true" : "false",
      deltaVsRaw: scored.deltaVsRaw,
    });
    scoreDist.push({
      caseId: c.caseId,
      candidateId: m.candidateId,
      isRaw: m.isRaw,
      lmScore: scored.lmScore,
      deltaVsRaw: scored.deltaVsRaw,
      rank: scored.rank,
    });
    if (scored.oovCount != null && scored.oovCount !== "") {
      oovRows.push({
        caseId: c.caseId,
        candidateId: m.candidateId,
        oovTokens: "",
        oovCount: scored.oovCount,
      });
    }
  }
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;

const summary = {
  baseline: "FW_V4_FREEZE_2026_08_03",
  task: "KENLM_PHASE01_BASELINE_AUDIT",
  phase: "KENLM Phase 01",
  nature: "READ_ONLY_SCOREBATCH_ON_REAL_KENLM_INPUT",
  modelIdentity: {
    modelPath,
    modelSha256: sha256File(modelPath),
    modelSizeBytes: fs.statSync(modelPath).size,
    queryPath,
    runnable: true,
    status,
    scoreMode: "raw_log_batch_score",
  },
  warmup: {
    ok: warmup?.ok,
    reason: warmup?.reason,
    wallMs: warmup?.wallMs,
  },
  metrics: {
    kenlmInputCasesTotal: byCase.size,
    competitionCasesDistinctText: competition.length,
    excludedNoCompetition: excluded.length,
    candidatesScored: scoredCand,
    rawTop1Count: rawTop1,
    nonRawTop1Count: nonRawTop1,
    rawTop1Rate: competition.length ? rawTop1 / competition.length : null,
    averageAbsScoreGapVsRaw: avgGap,
    medianAbsScoreGapVsRaw: median(gaps),
    maxAbsScoreGapVsRaw: gaps.length ? Math.max(...gaps) : null,
    minAbsScoreGapVsRaw: gaps.length ? Math.min(...gaps) : null,
    candidateCountHistogram: hist,
  },
  answers: {
    Q1_realCompetitionCases: competition.length,
    Q2_candidatesKenlmRanked: scoredCand,
    Q3_rawLongTermFirst:
      rawTop1 === competition.length
        ? "YES — Raw was Top1 in all competition cases"
        : rawTop1 / competition.length >= 0.8
          ? `MOSTLY — Raw Top1 in ${(100 * rawTop1 / competition.length).toFixed(1)}% of competition cases`
          : `NO — Raw Top1 only ${(100 * rawTop1 / competition.length).toFixed(1)}%`,
    Q4_clearRankingAbility:
      competition.length >= 30 && gaps.some((g) => g > 1e-6)
        ? "YES_WITH_CAVEAT — discriminative score gaps exist on real distinct pools; interpret against Raw-vs-alt quality (alts may be noise variants)"
        : competition.length >= 30
          ? "WEAK — large sample but tiny gaps"
          : "INSUFFICIENT_SAMPLE",
    Q5_next:
      competition.length >= 30
        ? "Both: keep collecting harder Raw+Correct repair competitions; corpus/model tuning only after labeling whether non-raw Top1 is desirable. Prefer measuring on repair-success pools (e.g. center-01 class), not only ASR-noise variants."
        : "Collect more Runtime competition cases before model retrain",
  },
  rankingMetricsNote:
    "No expectedText used. Metrics are Raw-vs-alternates on real KenLM inputs only (not correction accuracy).",
  finalVerdict:
    competition.length >= 30
      ? "KENLM_BASELINE_READY"
      : competition.length === 0
        ? "KENLM_DATA_INSUFFICIENT"
        : "KENLM_DATA_INSUFFICIENT",
};

writeCsv(
  path.join(OUT, "runtime_case_selection.csv"),
  [
    "caseId",
    "rawSentence",
    "candidateCount",
    "distinctTextCount",
    "selected",
    "exclusionReason",
    "evidence",
  ],
  selection
);
writeCsv(path.join(OUT, "candidate_distribution.csv"), ["candidateCount", "caseCount"], [
  ...Object.entries(hist)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([candidateCount, caseCount]) => ({ candidateCount, caseCount })),
  { candidateCount: "competition_total", caseCount: competition.length },
  { candidateCount: "excluded_no_competition", caseCount: excluded.length },
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
    "lengthPenalty",
    "oovPenalty",
    "oovCount",
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
  ["caseId", "failureClass", "reason", "maxAbsDelta", "top1IsRaw", "top1Text"],
  failure
);
writeCsv(
  path.join(OUT, "oov_analysis.csv"),
  ["caseId", "candidateId", "oovTokens", "oovCount"],
  oovRows.length
    ? oovRows
    : [
        {
          caseId: "_NOTE_",
          candidateId: "",
          oovTokens: "",
          oovCount: "",
        },
      ]
);

fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
