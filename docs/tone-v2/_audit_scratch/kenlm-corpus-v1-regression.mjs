#!/usr/bin/env node
/**
 * Corpus V1 — benchmark regression vs production KenLM on KENLM_BENCHMARK_V1.
 * Does not modify benchmark labels. Scores NEW model; compares to CSV lmScore (old).
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
const OUT = path.join(repo, "docs/acceptance/Development/2026-08-04_KenLM_Corpus_Rebuild_V1");
const BENCH = path.join(
  repo,
  "docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark/kenlm_benchmark.csv"
);
const OLD_MODEL = path.join(
  repo,
  "electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin"
);
const NEW_MODEL = path.join(repo, "kenLM/model/corpus_v1/zh_char_3gram.trie.bin");
const TRAIN_META = path.join(repo, "kenLM/model/corpus_v1/training_meta.json");
const CORPUS_STATS = path.join(repo, "kenLM/corpus/v1/corpus_v1.stats.json");
const WIKI_COUNT = path.join(repo, "kenLM/corpus/v1_raw/wikipedia_linecount.txt");
const OSCAR_STATS = path.join(repo, "kenLM/corpus/v1_raw/oscar_sentences.stats.json");

fs.mkdirSync(OUT, { recursive: true });
process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;

const require = createRequire(path.join(electronRoot, "package.json"));
const { createKenlmBatchScorer } = require(
  path.join(dist, "asr-repair/sentence-rerank/kenlm-scorer.js")
);
const { resolveKenlmQueryPath, isKenlmSubprocessRunnable, runKenlmQueryBatch } = require(
  path.join(dist, "phonetic-correction/lm-scorer.js")
);
const { tokenizeForLm } = require(path.join(dist, "phonetic-correction/char-tokenize.js"));

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
function log(msg) {
  console.log(`[corpus-v1-reg] ${msg}`);
  fs.appendFileSync(path.join(OUT, "run.log"), msg + "\n");
}

function preferredId(cands, humanDecision) {
  const alts = cands
    .filter((c) => c.isRaw !== "true")
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId, "en"));
  if (humanDecision === "RAW_CORRECT") return cands.find((c) => c.isRaw === "true")?.candidateId;
  if (humanDecision === "CANDIDATE_1") return alts[0]?.candidateId;
  if (humanDecision === "CANDIDATE_2") return alts[1]?.candidateId;
  return null;
}
function matchesHuman(top1, cands, humanDecision) {
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
  const pref = preferredId(cands, humanDecision);
  return pref ? top1.candidateId === pref : null;
}
function rank(cands, scores) {
  const ranked = cands
    .map((c, i) => ({ ...c, score: scores[i] }))
    .sort((a, b) => b.score - a.score);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });
  return ranked;
}

async function scoreModel(modelPath, texts) {
  process.env.CHAR_LM_PATH = modelPath;
  const scorer = createKenlmBatchScorer();
  if (!scorer) throw new Error("scorer null " + modelPath);
  const res = await scorer.scoreBatch(texts);
  return texts.map((_, i) => Number(res.scores[i]?.score ?? NaN));
}

async function main() {
  fs.writeFileSync(path.join(OUT, "run.log"), "", "utf8");
  if (!fs.existsSync(NEW_MODEL)) throw new Error("missing new model " + NEW_MODEL);
  const oldSha = sha256File(OLD_MODEL);
  const newSha = sha256File(NEW_MODEL);
  log(`old=${oldSha}`);
  log(`new=${newSha}`);

  const queryPath = resolveKenlmQueryPath();
  if (!isKenlmSubprocessRunnable(NEW_MODEL, queryPath)) throw new Error("new model not runnable");
  const proof = tokenizeForLm("你好世界");
  let w = await runKenlmQueryBatch(NEW_MODEL, queryPath, [proof], 120000);
  if (!w.ok) w = await runKenlmQueryBatch(NEW_MODEL, queryPath, [proof], 120000);
  log(`warmup new ok=${w.ok} ms=${w.wallMs}`);

  const rows = parseCsv(fs.readFileSync(BENCH, "utf8"));
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.benchmarkId)) by.set(r.benchmarkId, []);
    by.get(r.benchmarkId).push(r);
  }
  const ids = [...by.keys()].sort();

  const regression = [];
  const rankingDiff = [];
  let improved = 0;
  let regressed = 0;
  let unchanged = 0;
  let correctBefore = 0;
  let correctAfter = 0;

  for (let i = 0; i < ids.length; i++) {
    const bid = ids[i];
    const cands = by.get(bid);
    const humanDecision = cands[0].humanDecision;
    const texts = cands.map((c) => c.candidateText);
    const oldScores = cands.map((c) => Number(c.lmScore));
    const newScores = await scoreModel(NEW_MODEL, texts);
    const oldRanked = rank(cands, oldScores);
    const newRanked = rank(cands, newScores);
    const oldTop1 = oldRanked[0];
    const newTop1 = newRanked[0];
    const mOld = matchesHuman(oldTop1, cands, humanDecision);
    const mNew = matchesHuman(newTop1, cands, humanDecision);
    if (mOld != null) {
      if (mOld) correctBefore++;
      if (mNew) correctAfter++;
      if (mOld === mNew) unchanged++;
      else if (!mOld && mNew) improved++;
      else if (mOld && !mNew) regressed++;
    } else unchanged++;

    for (const c of cands) {
      const o = oldRanked.find((x) => x.candidateId === c.candidateId);
      const n = newRanked.find((x) => x.candidateId === c.candidateId);
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
      });
    }
    const pref = preferredId(cands, humanDecision);
    const op = rankingDiff.find((d) => d.benchmarkId === bid && d.candidateId === pref);
    const np = rankingDiff.find((d) => d.benchmarkId === bid && d.candidateId === pref);
    regression.push({
      benchmarkId: bid,
      oldRank: op?.oldRank ?? "",
      newRank: np?.newRank ?? "",
      oldScore: op?.oldScore ?? "",
      newScore: np?.newScore ?? "",
      winnerChanged: oldTop1.candidateId !== newTop1.candidateId,
      humanDecision,
      correctBefore: mOld === true,
      correctAfter: mNew === true,
      caseId: cands[0].caseId,
      deltaClass:
        mOld == null
          ? "UNCHANGED_NA"
          : mOld === mNew
            ? "UNCHANGED"
            : !mOld && mNew
              ? "IMPROVED"
              : "REGRESSED",
    });
    if (i % 10 === 0) log(`scored ${i + 1}/${ids.length}`);
  }

  const trainMeta = JSON.parse(fs.readFileSync(TRAIN_META, "utf8"));
  const corpusStats = fs.existsSync(CORPUS_STATS)
    ? JSON.parse(fs.readFileSync(CORPUS_STATS, "utf8"))
    : {};
  const oscarStats = fs.existsSync(OSCAR_STATS)
    ? JSON.parse(fs.readFileSync(OSCAR_STATS, "utf8"))
    : {};
  let wikiSentences = corpusStats.perSource?.wikipedia_sentences ?? null;
  if (fs.existsSync(WIKI_COUNT)) {
    const wc = fs.readFileSync(WIKI_COUNT, "utf8").trim().split(/\s+/)[0];
    if (wc) wikiSentences = Number(wc);
  }

  const better = correctAfter > correctBefore && improved > regressed;
  const finalVerdict = better ? "KENLM_CORPUS_V1_READY" : "KENLM_CORPUS_V1_NOT_BETTER";

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
      "deltaClass",
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
    ],
    rankingDiff
  );
  writeCsv(
    path.join(OUT, "corpus_statistics.csv"),
    ["metric", "value"],
    [
      { metric: "wikipediaSentences", value: wikiSentences ?? "" },
      { metric: "oscarSentences", value: oscarStats.sentences_kept ?? corpusStats.perSource?.oscar_sentences ?? "" },
      { metric: "corpusSentenceCount", value: corpusStats.sentenceCount ?? trainMeta.corpusLines },
      { metric: "corpusTokenCount", value: corpusStats.tokenCount ?? trainMeta.tokenCount },
      { metric: "corpusVocabularySize", value: corpusStats.vocabularySize ?? "" },
      { metric: "arpaVocabularySize", value: trainMeta.vocabularySize },
      { metric: "minChars", value: 4 },
      { metric: "maxChars", value: 256 },
    ]
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
      { metric: "binarySha256", value: newSha },
      { metric: "oldBinarySha256", value: oldSha },
      { metric: "correctBefore", value: correctBefore },
      { metric: "correctAfter", value: correctAfter },
      { metric: "improved", value: improved },
      { metric: "regressed", value: regressed },
      { metric: "unchanged", value: unchanged },
    ]
  );

  const summary = {
    baseline: "FW_V4_FREEZE_2026_08_03",
    benchmark: "KENLM_BENCHMARK_V1",
    task: "KENLM_CORPUS_REBUILD_V1",
    finalVerdict,
    answers: {
      Q1_wikipediaSentences: wikiSentences,
      Q2_oscarSentences: 0,
      Q2_oscarNote: "OSCAR abandoned (gated pending); Corpus V1 = Wikipedia only",
      Q3_vocabulary: trainMeta.vocabularySize,
      Q4_trieBinaryBytes: trainMeta.binarySizeBytes,
      Q5_improved: improved,
      Q5_regressed: regressed,
      Q6_recommendReplace: better,
    },
    metrics: { correctBefore, correctAfter, improved, regressed, unchanged },
    models: { oldSha, newSha, newPath: NEW_MODEL, productionReplaced: false },
    corpusStats,
    trainMeta,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  const report = `# FW Repair V4 — KenLM Corpus Rebuild V1

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | FW_V4_FREEZE_2026_08_03 |
| Benchmark | KENLM_BENCHMARK_V1（未改标注） |
| Verdict | **${finalVerdict}** |

## Answers

### Q1 Wikipedia 最终保留多少句？
**${wikiSentences}**

### Q2 OSCAR 最终保留多少句？
**0**（本轮放弃 OSCAR，仅 Wikipedia）

### Q3 最终 Vocabulary？
**${trainMeta.vocabularySize}**

### Q4 Trie Binary 大小？
**${trainMeta.binarySizeBytes}** bytes

### Q5 Benchmark 提升 / 下降？
提升 **${improved}** · 下降 **${regressed}**（Correct ${correctBefore}→${correctAfter}）

### Q6 是否建议替换生产模型？
**${better ? "YES" : "NO"}**

## Final Verdict

\`\`\`text
${finalVerdict}
\`\`\`
`;
  fs.writeFileSync(path.join(OUT, "report.md"), report, "utf8");
  fs.writeFileSync(
    path.join(OUT, "README.md"),
    `# KenLM Corpus Rebuild V1\n\nVerdict: **${finalVerdict}**\n\nSee report.md / summary.json.\n`,
    "utf8"
  );
  log(JSON.stringify(summary.answers));
  log("finalVerdict=" + finalVerdict);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
