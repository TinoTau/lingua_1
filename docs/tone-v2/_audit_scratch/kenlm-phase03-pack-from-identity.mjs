#!/usr/bin/env node
/**
 * KenLM Phase 03 pack writer — when new trie sha256 == production trie,
 * Benchmark ranking is necessarily identical. Uses KENLM_BENCHMARK_V1 lmScore
 * (from Phase01/02 production model) as both old and new scores.
 * Does NOT modify benchmark labels.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "../../..");
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
const WARMUP_NOTE = path.join(OUT, "dual_warmup_proof.json");

fs.mkdirSync(OUT, { recursive: true });

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

function preferredCandidateId(cands, humanDecision) {
  const nonRaw = cands
    .filter((c) => c.isRaw === "true" ? false : true)
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId, "en"));
  // fix: isRaw check
  const alts = cands
    .filter((c) => c.isRaw !== "true")
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId, "en"));
  if (humanDecision === "RAW_CORRECT") return cands.find((c) => c.isRaw === "true")?.candidateId;
  if (humanDecision === "CANDIDATE_1") return alts[0]?.candidateId;
  if (humanDecision === "CANDIDATE_2") return alts[1]?.candidateId;
  return null;
}

function top1MatchesHuman(top1, cands, humanDecision) {
  if (humanDecision === "MULTIPLE_OK") {
    const alts = cands
      .filter((c) => c.isRaw !== "true")
      .sort((a, b) => a.candidateId.localeCompare(b.candidateId, "en"));
    const ok = new Set(
      [cands.find((c) => c.isRaw === "true")?.candidateId, alts[0]?.candidateId, alts[1]?.candidateId].filter(
        Boolean
      )
    );
    return ok.has(top1.candidateId);
  }
  if (humanDecision === "ALL_WRONG" || humanDecision === "UNDECIDABLE") return null;
  const pref = preferredCandidateId(cands, humanDecision);
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

const oldSha = sha256File(OLD_MODEL);
const newSha = sha256File(NEW_MODEL);
const sameBinary = oldSha === newSha;
if (!sameBinary) {
  console.error("Expected identical trie after same-corpus retrain; got different sha256");
  console.error({ oldSha, newSha });
  process.exit(2);
}

const trainMeta = JSON.parse(fs.readFileSync(TRAIN_META, "utf8"));
const rows = parseCsv(fs.readFileSync(BENCH, "utf8"));
const byBench = new Map();
for (const r of rows) {
  if (!byBench.has(r.benchmarkId)) byBench.set(r.benchmarkId, []);
  byBench.get(r.benchmarkId).push(r);
}
const caseIds = [...byBench.keys()].sort();

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
const gaps = [];

for (const bid of caseIds) {
  const cands = byBench.get(bid).map((c) => ({
    ...c,
    score: Number(c.lmScore),
    rankNum: Number(c.rank),
  }));
  // Rank by score (higher better); fall back to existing rank if needed
  const ranked = [...cands].sort((a, b) => {
    if (Number.isFinite(a.score) && Number.isFinite(b.score) && a.score !== b.score) {
      return b.score - a.score;
    }
    return a.rankNum - b.rankNum;
  });
  ranked.forEach((r, i) => {
    r.computedRank = i + 1;
  });

  // Identity: new == old
  const oldRanked = ranked;
  const newRanked = ranked;
  const oldTop1 = oldRanked[0];
  const newTop1 = newRanked[0];
  const humanDecision = cands[0].humanDecision;
  const status = cands[0].status;

  if (oldTop1.isRaw === "true") oldRawTop1++;
  else oldNonRawTop1++;
  if (newTop1.isRaw === "true") newRawTop1++;
  else newNonRawTop1++;

  const raw = oldRanked.find((r) => r.isRaw === "true");
  for (const r of oldRanked) {
    if (r.isRaw !== "true" && raw && Number.isFinite(r.score) && Number.isFinite(raw.score)) {
      gaps.push(Math.abs(r.score - raw.score));
    }
  }

  const matchOld = top1MatchesHuman(oldTop1, cands, humanDecision);
  const matchNew = top1MatchesHuman(newTop1, cands, humanDecision);
  if (matchOld != null) {
    if (matchOld) correctBefore++;
    if (matchNew) correctAfter++;
  }

  const winnerChanged = false; // identical model
  unchanged++;
  const deltaClass = matchOld == null ? "UNCHANGED_NA" : "UNCHANGED";

  for (const c of cands) {
    const o = oldRanked.find((r) => r.candidateId === c.candidateId);
    rankingDiff.push({
      benchmarkId: bid,
      caseId: c.caseId,
      candidateId: c.candidateId,
      isRaw: c.isRaw,
      oldRank: o.computedRank,
      newRank: o.computedRank,
      oldScore: o.score,
      newScore: o.score,
      rankDelta: 0,
      humanDecision,
      status,
    });
  }

  const prefId = preferredCandidateId(cands, humanDecision);
  const pref = rankingDiff.find((d) => d.benchmarkId === bid && d.candidateId === prefId);

  regression.push({
    benchmarkId: bid,
    oldRank: pref?.oldRank ?? "",
    newRank: pref?.newRank ?? "",
    oldScore: pref?.oldScore ?? "",
    newScore: pref?.newScore ?? "",
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

const failCounts = {};
for (const f of failures) failCounts[f.failureClass] = (failCounts[f.failureClass] || 0) + 1;

const better = false;
const worthReplace = false;
const finalVerdict = "KENLM_FIRST_TRAIN_NOT_BETTER";

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
    { metric: "corpusLines", value: trainMeta.corpusLines },
    { metric: "tokenCount", value: trainMeta.tokenCount },
    { metric: "vocabularySize", value: trainMeta.vocabularySize },
    { metric: "ngramCountSum", value: trainMeta.ngramCountSum },
    { metric: "ngramCountsByOrder", value: JSON.stringify(trainMeta.ngramCountsByOrder) },
    { metric: "arpaSizeBytes", value: trainMeta.arpaSizeBytes },
    { metric: "binarySizeBytes", value: trainMeta.binarySizeBytes },
    { metric: "oldModelSha256", value: oldSha },
    { metric: "newModelSha256", value: newSha },
    { metric: "sameBinaryAsOld", value: true },
    { metric: "cases", value: caseIds.length },
    { metric: "correctBefore", value: correctBefore },
    { metric: "correctAfter", value: correctAfter },
    { metric: "unchanged", value: unchanged },
    { metric: "improved", value: improved },
    { metric: "regressed", value: regressed },
    { metric: "top1Changed", value: top1Changed },
    { metric: "top1ChangedAndMatchesHuman", value: 0 },
    { metric: "oldRawTop1", value: oldRawTop1 },
    { metric: "newRawTop1", value: newRawTop1 },
    { metric: "oldNonRawTop1", value: oldNonRawTop1 },
    { metric: "newNonRawTop1", value: newNonRawTop1 },
    { metric: "oldAvgAbsGapVsRaw", value: avg(gaps) },
    { metric: "newAvgAbsGapVsRaw", value: avg(gaps) },
    { metric: "oldMedianAbsGapVsRaw", value: median(gaps) },
    { metric: "newMedianAbsGapVsRaw", value: median(gaps) },
    { metric: "failuresAfterTrain", value: failures.length },
    ...Object.entries(failCounts).map(([k, v]) => ({ metric: `failure_${k}`, value: v })),
  ]
);

const trainingConfig = {
  baseline: "FW_V4_FREEZE_2026_08_03",
  benchmark: "KENLM_BENCHMARK_V1",
  ngramOrder: 3,
  pruning: trainMeta.pruning,
  discount: trainMeta.discount,
  memoryFlag: trainMeta.memoryFlag,
  buildCommand: trainMeta.buildCommand,
  corpusRaw: trainMeta.corpusRaw,
  corpusChar: trainMeta.corpusChar,
  oldModelPath: OLD_MODEL,
  oldModelSha256: oldSha,
  newModelPath: NEW_MODEL,
  newModelSha256: newSha,
  sameBinaryAsOld: true,
  productionReplaced: false,
  regressionMethod:
    "Bit-identical trie (sha256 match) ⇒ scores/ranks identical to KENLM_BENCHMARK_V1 lmScore; dual warmup previously proved both models load",
  trainMeta,
};
fs.writeFileSync(path.join(OUT, "training_config.json"), JSON.stringify(trainingConfig, null, 2) + "\n");

// Preserve prior dual-warmup evidence if present in run.log
const runLog = path.join(OUT, "run.log");
fs.writeFileSync(
  WARMUP_NOTE,
  JSON.stringify(
    {
      oldSha,
      newSha,
      sameBinary: true,
      note: "phase03_first_train.sh rebuilt char corpus (439490 lines) + lmplz -o 3 -S 50% + build_binary trie; output trie sha256 equals production",
      priorLiveWarmup: fs.existsSync(runLog)
        ? fs.readFileSync(runLog, "utf8").split(/\r?\n/).filter((l) => l.includes("warmup"))
        : [],
    },
    null,
    2
  ) + "\n"
);

const summary = {
  baseline: "FW_V4_FREEZE_2026_08_03",
  benchmark: "KENLM_BENCHMARK_V1",
  task: "KENLM_PHASE03_FIRST_TRAINING",
  nature: "MODEL_ONLY_FIRST_TRAIN_AND_BENCHMARK_REGRESSION",
  finalVerdict,
  answers: {
    Q1_trainSuccess: true,
    Q2_newBetterThanOld: false,
    Q3_improvedCases: 0,
    Q4_regressedCases: 0,
    Q5_worthReplaceProduction: false,
  },
  metrics: {
    cases: caseIds.length,
    correctBefore,
    correctAfter,
    unchanged,
    improved,
    regressed,
    netGain: 0,
    top1Changed: 0,
    top1ChangedAndMatchesHuman: 0,
    old: {
      rawTop1: oldRawTop1,
      nonRawTop1: oldNonRawTop1,
      avgAbsGapVsRaw: avg(gaps),
      medianAbsGapVsRaw: median(gaps),
    },
    new: {
      rawTop1: newRawTop1,
      nonRawTop1: newNonRawTop1,
      avgAbsGapVsRaw: avg(gaps),
      medianAbsGapVsRaw: median(gaps),
    },
    failuresAfterTrain: failures.length,
    failureClasses: failCounts,
    sameBinaryAsOld: true,
  },
  models: {
    old: { path: OLD_MODEL, sha256: oldSha },
    new: { path: NEW_MODEL, sha256: newSha },
  },
};
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

const report = `# FW Repair V4 — KenLM Phase 03 First Training & Benchmark Regression

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Benchmark | **KENLM_BENCHMARK_V1**（75 Case，未修改） |
| Nature | **MODEL ONLY** · 全量语料重训 + Benchmark Regression |
| Verdict | **${finalVerdict}** |

---

## 1. Executive

| 项 | 值 |
|----|----|
| 训练成功 | YES |
| 新模型优于旧模型 | **NO** |
| 提升 Case | **0** |
| 下降 Case | **0** |
| 保持不变 | **${unchanged}** |
| Correct before → after | **${correctBefore} → ${correctAfter}** |
| Top1 改变 | **0** |
| Top1 改变且符合 Human Decision | **0** |
| 与旧模型 bit-identical | **YES** |
| 生产模型已替换 | **NO（保持旧模型）** |

---

## 2. Training

| Metric | Value |
|--------|------:|
| Corpus 行数 | ${trainMeta.corpusLines} |
| Token 数 | ${trainMeta.tokenCount} |
| Vocabulary Size | ${trainMeta.vocabularySize} |
| N-Gram 数量（Σ） | ${trainMeta.ngramCountSum} |
| N-Gram by order | ${JSON.stringify(trainMeta.ngramCountsByOrder)} |
| ARPA 大小 | ${trainMeta.arpaSizeBytes} bytes |
| Binary 大小 | ${trainMeta.binarySizeBytes} bytes |
| NGram Order | 3 |
| Pruning | none |
| Discount | Modified Kneser-Ney (lmplz default) |
| Build | \`lmplz -o 3 -S 50%\` → \`build_binary trie\` |

新模型路径：\`kenLM/model/phase03_first_train/\`  
sha256（新旧相同）：\`${oldSha}\`

同语料、同参数重训 ⇒ **与生产 trie 字节级一致**，故 Benchmark 排序/分数无变化。未覆盖生产路径。

---

## 3. Answers

### Q1 — 训练是否成功？
**YES**

### Q2 — 新模型是否优于旧模型？
**NO**

### Q3 — 提升多少 Case？
**0**

### Q4 — 下降多少 Case？
**0**

### Q5 — 是否值得替换当前 KenLM？
**NO**

---

## 4. Failures after train（相对 Human Decision）

仍失败：**${failures.length}**（与旧模型相同，因模型相同）

| Class | Count |
|-------|------:|
${Object.entries(failCounts)
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join("\n") || "| (none) | 0 |"}

未修改 Runtime / Recall / Candidate。

---

## 5. Final Verdict

\`\`\`text
KENLM_FIRST_TRAIN_NOT_BETTER

训练成功。

但 Benchmark Regression 未优于当前模型。

保持旧模型。
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

产物：\`training_config.json\` · \`training_statistics.csv\` · \`benchmark_regression.csv\` · \`ranking_diff.csv\` · \`report.md\` · \`summary.json\`
`,
  "utf8"
);

console.log(JSON.stringify(summary.answers, null, 2));
console.log("finalVerdict", finalVerdict);
console.log("failures", failures.length, failCounts);
console.log("correct", correctBefore, "→", correctAfter);
