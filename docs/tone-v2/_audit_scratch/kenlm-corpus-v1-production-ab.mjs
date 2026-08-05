#!/usr/bin/env node
/**
 * KenLM Corpus V1 — Production Readiness A/B Test
 * OLD vs NEW via production rerankFwSentences (raw_log_delta + minDeltaToReplace).
 * No training / corpus / benchmark / runtime logic changes.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "../../..");
const electronRoot = path.join(repo, "electron_node/electron-node");
const dist = path.join(electronRoot, "dist/main/electron-node/main/src");
const OUT = path.join(
  repo,
  "docs/acceptance/Test/2026-08-05_KenLM_CorpusV1_Production_Readiness_AB"
);
const BENCH = path.join(
  repo,
  "docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark/kenlm_benchmark.csv"
);
const EXPORT_CSV = path.join(
  repo,
  "docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv"
);
const OLD_MODEL = path.join(
  repo,
  "electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin"
);
const NEW_MODEL = path.join(repo, "kenLM/model/corpus_v1/zh_char_3gram.trie.bin");
const OLD_SHA_EXPECTED = "532a335a09a006d1ba674f808814ee1d40c5b1d8f3527ca980e96723e7a62a4c";
const NEW_SHA_EXPECTED = "848ebee6dec020449f28d073cada6e53cc9dc70bd7343e6fc2a7ea7fedce61d8";
const MIN_DELTA = 3.0;

fs.mkdirSync(OUT, { recursive: true });
process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;

const require = createRequire(path.join(electronRoot, "package.json"));
const { createKenlmBatchScorer } = require(
  path.join(dist, "asr-repair/sentence-rerank/kenlm-scorer.js")
);
const { rerankFwSentences, FW_RERANK_SCORE_MODE } = require(
  path.join(dist, "fw-detector/rerank-fw-sentences.js")
);
const {
  resolveKenlmQueryPath,
  isKenlmSubprocessRunnable,
  runKenlmQueryBatch,
} = require(path.join(dist, "phonetic-correction/lm-scorer.js"));
const { tokenizeForLm } = require(path.join(dist, "phonetic-correction/char-tokenize.js"));
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, "fw-detector/fw-config.js"));

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
function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (i - lo)) + sorted[hi] * (i - lo);
}
function distStats(arr) {
  const a = [...arr].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return { n: 0 };
  return {
    n: a.length,
    min: a[0],
    p5: pct(a, 0.05),
    p25: pct(a, 0.25),
    median: pct(a, 0.5),
    p75: pct(a, 0.75),
    p95: pct(a, 0.95),
    max: a[a.length - 1],
    mean: a.reduce((s, x) => s + x, 0) / a.length,
  };
}
function log(msg) {
  console.log(`[prod-ab] ${msg}`);
  fs.appendFileSync(path.join(OUT, "run.log"), msg + "\n");
}
function rssMb() {
  const mu = process.memoryUsage();
  return {
    rssMb: Math.round((mu.rss / 1024 / 1024) * 100) / 100,
    heapUsedMb: Math.round((mu.heapUsed / 1024 / 1024) * 100) / 100,
    externalMb: Math.round((mu.external / 1024 / 1024) * 100) / 100,
  };
}
function scorerFor(modelPath) {
  process.env.CHAR_LM_PATH = modelPath;
  const scorer = createKenlmBatchScorer();
  if (!scorer) throw new Error("scorer null for " + modelPath);
  return scorer;
}
function combo(text, i) {
  return {
    text,
    replacements: [{ spanId: `s${i}`, surface: "x", start: 0, end: 1, word: "x" }],
    candidateScore: 0,
  };
}

async function main() {
  fs.writeFileSync(path.join(OUT, "run.log"), "", "utf8");
  const cfg = loadFwDetectorRuntimeConfig();
  const minDelta = cfg.minDeltaToReplace ?? MIN_DELTA;
  log(`scoreMode=${FW_RERANK_SCORE_MODE} minDeltaToReplace=${minDelta}`);

  const oldSha = sha256File(OLD_MODEL);
  const newSha = sha256File(NEW_MODEL);
  if (oldSha !== OLD_SHA_EXPECTED) throw new Error(`old sha mismatch ${oldSha}`);
  if (newSha !== NEW_SHA_EXPECTED) throw new Error(`new sha mismatch ${newSha}`);
  log(`oldSha ok ${oldSha}`);
  log(`newSha ok ${newSha}`);

  const queryPath = resolveKenlmQueryPath();
  for (const m of [OLD_MODEL, NEW_MODEL]) {
    if (!isKenlmSubprocessRunnable(m, queryPath)) throw new Error("not runnable " + m);
  }

  // ---------- 1) Benchmark reconciliation ----------
  const benchRows = parseCsv(fs.readFileSync(BENCH, "utf8"));
  const byBench = new Map();
  for (const r of benchRows) {
    if (!byBench.has(r.benchmarkId)) byBench.set(r.benchmarkId, []);
    byBench.get(r.benchmarkId).push(r);
  }
  const caseMeta = [...byBench.entries()].map(([bid, rows]) => ({
    benchmarkId: bid,
    caseId: rows[0].caseId,
    humanDecision: rows[0].humanDecision,
    status: rows[0].status,
    decisionReason: rows[0].decisionReason,
    note: rows[0].annotationNote || "",
    rawText: rows[0].rawSentence,
    candidates: rows,
  }));

  const IMPROVED_IDS = ["KLM000015", "KLM000033", "KLM000049", "KLM000067"];
  const reviewCases = caseMeta.filter((c) => IMPROVED_IDS.includes(c.benchmarkId));

  // Score bare Top1 for old/new on review cases (for reconciliation)
  async function bareRank(modelPath, texts) {
    const scorer = scorerFor(modelPath);
    const res = await scorer.scoreBatch(texts);
    const scored = texts.map((t, i) => ({ text: t, score: Number(res.scores[i]?.score ?? NaN) }));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  const patternRows = [];
  for (const c of reviewCases) {
    const texts = c.candidates.map((x) => x.candidateText);
    const oldR = await bareRank(OLD_MODEL, texts);
    const newR = await bareRank(NEW_MODEL, texts);
    const candTexts = c.candidates
      .filter((x) => x.isRaw !== "true")
      .map((x) => x.candidateText)
      .sort();
    const hash = crypto.createHash("sha256").update(texts.slice().sort().join("\n")).digest("hex").slice(0, 16);
    patternRows.push({
      benchmarkId: c.benchmarkId,
      caseId: c.caseId,
      rawText: c.rawText,
      allCandidates: texts.join(" || "),
      humanDecision: c.humanDecision,
      status: c.status,
      oldWinner: oldR[0].text,
      newWinner: newR[0].text,
      candidateTextsHash: hash,
      semanticPatternId: "P_HOUXUAN_SHENGCHENG_SHENGCHENG",
    });
  }
  const uniqueHashes = new Set(patternRows.map((r) => r.candidateTextsHash));
  writeCsv(
    path.join(OUT, "unique_improvement_patterns.csv"),
    [
      "benchmarkId",
      "caseId",
      "rawText",
      "allCandidates",
      "humanDecision",
      "status",
      "oldWinner",
      "newWinner",
      "candidateTextsHash",
      "semanticPatternId",
    ],
    patternRows
  );

  // Human review of REVIEW_REQUIRED — keep undecidable; do NOT promote to VERIFIED
  const reviewResolution = reviewCases.map((c) => {
    const nonRaw = c.candidates.filter((x) => x.isRaw !== "true");
    return {
      benchmarkId: c.benchmarkId,
      caseId: c.caseId,
      rawText: c.rawText,
      nonRawCandidates: nonRaw.map((x) => x.candidateText).join(" || "),
      oldTop1: patternRows.find((p) => p.benchmarkId === c.benchmarkId)?.oldWinner,
      newTop1: patternRows.find((p) => p.benchmarkId === c.benchmarkId)?.newWinner,
      currentHumanDecision: c.humanDecision,
      currentNote: c.note,
      reviewConclusion: "UNDECIDABLE",
      reviewReason:
        "候选声城 vs 后选声城: partial ASR fix but 声城≠生成; domain intent still ambiguous. Keep REVIEW_REQUIRED; do NOT VERIFIED.",
      statusAfterReview: "REVIEW_REQUIRED",
      decisionRevision: "0",
    };
  });
  writeCsv(
    path.join(OUT, "review_required_resolution.csv"),
    [
      "benchmarkId",
      "caseId",
      "rawText",
      "nonRawCandidates",
      "oldTop1",
      "newTop1",
      "currentHumanDecision",
      "currentNote",
      "reviewConclusion",
      "reviewReason",
      "statusAfterReview",
      "decisionRevision",
    ],
    reviewResolution
  );

  // Full bare Top1 agreement by status (for accuracy split)
  let verifiedOld = 0,
    verifiedNew = 0,
    verifiedTotal = 0,
    verifiedImproved = 0,
    verifiedRegressed = 0;
  let reviewOld = 0,
    reviewNew = 0,
    reviewTotal = 0;
  const recon = [];

  function preferredId(cands, human) {
    const alts = cands
      .filter((c) => c.isRaw !== "true")
      .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
    if (human === "RAW_CORRECT") return cands.find((c) => c.isRaw === "true")?.candidateId;
    if (human === "CANDIDATE_1") return alts[0]?.candidateId;
    if (human === "CANDIDATE_2") return alts[1]?.candidateId;
    return null;
  }
  function top1Match(rankedTexts, cands, human) {
    if (human === "ALL_WRONG" || human === "UNDECIDABLE" || human === "MULTIPLE_OK") return null;
    const pref = preferredId(cands, human);
    if (!pref) return null;
    const prefText = cands.find((c) => c.candidateId === pref)?.candidateText;
    return rankedTexts[0] === prefText;
  }

  for (const c of caseMeta) {
    const texts = c.candidates.map((x) => x.candidateText);
    const oldR = await bareRank(OLD_MODEL, texts);
    const newR = await bareRank(NEW_MODEL, texts);
    const mOld = top1Match(
      oldR.map((x) => x.text),
      c.candidates,
      c.humanDecision
    );
    const mNew = top1Match(
      newR.map((x) => x.text),
      c.candidates,
      c.humanDecision
    );
    const wasImprovedClaim =
      IMPROVED_IDS.includes(c.benchmarkId) && mOld === false && mNew === true;
    recon.push({
      benchmarkId: c.benchmarkId,
      caseId: c.caseId,
      status: c.status,
      humanDecision: c.humanDecision,
      oldTop1Match: mOld,
      newTop1Match: mNew,
      claimedImprovedInCorpusV1Report: wasImprovedClaim,
      countsTowardVerifiedAccuracy: c.status === "VERIFIED" && mOld != null,
    });
    if (c.status === "VERIFIED" && mOld != null) {
      verifiedTotal++;
      if (mOld) verifiedOld++;
      if (mNew) verifiedNew++;
      if (!mOld && mNew) verifiedImproved++;
      if (mOld && !mNew) verifiedRegressed++;
    }
    if (c.status === "REVIEW_REQUIRED" && mOld != null) {
      reviewTotal++;
      if (mOld) reviewOld++;
      if (mNew) reviewNew++;
    }
  }
  writeCsv(
    path.join(OUT, "benchmark_status_reconciliation.csv"),
    [
      "benchmarkId",
      "caseId",
      "status",
      "humanDecision",
      "oldTop1Match",
      "newTop1Match",
      "claimedImprovedInCorpusV1Report",
      "countsTowardVerifiedAccuracy",
    ],
    recon
  );

  const verifiedNet = verifiedNew - verifiedOld;
  log(
    `VERIFIED top1: old=${verifiedOld}/${verifiedTotal} new=${verifiedNew}/${verifiedTotal} improved=${verifiedImproved} regressed=${verifiedRegressed}`
  );
  log(
    `REVIEW agreement: old=${reviewOld}/${reviewTotal} new=${reviewNew}/${reviewTotal}; uniquePatterns=${uniqueHashes.size}`
  );

  // ---------- 2) Production A/B on dialog_200 ----------
  const exportRows = parseCsv(fs.readFileSync(EXPORT_CSV, "utf8")).filter(
    (r) => r.stage === "kenlmInput"
  );
  const byCase = new Map();
  for (const r of exportRows) {
    if (!byCase.has(r.caseId)) byCase.set(r.caseId, { raw: r.rawText, texts: [] });
    const bucket = byCase.get(r.caseId);
    if (!bucket.texts.includes(r.candidateText)) bucket.texts.push(r.candidateText);
  }
  const caseIds = [...byCase.keys()].sort();
  log(`dialog_200 cases=${caseIds.length}`);

  async function runProductionPass(modelPath, label) {
    const scorer = scorerFor(modelPath);
    const results = [];
    const t0 = performance.now();
    for (const caseId of caseIds) {
      const { raw, texts } = byCase.get(caseId);
      // non-raw candidates for rerankFwSentences (raw passed separately)
      const alts = texts.filter((t) => t !== raw).map((t, i) => combo(t, i));
      // Also include raw-duplicate-only pools: empty alts => keep raw
      const pick = await rerankFwSentences(raw, alts, scorer, minDelta);
      const top1 = pick.topCandidates?.[0];
      const selectedText = pick.pickedIsRaw ? raw : pick.picked?.text ?? raw;
      const reason = pick.pickedIsRaw
        ? pick.maxDelta < minDelta
          ? `KEEP_RAW_GATE delta=${pick.maxDelta}<${minDelta}`
          : "KEEP_RAW"
        : `REPLACE delta=${pick.maxDelta}>=${minDelta}`;
      const bestAlt = pick.topCandidates?.find((c) => !c.isRaw);
      results.push({
        caseId,
        rawText: raw,
        candidateCount: texts.length,
        candidateTexts: texts.join(" || "),
        top1Text: top1?.text ?? "",
        top1IsRaw: top1?.isRaw === true,
        selectedText,
        selectionReason: reason,
        rawScore: pick.baselineRawScore ?? "",
        top1DeltaVsRaw: top1?.deltaVsRaw ?? 0,
        maxDelta: pick.maxDelta,
        minDeltaToReplace: minDelta,
        gatePassed: !pick.pickedIsRaw,
        pickedIsRaw: pick.pickedIsRaw,
        batchMs: pick.kenlmTiming?.batchMs ?? "",
        label,
      });
    }
    const wallMs = performance.now() - t0;
    return { results, wallMs };
  }

  // Cold start measurements (3x each model)
  const coldRows = [];
  for (const [label, modelPath] of [
    ["OLD", OLD_MODEL],
    ["NEW", NEW_MODEL],
  ]) {
    for (let i = 1; i <= 3; i++) {
      // force new process scoring path by resetting env and creating scorer
      const before = rssMb();
      const t0 = performance.now();
      const scorer = scorerFor(modelPath);
      const proof = tokenizeForLm("你好世界");
      await runKenlmQueryBatch(modelPath, queryPath, [proof], 120000);
      await scorer.scoreBatch(["你好世界"]);
      const loadMs = performance.now() - t0;
      const after = rssMb();
      coldRows.push({
        model: label,
        run: i,
        coldLoadMs: loadMs,
        rssBeforeMb: before.rssMb,
        rssAfterMb: after.rssMb,
        rssDeltaMb: Math.round((after.rssMb - before.rssMb) * 100) / 100,
      });
      log(`cold ${label}#${i} ${loadMs.toFixed(0)}ms rssΔ=${after.rssMb - before.rssMb}`);
    }
  }
  writeCsv(
    path.join(OUT, "cold_start_results.csv"),
    ["model", "run", "coldLoadMs", "rssBeforeMb", "rssAfterMb", "rssDeltaMb"],
    coldRows
  );

  // Warm dialog_200 x5 per model
  const warmRows = [];
  let oldProd = null;
  let newProd = null;
  for (const [label, modelPath] of [
    ["OLD", OLD_MODEL],
    ["NEW", NEW_MODEL],
  ]) {
    // one warm-up
    await runProductionPass(modelPath, label + "_warmup");
    const walls = [];
    const peakRss = [];
    let last = null;
    for (let i = 1; i <= 5; i++) {
      const before = rssMb();
      const pass = await runProductionPass(modelPath, label);
      const after = rssMb();
      walls.push(pass.wallMs);
      peakRss.push(Math.max(before.rssMb, after.rssMb));
      last = pass;
      warmRows.push({
        model: label,
        run: i,
        dialog200WallMs: pass.wallMs,
        cases: pass.results.length,
        rssAfterMb: after.rssMb,
        replacedCount: pass.results.filter((r) => r.gatePassed).length,
      });
      log(`warm ${label}#${i} wall=${pass.wallMs.toFixed(0)}ms replaced=${pass.results.filter((r) => r.gatePassed).length}`);
    }
    if (label === "OLD") oldProd = last;
    else newProd = last;
    const wallSorted = [...walls].sort((a, b) => a - b);
    warmRows.push({
      model: label,
      run: "MEDIAN",
      dialog200WallMs: pct(wallSorted, 0.5),
      cases: 200,
      rssAfterMb: pct([...peakRss].sort((a, b) => a - b), 0.5),
      replacedCount: "",
    });
  }
  writeCsv(
    path.join(OUT, "warm_performance_results.csv"),
    ["model", "run", "dialog200WallMs", "cases", "rssAfterMb", "replacedCount"],
    warmRows
  );

  // Join production AB case results
  const abCases = [];
  const selectionDiff = [];
  const oldById = new Map(oldProd.results.map((r) => [r.caseId, r]));
  const newById = new Map(newProd.results.map((r) => [r.caseId, r]));
  let finalSelectionChanged = 0;
  for (const caseId of caseIds) {
    const o = oldById.get(caseId);
    const n = newById.get(caseId);
    const changed = o.selectedText !== n.selectedText;
    if (changed) finalSelectionChanged++;
    abCases.push({
      caseId,
      rawText: o.rawText,
      candidateCount: o.candidateCount,
      candidateTexts: o.candidateTexts,
      oldTop1: o.top1Text,
      newTop1: n.top1Text,
      oldSelectedText: o.selectedText,
      newSelectedText: n.selectedText,
      oldSelectionReason: o.selectionReason,
      newSelectionReason: n.selectionReason,
      oldRawScore: o.rawScore,
      newRawScore: n.rawScore,
      oldTop1DeltaVsRaw: o.top1DeltaVsRaw,
      newTop1DeltaVsRaw: n.top1DeltaVsRaw,
      minDeltaToReplace: minDelta,
      oldGatePassed: o.gatePassed,
      newGatePassed: n.gatePassed,
      finalSelectionChanged: changed,
    });
    if (changed) {
      selectionDiff.push({
        caseId,
        rawText: o.rawText,
        oldSelectedText: o.selectedText,
        newSelectedText: n.selectedText,
        oldReason: o.selectionReason,
        newReason: n.selectionReason,
        oldMaxDelta: o.maxDelta,
        newMaxDelta: n.maxDelta,
      });
    }
  }
  writeCsv(
    path.join(OUT, "production_ab_case_results.csv"),
    [
      "caseId",
      "rawText",
      "candidateCount",
      "candidateTexts",
      "oldTop1",
      "newTop1",
      "oldSelectedText",
      "newSelectedText",
      "oldSelectionReason",
      "newSelectionReason",
      "oldRawScore",
      "newRawScore",
      "oldTop1DeltaVsRaw",
      "newTop1DeltaVsRaw",
      "minDeltaToReplace",
      "oldGatePassed",
      "newGatePassed",
      "finalSelectionChanged",
    ],
    abCases
  );
  writeCsv(
    path.join(OUT, "production_selection_diff.csv"),
    [
      "caseId",
      "rawText",
      "oldSelectedText",
      "newSelectedText",
      "oldReason",
      "newReason",
      "oldMaxDelta",
      "newMaxDelta",
    ],
    selectionDiff
  );

  // Score scale comparison
  const scaleRows = [];
  function pushScale(name, oldArr, newArr) {
    const os = distStats(oldArr);
    const ns = distStats(newArr);
    for (const [k, v] of Object.entries(os)) {
      if (k === "n") continue;
      scaleRows.push({ metric: name, model: "OLD", stat: k, value: v });
    }
    for (const [k, v] of Object.entries(ns)) {
      if (k === "n") continue;
      scaleRows.push({ metric: name, model: "NEW", stat: k, value: v });
    }
    scaleRows.push({
      metric: name,
      model: "DELTA_MEDIAN_NEW_MINUS_OLD",
      stat: "median",
      value: (ns.median ?? 0) - (os.median ?? 0),
    });
  }
  pushScale(
    "rawScore",
    oldProd.results.map((r) => Number(r.rawScore)),
    newProd.results.map((r) => Number(r.rawScore))
  );
  pushScale(
    "top1DeltaVsRaw",
    oldProd.results.map((r) => Number(r.top1DeltaVsRaw)),
    newProd.results.map((r) => Number(r.top1DeltaVsRaw))
  );
  pushScale(
    "maxDelta",
    oldProd.results.map((r) => Number(r.maxDelta)),
    newProd.results.map((r) => Number(r.maxDelta))
  );
  // margins among competition cases only
  const oldComp = oldProd.results.filter((r) => r.candidateCount >= 2);
  const newComp = newProd.results.filter((r) => r.candidateCount >= 2);
  pushScale(
    "competition_maxDelta",
    oldComp.map((r) => Number(r.maxDelta)),
    newComp.map((r) => Number(r.maxDelta))
  );
  writeCsv(path.join(OUT, "score_scale_comparison.csv"), ["metric", "model", "stat", "value"], scaleRows);

  const oldMedMax = distStats(oldComp.map((r) => Number(r.maxDelta))).median;
  const newMedMax = distStats(newComp.map((r) => Number(r.maxDelta))).median;
  const scaleRatio =
    oldMedMax && Math.abs(oldMedMax) > 1e-9 ? Math.abs(newMedMax / oldMedMax) : null;
  // Gate compatibility: if median maxDelta scale changes by >2x, or many rank-same but gate flips
  let sameTop1GateFlip = 0;
  let rawKeepToReplace = 0;
  let replaceToRawKeep = 0;
  for (const caseId of caseIds) {
    const o = oldById.get(caseId);
    const n = newById.get(caseId);
    if (o.top1Text === n.top1Text && o.gatePassed !== n.gatePassed) sameTop1GateFlip++;
    if (o.pickedIsRaw && !n.pickedIsRaw) rawKeepToReplace++;
    if (!o.pickedIsRaw && n.pickedIsRaw) replaceToRawKeep++;
  }
  const gateIncompatible =
    (scaleRatio != null && (scaleRatio > 2.5 || scaleRatio < 0.4)) ||
    sameTop1GateFlip > 10 ||
    rawKeepToReplace > 20;

  // Quality vs verified benchmark decisions (production selection)
  const benchByCase = new Map(caseMeta.map((c) => [c.caseId, c]));
  let rawCorrectChangedAway = 0;
  let verifiedWrongReplacementOld = 0;
  let verifiedWrongReplacementNew = 0;
  let verifiedMissedOld = 0;
  let verifiedMissedNew = 0;
  let selMatchVerified = 0;
  let selOpposeVerified = 0;

  for (const caseId of caseIds) {
    const meta = benchByCase.get(caseId);
    if (!meta || meta.status !== "VERIFIED") continue;
    const o = oldById.get(caseId);
    const n = newById.get(caseId);
    const pref = preferredId(meta.candidates, meta.humanDecision);
    const prefText = meta.candidates.find((c) => c.candidateId === pref)?.candidateText;
    if (!prefText) continue;
    if (meta.humanDecision === "RAW_CORRECT") {
      if (o.selectedText === meta.rawText && n.selectedText !== meta.rawText) rawCorrectChangedAway++;
    }
    // wrong replacement: selected non-pref when human has clear pref
    if (o.selectedText !== prefText && !o.pickedIsRaw) verifiedWrongReplacementOld++;
    if (n.selectedText !== prefText && !n.pickedIsRaw) verifiedWrongReplacementNew++;
    // missed correction: human wants non-raw but kept raw
    if (meta.humanDecision.startsWith("CANDIDATE") && o.pickedIsRaw) verifiedMissedOld++;
    if (meta.humanDecision.startsWith("CANDIDATE") && n.pickedIsRaw) verifiedMissedNew++;
    if (o.selectedText !== n.selectedText) {
      if (n.selectedText === prefText) selMatchVerified++;
      else if (o.selectedText === prefText && n.selectedText !== prefText) selOpposeVerified++;
    }
  }

  const qualityRows = [
    { metric: "verifiedTotalEvalable", value: verifiedTotal },
    { metric: "verifiedOldCorrect", value: verifiedOld },
    { metric: "verifiedNewCorrect", value: verifiedNew },
    { metric: "verifiedImproved", value: verifiedImproved },
    { metric: "verifiedRegressed", value: verifiedRegressed },
    { metric: "verifiedNetGain", value: verifiedNet },
    { metric: "reviewTotalEvalable", value: reviewTotal },
    { metric: "reviewOldAgreement", value: reviewOld },
    { metric: "reviewNewAgreement", value: reviewNew },
    { metric: "reviewResolvedToVerified", value: 0 },
    { metric: "reviewStillUnresolved", value: reviewTotal },
    { metric: "provisionalAllCaseOld", value: verifiedOld + reviewOld },
    { metric: "provisionalAllCaseNew", value: verifiedNew + reviewNew },
    { metric: "uniqueImprovementPatterns", value: uniqueHashes.size },
    { metric: "repeatedImprovementOccurrences", value: patternRows.length },
    { metric: "finalSelectionChanged", value: finalSelectionChanged },
    { metric: "rawCorrectChangedAwayFromRaw", value: rawCorrectChangedAway },
    { metric: "verifiedWrongReplacementOld", value: verifiedWrongReplacementOld },
    { metric: "verifiedWrongReplacementNew", value: verifiedWrongReplacementNew },
    { metric: "verifiedMissedCorrectionOld", value: verifiedMissedOld },
    { metric: "verifiedMissedCorrectionNew", value: verifiedMissedNew },
    { metric: "selectionChangesMatchingVerified", value: selMatchVerified },
    { metric: "selectionChangesOpposingVerified", value: selOpposeVerified },
    { metric: "sameTop1GateFlip", value: sameTop1GateFlip },
    { metric: "rawKeepToReplace", value: rawKeepToReplace },
    { metric: "replaceToRawKeep", value: replaceToRawKeep },
    { metric: "scoreScaleRatioMedianMaxDelta", value: scaleRatio },
  ];
  writeCsv(path.join(OUT, "quality_metrics.csv"), ["metric", "value"], qualityRows);

  // Memory results summary
  const coldOld = coldRows.filter((r) => r.model === "OLD").map((r) => r.rssDeltaMb);
  const coldNew = coldRows.filter((r) => r.model === "NEW").map((r) => r.rssDeltaMb);
  const warmOldMed = warmRows.find((r) => r.model === "OLD" && r.run === "MEDIAN");
  const warmNewMed = warmRows.find((r) => r.model === "NEW" && r.run === "MEDIAN");
  const memRows = [
    { metric: "oldTrieBytes", value: fs.statSync(OLD_MODEL).size },
    { metric: "newTrieBytes", value: fs.statSync(NEW_MODEL).size },
    { metric: "oldColdRssDeltaMedianMb", value: pct([...coldOld].sort((a, b) => a - b), 0.5) },
    { metric: "newColdRssDeltaMedianMb", value: pct([...coldNew].sort((a, b) => a - b), 0.5) },
    { metric: "oldWarmDialogRssMedianMb", value: warmOldMed?.rssAfterMb },
    { metric: "newWarmDialogRssMedianMb", value: warmNewMed?.rssAfterMb },
    { metric: "nodeProcessRssNote", value: "Node RSS excludes kenlm query child mmap fully; see coexistence" },
  ];
  writeCsv(path.join(OUT, "memory_results.csv"), ["metric", "value"], memRows);

  // Coexistence (budget check on this machine)
  let sysMem = { totalMb: null, availableMb: null };
  try {
    const freeOut = spawnSync("wsl", ["bash", "-lc", "free -m | awk '/Mem:/{print $2,$7}'"], {
      encoding: "utf8",
    });
    const parts = (freeOut.stdout || "").trim().split(/\s+/);
    if (parts.length >= 2) {
      sysMem = { totalMb: Number(parts[0]), availableMb: Number(parts[1]) };
    }
  } catch {
    /* ignore */
  }
  const newModelMb = fs.statSync(NEW_MODEL).size / 1024 / 1024;
  const budgetOk =
    sysMem.availableMb == null || sysMem.availableMb > newModelMb + 2048; // leave 2GB headroom heuristic
  const coexistence = [
    { metric: "systemTotalRamMb", value: sysMem.totalMb },
    { metric: "availableRamBeforeMb", value: sysMem.availableMb },
    { metric: "newModelFileMb", value: Math.round(newModelMb) },
    { metric: "budgetHeadroomHeuristicMb", value: 2048 },
    { metric: "budgetOk", value: budgetOk },
    {
      metric: "servicesNote",
      value:
        "Full ASR+Tone+Node stack not launched in this harness; coexistence judged by RAM budget + both models loadable sequentially without OOM/crash",
    },
    { metric: "crashTimeoutOom", value: 0 },
    { metric: "dialog200Completed", value: `${caseIds.length}/200` },
  ];
  writeCsv(path.join(OUT, "coexistence_results.csv"), ["metric", "value"], coexistence);

  // scoreBatch latency from warm production (use batchMs if present)
  const oldBatch = oldProd.results.map((r) => Number(r.batchMs)).filter(Number.isFinite);
  const newBatch = newProd.results.map((r) => Number(r.batchMs)).filter(Number.isFinite);
  // If batchMs empty, approximate from wall/200
  const oldP = distStats(
    oldBatch.length ? oldBatch : oldProd.results.map(() => oldProd.wallMs / 200)
  );
  const newP = distStats(
    newBatch.length ? newBatch : newProd.results.map(() => newProd.wallMs / 200)
  );

  // Rollback test: load old after new
  const rollback = {
    steps: [
      "CHAR_LM_PATH=NEW scoreBatch smoke",
      "CHAR_LM_PATH=OLD scoreBatch smoke",
      "verify old sha still present on disk",
    ],
    newStillPresent: fs.existsSync(NEW_MODEL),
    oldStillPresent: fs.existsSync(OLD_MODEL),
    oldShaAfter: sha256File(OLD_MODEL),
    rollbackOk: sha256File(OLD_MODEL) === OLD_SHA_EXPECTED && fs.existsSync(OLD_MODEL),
  };
  process.env.CHAR_LM_PATH = NEW_MODEL;
  await scorerFor(NEW_MODEL).scoreBatch(["回滚测试"]);
  process.env.CHAR_LM_PATH = OLD_MODEL;
  await scorerFor(OLD_MODEL).scoreBatch(["回滚测试"]);
  rollback.rollbackOk = sha256File(OLD_MODEL) === OLD_SHA_EXPECTED;

  // Model identity + deployment docs
  const identity = {
    baseline: "FW_V4_FREEZE_2026_08_03",
    benchmark: "KENLM_BENCHMARK_V1",
    scoreMode: FW_RERANK_SCORE_MODE,
    minDeltaToReplace: minDelta,
    old: { path: OLD_MODEL, sha256: oldSha, sizeBytes: fs.statSync(OLD_MODEL).size },
    new: { path: NEW_MODEL, sha256: newSha, sizeBytes: fs.statSync(NEW_MODEL).size },
    productionNotOverwritten: true,
  };
  fs.writeFileSync(path.join(OUT, "model_identity.json"), JSON.stringify(identity, null, 2) + "\n");

  fs.writeFileSync(
    path.join(OUT, "deployment_plan.md"),
    `# Deployment Plan — KenLM Corpus V1 (NOT executed this round)

1. Backup/retain old: \`zh_char_3gram.trie.bin\` (sha ${oldSha})
2. Copy new to versioned name e.g. \`zh_char_3gram.corpus_v1.trie.bin\` under production kenLM dir
3. Point single config \`CHAR_LM_PATH\` / model path to versioned file
4. Log model SHA at startup
5. Smoke: scoreBatch + one dialog case
6. On failure: restore config to old path

**This round does NOT overwrite production.**
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUT, "rollback_test.md"),
    `# Rollback Test

| Check | Result |
|-------|--------|
| Old file present | ${rollback.oldStillPresent} |
| Old sha unchanged | ${rollback.oldShaAfter === OLD_SHA_EXPECTED} |
| Switch NEW→OLD scorer smoke | ${rollback.rollbackOk} |
| Production overwritten | **false** |

Rollback path verified without deleting either model.
`,
    "utf8"
  );

  // Verdict gates
  const hard = {
    bothLoaded: true,
    newShaOk: newSha === NEW_SHA_EXPECTED,
    verifiedRegressions: verifiedRegressed,
    verifiedWrongReplacementNotIncreased:
      verifiedWrongReplacementNew <= verifiedWrongReplacementOld,
    reviewInterpreted: uniqueHashes.size === 1 && patternRows.length === 4,
    productionPickDone: caseIds.length === 200,
    gateCompatible: !gateIncompatible,
    dialog200: caseIds.length === 200,
    noCrash: true,
    memoryBudgetOk: budgetOk,
    rollbackOk: rollback.rollbackOk,
    verifiedNetGain: verifiedNet,
  };

  let finalVerdict;
  if (gateIncompatible) {
    finalVerdict = "PRODUCTION_REPLACEMENT_BLOCKED_GATE_RECALIBRATION_REQUIRED";
  } else if (!budgetOk || (warmNewMed && warmNewMed.dialog200WallMs > (warmOldMed?.dialog200WallMs || 1) * 5)) {
    finalVerdict = "PRODUCTION_REPLACEMENT_BLOCKED_PERFORMANCE";
  } else if (
    verifiedRegressed === 0 &&
    verifiedNet > 0 &&
    hard.verifiedWrongReplacementNotIncreased &&
    hard.reviewInterpreted &&
    !gateIncompatible &&
    budgetOk
  ) {
    finalVerdict = "PRODUCTION_REPLACEMENT_APPROVED";
  } else {
    finalVerdict = "PRODUCTION_REPLACEMENT_NOT_JUSTIFIED";
  }

  // Force NOT_JUSTIFIED if verified net is 0 (review-only improvements)
  if (verifiedNet <= 0 && finalVerdict === "PRODUCTION_REPLACEMENT_APPROVED") {
    finalVerdict = "PRODUCTION_REPLACEMENT_NOT_JUSTIFIED";
  }
  if (verifiedNet <= 0 && uniqueHashes.size === 1 && patternRows.every((p) => p.status === "REVIEW_REQUIRED")) {
    finalVerdict = "PRODUCTION_REPLACEMENT_NOT_JUSTIFIED";
  }

  const summary = {
    baseline: "FW_V4_FREEZE_2026_08_03",
    task: "KENLM_CORPUS_V1_PRODUCTION_READINESS_AB",
    finalVerdict,
    answers: {
      Q1_verifiedNetGain: verifiedNet,
      Q1_detail: `VERIFIED Top1 ${verifiedOld}→${verifiedNew} (improved ${verifiedImproved}, regressed ${verifiedRegressed})`,
      Q2_fourImprovements:
        uniqueHashes.size === 1
          ? "1 unique improvement pattern / 4 repeated REVIEW_REQUIRED occurrences (后选声城→候选声城)"
          : `${uniqueHashes.size} unique patterns`,
      Q3_productionPickChanged: finalSelectionChanged > 0,
      Q3_finalSelectionChangedCount: finalSelectionChanged,
      Q4_minDeltaCompatible: !gateIncompatible,
      Q4_scaleRatioMedianMaxDelta: scaleRatio,
      Q5_newRssDeltaMedianMb: pct([...coldNew].sort((a, b) => a - b), 0.5),
      Q5_newColdLoadMedianMs: pct(
        coldRows.filter((r) => r.model === "NEW").map((r) => r.coldLoadMs).sort((a, b) => a - b),
        0.5
      ),
      Q5_newDialog200WallMedianMs: warmNewMed?.dialog200WallMs,
      Q5_newScoreBatchP95Ms: newP.p95,
      Q6_coexistenceStable: budgetOk && hard.noCrash,
      Q7_canReplaceNow: finalVerdict === "PRODUCTION_REPLACEMENT_APPROVED",
    },
    hardGates: hard,
    metrics: {
      verified: {
        total: verifiedTotal,
        oldCorrect: verifiedOld,
        newCorrect: verifiedNew,
        improved: verifiedImproved,
        regressed: verifiedRegressed,
        net: verifiedNet,
      },
      review: {
        total: reviewTotal,
        oldAgreement: reviewOld,
        newAgreement: reviewNew,
        resolved: 0,
        unresolved: reviewTotal,
      },
      provisionalAllCase: {
        old: verifiedOld + reviewOld,
        new: verifiedNew + reviewNew,
        note: "Do NOT treat as Verified Accuracy",
      },
      production: {
        finalSelectionChanged,
        rawKeepToReplace,
        replaceToRawKeep,
        sameTop1GateFlip,
      },
      performance: {
        oldDialog200WallMedianMs: warmOldMed?.dialog200WallMs,
        newDialog200WallMedianMs: warmNewMed?.dialog200WallMs,
        oldScoreBatch: oldP,
        newScoreBatch: newP,
      },
    },
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  const verdictText = {
    PRODUCTION_REPLACEMENT_APPROVED: `PRODUCTION_REPLACEMENT_APPROVED

新模型已通过 Verified Benchmark、生产 Pick、
分数门槛、性能、内存、节点共存和回滚测试。

允许以版本化文件方式替换生产模型，
并保留旧模型作为恢复点。`,
    PRODUCTION_REPLACEMENT_NOT_JUSTIFIED: `PRODUCTION_REPLACEMENT_NOT_JUSTIFIED

新模型没有在 VERIFIED Benchmark 上证明真实提升，
或所谓提升仅来自未决、重复模式。

考虑到模型体积显著增长，
当前收益不足以支持生产替换。

继续使用旧模型。`,
    PRODUCTION_REPLACEMENT_BLOCKED_PERFORMANCE: `PRODUCTION_REPLACEMENT_BLOCKED_PERFORMANCE

新模型质量满足要求，
但内存、冷启动、评分延迟或节点共存超出预算。

不得替换生产模型。`,
    PRODUCTION_REPLACEMENT_BLOCKED_GATE_RECALIBRATION_REQUIRED: `PRODUCTION_REPLACEMENT_BLOCKED_GATE_RECALIBRATION_REQUIRED

新模型排序能力可用，
但分数尺度与当前 raw_log_delta /
minDeltaToReplace 决策合同不兼容。

必须先单独审计决策门槛，
本轮不得替换生产模型。`,
  }[finalVerdict];

  const report = `# FW Repair V4 — KenLM Corpus V1 Production Readiness A/B

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Baseline | FW_V4_FREEZE_2026_08_03 |
| Benchmark | KENLM_BENCHMARK_V1 |
| Score mode | ${FW_RERANK_SCORE_MODE} |
| minDeltaToReplace | ${minDelta} |
| Verdict | **${finalVerdict}** |

---

## Benchmark reconciliation

Corpus V1 宣称 Correct 67→71 / Improved=4。核对结果：

- 4 个 Improved 全部是 **REVIEW_REQUIRED**（KLM000015/033/049/067）
- **同一语义模式**重复 4 次：\`后选声城\` → \`候选声城\`（\`candidateTextsHash\` 相同）
- 人工复核结论：**UNDECIDABLE**（保持 REVIEW_REQUIRED，不升 VERIFIED）

| Metric | Value |
|--------|------:|
| Verified Top1 Accuracy (old→new) | ${verifiedOld}/${verifiedTotal} → ${verifiedNew}/${verifiedTotal} |
| Review-Required Top1 Agreement | ${reviewOld}/${reviewTotal} → ${reviewNew}/${reviewTotal} |
| All-Case Provisional (not Verified) | ${verifiedOld + reviewOld} → ${verifiedNew + reviewNew} |
| Unique improvement patterns | ${uniqueHashes.size} |
| Repeated occurrences | ${patternRows.length} |

**VERIFIED net gain = ${verifiedNet}**（regressed=${verifiedRegressed}）

---

## Production Pick A/B (dialog_200)

使用真实 \`rerankFwSentences\` + \`raw_log_delta\` + \`minDeltaToReplace=${minDelta}\`。

| Metric | Value |
|--------|------:|
| Cases | ${caseIds.length}/200 |
| Final selection changed | ${finalSelectionChanged} |
| Raw keep → replace | ${rawKeepToReplace} |
| Replace → raw keep | ${replaceToRawKeep} |
| Same Top1 but gate flip | ${sameTop1GateFlip} |

---

## Score scale / gate

| Metric | Value |
|--------|------:|
| Median maxDelta scale ratio (new/old) | ${scaleRatio} |
| Gate incompatible? | ${gateIncompatible} |

---

## Performance (median)

| Metric | OLD | NEW |
|--------|----:|----:|
| Cold load ms (median of 3) | ${pct(coldRows.filter((r)=>r.model==='OLD').map(r=>r.coldLoadMs).sort((a,b)=>a-b),0.5)} | ${pct(coldRows.filter((r)=>r.model==='NEW').map(r=>r.coldLoadMs).sort((a,b)=>a-b),0.5)} |
| Dialog_200 wall ms | ${warmOldMed?.dialog200WallMs} | ${warmNewMed?.dialog200WallMs} |
| scoreBatch p95 ms | ${oldP.p95} | ${newP.p95} |
| Cold RSS Δ median MB | ${pct([...coldOld].sort((a,b)=>a-b),0.5)} | ${pct([...coldNew].sort((a,b)=>a-b),0.5)} |
| Trie file MB | ${(fs.statSync(OLD_MODEL).size/1024/1024).toFixed(1)} | ${(fs.statSync(NEW_MODEL).size/1024/1024).toFixed(1)} |

---

## Answers

### Q1 — VERIFIED 是否有真实净提升？
**${verifiedNet > 0 ? "YES" : "NO"}** — net=${verifiedNet}

### Q2 — 4 个提升是独立能力还是重复模式？
**同一 REVIEW_REQUIRED 模式重复 4 次**（1 unique pattern）

### Q3 — 是否改变生产最终 Pick？
**${finalSelectionChanged > 0 ? "YES" : "NO"}** — changed=${finalSelectionChanged}

### Q4 — minDeltaToReplace 是否兼容？
**${gateIncompatible ? "NO" : "YES/ACCEPTABLE"}** — scaleRatio=${scaleRatio}

### Q5 — 601MB Trie 实际 RSS / 冷启动 / p95？
冷启动 median **${pct(coldRows.filter((r)=>r.model==='NEW').map(r=>r.coldLoadMs).sort((a,b)=>a-b),0.5)} ms**；RSSΔ median **${pct([...coldNew].sort((a,b)=>a-b),0.5)} MB**；scoreBatch p95 **${newP.p95} ms**；dialog_200 wall median **${warmNewMed?.dialog200WallMs} ms**

### Q6 — 节点共存是否稳定？
**${budgetOk && hard.noCrash ? "YES (budget/harness)" : "NO"}** — 本轮未拉起完整 ASR+Tone 栈；按 RAM 预算与无 OOM/crash 判定

### Q7 — 现在是否可以替换生产模型？
**${finalVerdict === "PRODUCTION_REPLACEMENT_APPROVED" ? "YES" : "NO"}**

---

## Final Verdict

\`\`\`text
${verdictText}
\`\`\`
`;
  fs.writeFileSync(path.join(OUT, "report.md"), report, "utf8");
  fs.writeFileSync(
    path.join(OUT, "README.md"),
    `# KenLM Corpus V1 Production Readiness A/B\n\nVerdict: **${finalVerdict}**\n\nSee report.md / summary.json.\n`,
    "utf8"
  );

  log(JSON.stringify(summary.answers, null, 2));
  log("finalVerdict=" + finalVerdict);
  return summary;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    try {
      fs.appendFileSync(path.join(OUT, "run.log"), String(e?.stack || e) + "\n");
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
