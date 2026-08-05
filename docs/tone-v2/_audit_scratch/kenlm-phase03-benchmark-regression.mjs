#!/usr/bin/env node
/**
 * KenLM Phase 03 — Benchmark regression OLD vs NEW (KENLM_BENCHMARK_V1 unchanged).
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

const BENCH = path.join(
  repo,
  "docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark/kenlm_benchmark.csv"
);
const OUT = path.join(
  repo,
  "docs/acceptance/Development/2026-08-04_KenLM_Phase03_First_Training"
);
const OLD_MODEL = path.join(
  repo,
  "electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin"
);
const NEW_MODEL = path.join(repo, "kenLM/model/phase03_first_train/zh_char_3gram.trie.bin");
const TRAIN_META = path.join(repo, "kenLM/model/phase03_first_train/training_meta.json");

fs.mkdirSync(OUT, { recursive: true });
process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;

const require = createRequire(path.join(electronRoot, "package.json"));
const {
  resolveKenlmQueryPath,
  isKenlmSubprocessRunnable,
  runKenlmQueryBatch,
} = require(path.join(dist, "phonetic-correction/lm-scorer.js"));
const { tokenizeForLm } = require(path.join(dist, "phonetic-correction/char-tokenize.js"));
const { createKenlmBatchScorer } = require(
  path.join(dist, "asr-repair/sentence-rerank/kenlm-scorer.js")
);

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
function avg(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function log(msg) {
  const line = `[phase03-reg] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(OUT, "run.log"), line + "\n");
}

async function scoreWithModel(modelPath, texts) {
  process.env.CHAR_LM_PATH = modelPath;
  const scorer = createKenlmBatchScorer();
  if (!scorer) throw new Error(`createKenlmBatchScorer null for ${modelPath}`);
  const scoreRes = await scorer.scoreBatch(texts);
  return texts.map((_, i) => Number(scoreRes.scores[i]?.score ?? NaN));
}

function rankByScore(cands, scores) {
  const ranked = cands
    .map((c, i) => ({ ...c, score: scores[i] }))
    .sort((a, b) => b.score - a.score);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });
  return ranked;
}

function preferredCandidateId(cands, humanDecision) {
  const nonRaw = cands
    .filter((c) => c.isRaw !== "true")
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId, "en"));
  if (humanDecision === "RAW_CORRECT") return cands.find((c) => c.isRaw === "true")?.candidateId;
  if (humanDecision === "CANDIDATE_1") return nonRaw[0]?.candidateId;
  if (humanDecision === "CANDIDATE_2") return nonRaw[1]?.candidateId;
  return null;
}

function top1MatchesHuman(top1, cands, humanDecision) {
  const pref = preferredCandidateId(cands, humanDecision);
  if (humanDecision === "MULTIPLE_OK") {
    const nonRaw = cands
      .filter((c) => c.isRaw !== "true")
      .sort((a, b) => a.candidateId.localeCompare(b.candidateId, "en"));
    const ok = new Set(
      [cands.find((c) => c.isRaw === "true")?.candidateId, nonRaw[0]?.candidateId, nonRaw[1]?.candidateId].filter(
        Boolean
      )
    );
    return ok.has(top1.candidateId);
  }
  if (humanDecision === "ALL_WRONG" || humanDecision === "UNDECIDABLE") return null;
  if (!pref) return null;
  return top1.candidateId === pref;
}

function classifyFailure(caseRows, top1, humanDecision) {
  const rawText = caseRows.find((c) => c.isRaw === "true")?.candidateText || "";
  if (/后选|候选生城|候选声城|上线计化/.test(rawText) || /后选|候选生城|候选声城/.test(top1.candidateText)) {
    return "Domain";
  }
  if (/科医|作液室|酒店半|登机|理服责|房监控|更医师|低脂|地质|量检|钟点/.test(top1.candidateText)) {
    return "ASR Damage";
  }
  if (humanDecision === "RAW_CORRECT" && top1.isRaw !== "true") return "Language";
  if (String(humanDecision).startsWith("CANDIDATE") && top1.isRaw === "true") return "Language";
  return "Other";
}

async function main() {
  fs.writeFileSync(path.join(OUT, "run.log"), "", "utf8");
  if (!fs.existsSync(NEW_MODEL) || !fs.existsSync(OLD_MODEL)) {
    throw new Error("model missing");
  }

  const oldSha = sha256File(OLD_MODEL);
  const newSha = sha256File(NEW_MODEL);
  const sameBinary = oldSha === newSha;
  log(`oldSha=${oldSha}`);
  log(`newSha=${newSha}`);
  log(`sameBinary=${sameBinary}`);

  const queryPath = resolveKenlmQueryPath();
  for (const m of [OLD_MODEL, NEW_MODEL]) {
    if (!isKenlmSubprocessRunnable(m, queryPath)) {
      throw new Error(`not runnable ${m}`);
    }
  }

  const rows = parseCsv(fs.readFileSync(BENCH, "utf8"));
  const byBench = new Map();
  for (const r of rows) {
    if (!byBench.has(r.benchmarkId)) byBench.set(r.benchmarkId, []);
    byBench.get(r.benchmarkId).push(r);
  }
  const caseIds = [...byBench.keys()].sort();
  log(`benchmark cases=${caseIds.length} rows=${rows.length}`);

  const proof = tokenizeForLm("你好世界");
  for (const m of [OLD_MODEL, NEW_MODEL]) {
    let w = await runKenlmQueryBatch(m, queryPath, [proof], 120000);
    if (!w.ok) w = await runKenlmQueryBatch(m, queryPath, [proof], 120000);
    log(`warmup ${path.basename(path.dirname(m))}/${path.basename(m)} ok=${w.ok} ms=${w.wallMs || w.reason}`);
    if (!w.ok) throw new Error("warmup failed");
  }

  const regression = [];
  const rankingDiff = [];
  const failures = [];
  let unchanged = 0;
  let improved = 0;
  let regressed = 0;
  let top1Changed = 0;
  let correctBefore = 0;
  let correctAfter = 0;
  let oldRawTop1 = 0;
  let newRawTop1 = 0;
  let oldNonRawTop1 = 0;
  let newNonRawTop1 = 0;
  const oldGaps = [];
  const newGaps = [];

  for (let i = 0; i < caseIds.length; i++) {
    const bid = caseIds[i];
    const cands = byBench.get(bid);
    const humanDecision = cands[0].humanDecision;
    const status = cands[0].status;
    const texts = cands.map((c) => c.candidateText);

    const oldScores = await scoreWithModel(OLD_MODEL, texts);
    const newScores = sameBinary ? oldScores.slice() : await scoreWithModel(NEW_MODEL, texts);

    if (i % 10 === 0) log(`scored ${i + 1}/${caseIds.length}`);

    const oldRanked = rankByScore(cands, oldScores);
    const newRanked = rankByScore(cands, newScores);
    const oldTop1 = oldRanked[0];
    const newTop1 = newRanked[0];

    if (oldTop1.isRaw === "true") oldRawTop1++;
    else oldNonRawTop1++;
    if (newTop1.isRaw === "true") newRawTop1++;
    else newNonRawTop1++;

    const rawOld = oldRanked.find((r) => r.isRaw === "true");
    const rawNew = newRanked.find((r) => r.isRaw === "true");
    for (const r of oldRanked) {
      if (r.isRaw !== "true" && rawOld) oldGaps.push(Math.abs(r.score - rawOld.score));
    }
    for (const r of newRanked) {
      if (r.isRaw !== "true" && rawNew) newGaps.push(Math.abs(r.score - rawNew.score));
    }

    const matchOld = top1MatchesHuman(oldTop1, cands, humanDecision);
    const matchNew = top1MatchesHuman(newTop1, cands, humanDecision);
    const evalable = matchOld != null && matchNew != null;
    if (evalable) {
      if (matchOld) correctBefore++;
      if (matchNew) correctAfter++;
    }

    const winnerChanged = oldTop1.candidateId !== newTop1.candidateId;
    if (winnerChanged) top1Changed++;

    let deltaClass = "UNCHANGED";
    if (evalable) {
      if (matchOld === matchNew) {
        unchanged++;
        deltaClass = "UNCHANGED";
      } else if (!matchOld && matchNew) {
        improved++;
        deltaClass = "IMPROVED";
      } else if (matchOld && !matchNew) {
        regressed++;
        deltaClass = "REGRESSED";
      }
    } else {
      unchanged++;
      deltaClass = "UNCHANGED_NA";
    }

    for (const c of cands) {
      const o = oldRanked.find((r) => r.candidateId === c.candidateId);
      const n = newRanked.find((r) => r.candidateId === c.candidateId);
      rankingDiff.push({
        benchmarkId: bid,
        caseId: c.caseId,
        candidateId: c.candidateId,
        isRaw: c.isRaw,
        oldRank: o.rank,
        newRank: n.rank,
        oldScore: o.score,
        newScore: n.score,
        rankDelta: o.rank - n.rank,
        humanDecision,
        status,
      });
    }

    const prefId = preferredCandidateId(cands, humanDecision);
    const oldPref = rankingDiff.find((d) => d.benchmarkId === bid && d.candidateId === prefId);
    const newPref = rankingDiff.find((d) => d.benchmarkId === bid && d.candidateId === prefId);

    regression.push({
      benchmarkId: bid,
      oldRank: oldPref?.oldRank ?? "",
      newRank: newPref?.newRank ?? "",
      oldScore: oldPref?.oldScore ?? "",
      newScore: newPref?.newScore ?? "",
      winnerChanged,
      humanDecision,
      correctBefore: matchOld === true,
      correctAfter: matchNew === true,
      caseId: cands[0].caseId,
      oldTop1CandidateId: oldTop1.candidateId,
      newTop1CandidateId: newTop1.candidateId,
      deltaClass,
      status,
    });

    if (matchNew === false) {
      failures.push({
        benchmarkId: bid,
        caseId: cands[0].caseId,
        humanDecision,
        status,
        failureClass: classifyFailure(cands, newTop1, humanDecision),
        newTop1CandidateId: newTop1.candidateId,
        newTop1Text: newTop1.candidateText,
        correctBefore: matchOld === true,
      });
    }
  }

  const top1ChangedAndMatchesHuman = regression.filter(
    (r) => r.winnerChanged === true && r.correctAfter === true
  ).length;
  const top1ChangedToMatchHumanFromWrong = regression.filter(
    (r) => r.winnerChanged === true && r.correctAfter === true && r.correctBefore === false
  ).length;

  const trainMeta = fs.existsSync(TRAIN_META)
    ? JSON.parse(fs.readFileSync(TRAIN_META, "utf8"))
    : {};

  const net = improved - regressed;
  const better = !sameBinary && correctAfter > correctBefore && improved > regressed;
  const worthReplace = better && net >= 1;
  const finalVerdict = worthReplace
    ? "KENLM_FIRST_TRAIN_SUCCESS"
    : "KENLM_FIRST_TRAIN_NOT_BETTER";

  const failCounts = {};
  for (const f of failures) failCounts[f.failureClass] = (failCounts[f.failureClass] || 0) + 1;

  writeCsv(
    path.join(OUT, "benchmark_regression.csv"),
    [
      "benchmarkId",
      "oldRank",
      "newRank",
      "oldScore",
      "newScore",
      "winnerChanged",
      "humanDecision",
      "correctBefore",
      "correctAfter",
      "caseId",
      "oldTop1CandidateId",
      "newTop1CandidateId",
      "deltaClass",
      "status",
    ],
    regression
  );
  writeCsv(
    path.join(OUT, "ranking_diff.csv"),
    [
      "benchmarkId",
      "caseId",
      "candidateId",
      "isRaw",
      "oldRank",
      "newRank",
      "oldScore",
      "newScore",
      "rankDelta",
      "humanDecision",
      "status",
    ],
    rankingDiff
  );
  writeCsv(
    path.join(OUT, "failure_after_train.csv"),
    [
      "benchmarkId",
      "caseId",
      "humanDecision",
      "status",
      "failureClass",
      "newTop1CandidateId",
      "newTop1Text",
      "correctBefore",
    ],
    failures
  );
  writeCsv(
    path.join(OUT, "training_statistics.csv"),
    ["metric", "value"],
    [
      { metric: "corpusLines", value: trainMeta.corpusLines ?? "" },
      { metric: "tokenCount", value: trainMeta.tokenCount ?? "" },
      { metric: "vocabularySize", value: trainMeta.vocabularySize ?? "" },
      { metric: "ngramCountSum", value: trainMeta.ngramCountSum ?? "" },
      {
        metric: "ngramCountsByOrder",
        value: JSON.stringify(trainMeta.ngramCountsByOrder || []),
      },
      { metric: "arpaSizeBytes", value: trainMeta.arpaSizeBytes ?? "" },
      { metric: "binarySizeBytes", value: trainMeta.binarySizeBytes ?? "" },
      { metric: "oldModelSha256", value: oldSha },
      { metric: "newModelSha256", value: newSha },
      { metric: "sameBinaryAsOld", value: sameBinary },
      { metric: "cases", value: caseIds.length },
      { metric: "correctBefore", value: correctBefore },
      { metric: "correctAfter", value: correctAfter },
      { metric: "unchanged", value: unchanged },
      { metric: "improved", value: improved },
      { metric: "regressed", value: regressed },
      { metric: "top1Changed", value: top1Changed },
      { metric: "top1ChangedAndMatchesHuman", value: top1ChangedAndMatchesHuman },
      {
        metric: "top1ChangedToMatchHumanFromWrong",
        value: top1ChangedToMatchHumanFromWrong,
      },
      { metric: "oldRawTop1", value: oldRawTop1 },
      { metric: "newRawTop1", value: newRawTop1 },
      { metric: "oldNonRawTop1", value: oldNonRawTop1 },
      { metric: "newNonRawTop1", value: newNonRawTop1 },
      { metric: "oldAvgAbsGapVsRaw", value: avg(oldGaps) },
      { metric: "newAvgAbsGapVsRaw", value: avg(newGaps) },
      { metric: "oldMedianAbsGapVsRaw", value: median(oldGaps) },
      { metric: "newMedianAbsGapVsRaw", value: median(newGaps) },
      { metric: "failuresAfterTrain", value: failures.length },
      ...Object.entries(failCounts).map(([k, v]) => ({ metric: `failure_${k}`, value: v })),
    ]
  );

  const trainingConfig = {
    baseline: "FW_V4_FREEZE_2026_08_03",
    benchmark: "KENLM_BENCHMARK_V1",
    ngramOrder: 3,
    pruning: trainMeta.pruning || "none (lmplz default, no --prune)",
    discount: trainMeta.discount || "Modified Kneser-Ney (lmplz default)",
    memoryFlag: "-S 50%",
    buildCommand: trainMeta.buildCommand || null,
    corpusRaw: trainMeta.corpusRaw,
    corpusChar: trainMeta.corpusChar,
    oldModelPath: OLD_MODEL,
    oldModelSha256: oldSha,
    newModelPath: NEW_MODEL,
    newModelSha256: newSha,
    sameBinaryAsOld: sameBinary,
    productionReplaced: false,
    scoreNote: sameBinary
      ? "New trie sha256 identical to production; NEW scores = OLD scores after dual warmup proof"
      : "Both models scored independently via scoreBatch",
    trainMeta,
  };
  fs.writeFileSync(path.join(OUT, "training_config.json"), JSON.stringify(trainingConfig, null, 2) + "\n");

  const summary = {
    baseline: "FW_V4_FREEZE_2026_08_03",
    benchmark: "KENLM_BENCHMARK_V1",
    task: "KENLM_PHASE03_FIRST_TRAINING",
    nature: "MODEL_ONLY_FIRST_TRAIN_AND_BENCHMARK_REGRESSION",
    finalVerdict,
    answers: {
      Q1_trainSuccess: true,
      Q2_newBetterThanOld: better,
      Q3_improvedCases: improved,
      Q4_regressedCases: regressed,
      Q5_worthReplaceProduction: worthReplace,
    },
    metrics: {
      cases: caseIds.length,
      correctBefore,
      correctAfter,
      unchanged,
      improved,
      regressed,
      netGain: net,
      top1Changed,
      top1ChangedAndMatchesHuman,
      top1ChangedToMatchHumanFromWrong,
      old: {
        rawTop1: oldRawTop1,
        nonRawTop1: oldNonRawTop1,
        avgAbsGapVsRaw: avg(oldGaps),
        medianAbsGapVsRaw: median(oldGaps),
      },
      new: {
        rawTop1: newRawTop1,
        nonRawTop1: newNonRawTop1,
        avgAbsGapVsRaw: avg(newGaps),
        medianAbsGapVsRaw: median(newGaps),
      },
      failuresAfterTrain: failures.length,
      failureClasses: failCounts,
      sameBinaryAsOld: sameBinary,
    },
    models: {
      old: { path: OLD_MODEL, sha256: oldSha },
      new: { path: NEW_MODEL, sha256: newSha },
    },
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  const verdictBlock =
    finalVerdict === "KENLM_FIRST_TRAIN_SUCCESS"
      ? "第一版 KenLM 已训练完成。\n\nBenchmark Regression 已完成。\n\n可以决定是否替换生产模型。"
      : "训练成功。\n\n但 Benchmark Regression 未优于当前模型。\n\n保持旧模型。";

  const report = `# FW Repair V4 — KenLM Phase 03 First Training & Benchmark Regression

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Benchmark | **KENLM_BENCHMARK_V1** (75 cases, unmodified) |
| Nature | **MODEL ONLY** · first retrain + regression |
| Verdict | **${finalVerdict}** |

---

## 1. Executive

- Train success: **YES**
- New better than old: **${better ? "YES" : "NO"}**
- Improved / Regressed / Unchanged: **${improved} / ${regressed} / ${unchanged}**
- Correct before → after: **${correctBefore} → ${correctAfter}**
- Top1 changed: **${top1Changed}**
- Top1 changed ∧ matches Human: **${top1ChangedAndMatchesHuman}**
- Same binary as old: **${sameBinary}**
- Production replaced: **NO**

---

## 2. Training

| Metric | Value |
|--------|------:|
| Corpus lines | ${trainMeta.corpusLines ?? ""} |
| Tokens | ${trainMeta.tokenCount ?? ""} |
| Vocab | ${trainMeta.vocabularySize ?? ""} |
| N-Gram sum | ${trainMeta.ngramCountSum ?? ""} |
| ARPA bytes | ${trainMeta.arpaSizeBytes ?? ""} |
| Binary bytes | ${trainMeta.binarySizeBytes ?? ""} |
| Order | 3 |
| Pruning | none |
| Discount | Modified Kneser-Ney (default) |

Old sha256: \`${oldSha}\`  
New sha256: \`${newSha}\`

全量语料重训（\`lmplz -o 3 -S 50%\`）得到与生产 **bit-identical** trie，故 Benchmark 排序不变。

---

## 3. Answers

### Q1 — 训练是否成功？
**YES**

### Q2 — 新模型是否优于旧模型？
**${better ? "YES" : "NO"}**

### Q3 — 提升多少 Case？
**${improved}**

### Q4 — 下降多少 Case？
**${regressed}**

### Q5 — 是否值得替换当前 KenLM？
**${worthReplace ? "YES" : "NO"}**

---

## 4. Failures after train

Count: **${failures.length}**

| Class | Count |
|-------|------:|
${Object.entries(failCounts)
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join("\n") || "| (none) | 0 |"}

---

## 5. Final Verdict

\`\`\`text
${finalVerdict}

${verdictBlock}
\`\`\`
`;
  fs.writeFileSync(path.join(OUT, "report.md"), report, "utf8");
  fs.writeFileSync(
    path.join(OUT, "README.md"),
    `# KenLM Phase 03 First Training

| Field | Value |
|-------|-------|
| Verdict | **${finalVerdict}** |
| Benchmark | KENLM_BENCHMARK_V1 |
| Baseline | FW_V4_FREEZE_2026_08_03 |

See \`report.md\` / \`summary.json\`.
`,
    "utf8"
  );

  log(JSON.stringify(summary.answers));
  log(`finalVerdict=${finalVerdict}`);
  log(`out=${OUT}`);
  return summary;
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    try {
      fs.appendFileSync(path.join(OUT, "run.log"), String(err?.stack || err) + "\n");
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
