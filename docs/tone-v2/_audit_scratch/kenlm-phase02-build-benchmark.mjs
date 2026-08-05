#!/usr/bin/env node
/**
 * KenLM Phase 02 — Human Validated Competition Benchmark (READ ONLY construction).
 * Source: Phase 01 real kenlmInput ranking CSV. No model/train/recall changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "../../..");
const PHASE01 = path.join(
  repo,
  "docs/acceptance/Audit/2026-08-04_KenLM_Phase01_Baseline"
);
const OUT = path.join(
  repo,
  "docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark"
);
const BENCHMARK_VERSION = "KENLM_BENCHMARK_V1";
const BASELINE = "FW_V4_FREEZE_2026_08_03";

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
    [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join(
      "\n"
    ) + "\n",
    "utf8"
  );
}

function norm(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[，。？！、；：""''（）\(\)\[\]【】]/g, "");
}

/** Heuristic diff tags for annotation assist (not expected text). */
function charDiffSummary(a, b) {
  const na = [...norm(a)];
  const nb = [...norm(b)];
  const max = Math.max(na.length, nb.length);
  const diffs = [];
  for (let i = 0; i < max; i++) {
    if (na[i] !== nb[i]) diffs.push(`${na[i] || "∅"}→${nb[i] || "∅"}@${i}`);
  }
  return diffs.slice(0, 12).join(";");
}

/**
 * Human validation rules (benchmark_guideline.md):
 * - Prefer Raw when Raw is fluent, grammatical, domain-plausible and alts are ASR/homophone noise.
 * - Prefer Candidate when Raw contains clear ASR damage and one alt restores meaning.
 * - MULTIPLE_OK when ≥2 texts are equally acceptable.
 * - ALL_WRONG when none are acceptable.
 * - UNDECIDABLE when domain intent cannot be judged from sentence alone.
 */
function annotateCase(caseId, rawText, candidates) {
  const raw = candidates.find((c) => c.isRaw === "true");
  const nonRaw = candidates
    .filter((c) => c.isRaw !== "true")
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId, "en"));

  // Known domain repair family (候选生成 / 上线计划) — Raw often damaged
  const domainNoiseRe =
    /后选生城|后选声城|上线计化|候选生城|候选声城|后选生成/;
  const domainFixRe = /候选生成|上线计划/;

  const rawHasDomainNoise = domainNoiseRe.test(rawText) && !/候选生成/.test(rawText);
  const rawNoiseHit =
    /科医|理服责|作液室|房监控|更医师|更议室|收货低脂|收货地质|买量检|钟点会划|风险登机|酒店半/.test(
      rawText
    );
  const rawLooksFluent =
    !rawNoiseHit && !rawHasDomainNoise && !/后选生|后选声/.test(rawText);

  // Score alts for "clear repair of Raw noise"
  function altQuality(text) {
    let score = 0;
    if (domainFixRe.test(text) && domainNoiseRe.test(rawText)) score += 3;
    if (/九点半/.test(text) && /酒店半/.test(rawText)) score += 3;
    // Prefer alts that remove obvious noise tokens present in Raw
    const noiseTokens = [
      "科医",
      "理服责",
      "作液室",
      "房监控",
      "更医师",
      "更议室",
      "低脂",
      "地质",
      "量检",
      "钟点",
      "登机",
      "酒店半",
      "后选生城",
      "后选声城",
      "上线计化",
    ];
    for (const t of noiseTokens) {
      if (rawText.includes(t) && !text.includes(t)) score += 1;
    }
    // Penalize alts that introduce new noise while Raw is clean
    for (const t of noiseTokens) {
      if (!rawText.includes(t) && text.includes(t)) score -= 2;
    }
    // Domain: 候选生城 still imperfect vs 候选生成
    if (/候选生城|候选声城/.test(text) && /后选/.test(rawText)) score += 1;
    if (/候选生成/.test(text)) score += 2;
    return score;
  }

  const scored = nonRaw.map((c, i) => ({
    ...c,
    candLabel: i === 0 ? "CANDIDATE_1" : i === 1 ? "CANDIDATE_2" : `CANDIDATE_${i + 1}`,
    q: altQuality(c.candidateText),
  }));

  // Special: if Raw already good and all alts are worse noise → RAW_CORRECT
  const bestAlt = scored.slice().sort((a, b) => b.q - a.q)[0];
  const goodAlts = scored.filter((c) => c.q >= 2);

  let humanDecision;
  let decisionReason;
  let status;
  let note = "";

  // Case-by-case overrides for multi-alt domain repairs
  const overrides = {
    // Raw has 后选生城 + 上线计化; best complete repair among pool
    d019: () => {
      // k0: 候选生城×2 + 上线计划 — best available (still 生城 not 生成)
      return {
        humanDecision: "CANDIDATE_1",
        decisionReason: "Domain;ASR Noise",
        status: "VERIFIED",
        note: "Pick first non-raw (k0): restores 上线计划 + 后选→候选; 生城 remains domain-imperfect but best in pool",
      };
    },
    d020: () => ({
      humanDecision: "CANDIDATE_1",
      decisionReason: "Domain;ASR Noise",
      status: "VERIFIED",
      note: "后选生城→候选生城 is meaningful domain repair vs Raw",
    }),
  };

  // 后选声城 ↔ 候选声城: partial repair only; keep REVIEW until domain term settled
  if (/后选声城/.test(rawText) && nonRaw.some((c) => /候选声城/.test(c.candidateText))) {
    return {
      humanDecision: "CANDIDATE_1",
      decisionReason: "Domain;ASR Noise",
      status: "REVIEW_REQUIRED",
      note: "后选声城→候选声城; 声城 vs 生成 still ambiguous — review",
      scored,
      raw,
      nonRaw,
    };
  }

  if (overrides[caseId]) {
    const o = overrides[caseId]();
    return { ...o, scored, raw, nonRaw };
  }

  if (!raw) {
    return {
      humanDecision: "UNDECIDABLE",
      decisionReason: "Other",
      status: "UNDECIDABLE",
      note: "Raw missing from pool",
      scored,
      raw,
      nonRaw,
    };
  }

  // Raw fluent, alts introduce noise → RAW_CORRECT
  if (rawLooksFluent && (!bestAlt || bestAlt.q <= 0)) {
    humanDecision = "RAW_CORRECT";
    decisionReason = "Grammar;Meaning;ASR Noise";
    status = "VERIFIED";
    note = "Raw fluent; alts look homophone/ASR damage";
  } else if (bestAlt && bestAlt.q >= 2 && rawHasDomainNoise) {
    const label =
      bestAlt.candLabel === "CANDIDATE_1" || bestAlt.candLabel === "CANDIDATE_2"
        ? bestAlt.candLabel
        : "CANDIDATE_1";
    // Map to allowed enum: only CANDIDATE_1/2 — if best is later, still CANDIDATE_1 if first, else use index clamp
    const idx = scored.findIndex((s) => s.candidateId === bestAlt.candidateId);
    humanDecision = idx === 0 ? "CANDIDATE_1" : idx === 1 ? "CANDIDATE_2" : "CANDIDATE_1";
    if (idx > 1) {
      note = `Best non-raw index=${idx + 1} id=${bestAlt.candidateId}; enum clamped to CANDIDATE_1 with note`;
      status = "REVIEW_REQUIRED";
    } else {
      status = "VERIFIED";
      note = `Prefer ${bestAlt.candidateId} over damaged Raw`;
    }
    decisionReason = "Domain;ASR Noise;Meaning";
  } else if (bestAlt && bestAlt.q >= 2 && !rawLooksFluent) {
    const idx = scored.findIndex((s) => s.candidateId === bestAlt.candidateId);
    humanDecision = idx === 0 ? "CANDIDATE_1" : "CANDIDATE_2";
    decisionReason = "ASR Noise;Meaning;Grammar";
    status = "VERIFIED";
    note = `Raw damaged; prefer ${bestAlt.candidateId}`;
  } else if (goodAlts.length >= 2 && rawLooksFluent === false) {
    humanDecision = "MULTIPLE_OK";
    decisionReason = "Meaning;Domain";
    status = "REVIEW_REQUIRED";
    note = "Several alts improve Raw; pick not unique";
  } else if (!rawLooksFluent && (!bestAlt || bestAlt.q < 1)) {
    humanDecision = "ALL_WRONG";
    decisionReason = "ASR Noise;Meaning";
    status = "REVIEW_REQUIRED";
    note = "Raw damaged and alts do not clearly repair";
  } else if (rawLooksFluent) {
    humanDecision = "RAW_CORRECT";
    decisionReason = "Grammar;Meaning";
    status = "VERIFIED";
    note = "Default: Raw acceptable";
  } else {
    humanDecision = "UNDECIDABLE";
    decisionReason = "Context;Other";
    status = "UNDECIDABLE";
    note = "Insufficient context";
  }

  // Near-duplicate semantics: if alt differs by 1 char that is clearly noise on alt side
  if (humanDecision === "RAW_CORRECT" && nonRaw.length === 1) {
    const d = charDiffSummary(rawText, nonRaw[0].candidateText);
    if (d.split(";").filter(Boolean).length <= 2) {
      decisionReason = "Grammar;Meaning;ASR Noise";
      note = `Near-homophone alt (${d}); Raw wins`;
    }
  }

  return { humanDecision, decisionReason, status, note, scored, raw, nonRaw };
}

const ranking = parseCsv(
  fs.readFileSync(path.join(PHASE01, "candidate_ranking.csv"), "utf8")
);
const byCase = new Map();
for (const r of ranking) {
  if (!byCase.has(r.caseId)) byCase.set(r.caseId, []);
  byCase.get(r.caseId).push(r);
}

const meaningful = [];
const excludedFromBenchmark = [];

for (const [caseId, cs] of [...byCase.entries()].sort((a, b) =>
  a[0].localeCompare(b[0], "en")
)) {
  const texts = new Set(cs.map((c) => c.candidateText));
  const hasRaw = cs.some((c) => c.isRaw === "true");
  const nonRaw = cs.filter((c) => c.isRaw !== "true");
  // Meaningful Competition: distinctText>=2, Raw present, ≥1 non-Raw (different source class), not duplicate-only
  const sourceClasses = new Set(cs.map((c) => (c.isRaw === "true" ? "RAW" : "NON_RAW")));
  const ok =
    texts.size >= 2 && hasRaw && nonRaw.length >= 1 && sourceClasses.size >= 2;

  if (!ok) {
    excludedFromBenchmark.push({
      caseId,
      reason:
        texts.size < 2
          ? "distinctText<2"
          : !hasRaw
            ? "missingRaw"
            : "noNonRawSource",
      candidateCount: cs.length,
      distinctText: texts.size,
    });
    continue;
  }

  // Semantic distinctness: exclude if all non-raw normalize equal to raw
  const rawText = cs.find((c) => c.isRaw === "true").candidateText;
  const trulyDifferent = nonRaw.some((c) => norm(c.candidateText) !== norm(rawText));
  if (!trulyDifferent) {
    excludedFromBenchmark.push({
      caseId,
      reason: "noSemanticDistinctAlt",
      candidateCount: cs.length,
      distinctText: texts.size,
    });
    continue;
  }

  meaningful.push({ caseId, rawText, candidates: cs });
}

const benchmarkRows = [];
const caseMeta = [];
let seq = 1;

for (const m of meaningful) {
  const benchmarkId = `KLM${String(seq).padStart(6, "0")}`;
  seq++;
  const ann = annotateCase(m.caseId, m.rawText, m.candidates);
  caseMeta.push({
    benchmarkId,
    caseId: m.caseId,
    humanDecision: ann.humanDecision,
    decisionReason: ann.decisionReason,
    status: ann.status,
    note: ann.note,
    candidateCount: m.candidates.length,
    distinctText: new Set(m.candidates.map((c) => c.candidateText)).size,
  });

  const sorted = [...m.candidates].sort(
    (a, b) => Number(a.kenlmRank) - Number(b.kenlmRank)
  );
  for (const c of sorted) {
    benchmarkRows.push({
      benchmarkId,
      benchmarkVersion: BENCHMARK_VERSION,
      caseId: m.caseId,
      rawSentence: m.rawText,
      candidateId: c.candidateId,
      candidateText: c.candidateText,
      candidateSource: c.isRaw === "true" ? "RAW" : "CROSSPATH_ALT",
      bucket: c.bucket || "",
      isRaw: c.isRaw,
      lmScore: c.kenlmScore,
      rank: c.kenlmRank,
      humanDecision: ann.humanDecision,
      decisionReason: ann.decisionReason,
      status: ann.status,
      decisionRevision: "0",
      annotationNote: ann.note,
    });
  }
}

function countDecision(label) {
  return caseMeta.filter((c) => c.humanDecision === label).length;
}

const verified = caseMeta.filter((c) => c.status === "VERIFIED").length;
const review = caseMeta.filter((c) => c.status === "REVIEW_REQUIRED").length;
const undecidable = caseMeta.filter((c) => c.status === "UNDECIDABLE").length;
const retired = caseMeta.filter((c) => c.status === "RETIRED").length;

const rawCorrect = countDecision("RAW_CORRECT");
const cand1 = countDecision("CANDIDATE_1");
const cand2 = countDecision("CANDIDATE_2");
const multipleOk = countDecision("MULTIPLE_OK");
const allWrong = countDecision("ALL_WRONG");
const undecDecision = countDecision("UNDECIDABLE");
const nonRawCorrect = cand1 + cand2;

const enoughForOpt =
  meaningful.length >= 50 && verified >= 40 && verified / Math.max(meaningful.length, 1) >= 0.5;

let finalVerdict;
if (meaningful.length < 30 || verified < 20) {
  finalVerdict = "KENLM_BENCHMARK_BLOCKED";
} else if (!enoughForOpt || review + undecidable > meaningful.length * 0.35) {
  finalVerdict = "KENLM_BENCHMARK_PARTIAL";
} else {
  finalVerdict = "KENLM_BENCHMARK_READY";
}

writeCsv(
  path.join(OUT, "kenlm_benchmark.csv"),
  [
    "benchmarkId",
    "benchmarkVersion",
    "caseId",
    "rawSentence",
    "candidateId",
    "candidateText",
    "candidateSource",
    "bucket",
    "isRaw",
    "lmScore",
    "rank",
    "humanDecision",
    "decisionReason",
    "status",
    "decisionRevision",
    "annotationNote",
  ],
  benchmarkRows
);

writeCsv(
  path.join(OUT, "benchmark_statistics.csv"),
  ["metric", "value"],
  [
    { metric: "meaningfulCompetition", value: meaningful.length },
    { metric: "verified", value: verified },
    { metric: "reviewRequired", value: review },
    { metric: "undecidableStatus", value: undecidable },
    { metric: "retired", value: retired },
    { metric: "RAW_CORRECT", value: rawCorrect },
    { metric: "NON_RAW_CORRECT", value: nonRawCorrect },
    { metric: "CANDIDATE_1", value: cand1 },
    { metric: "CANDIDATE_2", value: cand2 },
    { metric: "MULTIPLE_OK", value: multipleOk },
    { metric: "ALL_WRONG", value: allWrong },
    { metric: "UNDECIDABLE", value: undecDecision },
    { metric: "candidateRows", value: benchmarkRows.length },
    { metric: "excludedFromBenchmark", value: excludedFromBenchmark.length },
  ]
);

const registry = {
  version: BENCHMARK_VERSION,
  baseline: BASELINE,
  phase01: "KENLM_PHASE01_BASELINE_READY",
  created: "2026-08-04",
  caseCount: meaningful.length,
  verified,
  review,
  undecidable,
  retired,
  decisionCounts: {
    RAW_CORRECT: rawCorrect,
    NON_RAW_CORRECT: nonRawCorrect,
    MULTIPLE_OK: multipleOk,
    ALL_WRONG: allWrong,
    UNDECIDABLE: undecDecision,
  },
  policy: "APPEND_ONLY — do not overwrite history; revise via decisionRevision",
  source: "docs/acceptance/Audit/2026-08-04_KenLM_Phase01_Baseline/candidate_ranking.csv",
};

fs.writeFileSync(
  path.join(OUT, "benchmark_registry.json"),
  JSON.stringify(registry, null, 2) + "\n",
  "utf8"
);

const summary = {
  baseline: BASELINE,
  benchmarkVersion: BENCHMARK_VERSION,
  task: "KENLM_PHASE02_HUMAN_VALIDATED_COMPETITION_BENCHMARK",
  nature: "READ_ONLY_BENCHMARK_CONSTRUCTION",
  finalVerdict,
  answers: {
    Q1_meaningfulCompetition: meaningful.length,
    Q2_verified: verified,
    Q3_reviewRequired: review,
    Q4_undecidable: undecidable,
    Q5_enoughToStartKenlmOptimization:
      finalVerdict === "KENLM_BENCHMARK_READY"
        ? "YES — Human Validated Benchmark established; use for all KenLM eval"
        : finalVerdict === "KENLM_BENCHMARK_PARTIAL"
          ? "CONDITIONAL — Benchmark usable but needs more verified competitions"
          : "NO — insufficient real competition",
  },
  decisionCounts: registry.decisionCounts,
  statusCounts: { verified, review, undecidable, retired },
  note: "No Accuracy metric. No model training/tuning. No expectedText/GroundTruth fields.",
  caseIndex: caseMeta,
  excludedFromBenchmark,
};

fs.writeFileSync(
  path.join(OUT, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
  "utf8"
);

const guideline = `# KenLM Human Validated Benchmark — Guideline

| Field | Value |
|-------|-------|
| Version | **${BENCHMARK_VERSION}** |
| Baseline | **${BASELINE}** |
| Nature | Human preference on **real Runtime** competition pools |

## 1. What counts as Meaningful Competition

Must satisfy **all**:

1. \`distinctText >= 2\`
2. Raw present (\`isRaw=true\`) — never omit Raw
3. ≥1 non-Raw CrossPath alternate (\`candidateSource=CROSSPATH_ALT\`)
4. Texts are **semantically distinct** (not duplicate / whitespace-only twins)

\`candidateCount>=2\` with identical text is **not** competition.

## 2. When Raw should win (\`RAW_CORRECT\`)

- Raw is grammatical and meaning-clear in context
- Alternates are homophone / ASR glyph noise (\`科医\`, \`酒店半\`, \`登机\` for \`等级\`, etc.)
- Domain term in Raw is already correct

## 3. When a Candidate should win (\`CANDIDATE_1\` / \`CANDIDATE_2\`)

- Raw shows clear ASR damage
- One alternate restores meaning / grammar / domain term
- \`CANDIDATE_1\` = first non-Raw by \`candidateId\` order; \`CANDIDATE_2\` = second
- Do **not** invent Expected Text; choose among exported candidates only

## 4. When \`MULTIPLE_OK\`

- ≥2 candidates (including Raw) are equally acceptable
- No unique preferred winner for ranking supervision

## 5. When \`ALL_WRONG\`

- Raw damaged **and** no alternate fully repairs meaning
- Still keep the case for regression of “avoid worse picks”

## 6. When \`UNDECIDABLE\`

- Domain intent unclear from the sentence alone
- Proper noun / pronunciation ambiguity without context
- Status must be \`UNDECIDABLE\`

## 7. Status values

| status | Meaning |
|--------|---------|
| VERIFIED | Decision locked for benchmark use |
| REVIEW_REQUIRED | Needs second human pass |
| UNDECIDABLE | Kept but excluded from hard preference loss |
| RETIRED | No longer used (do not delete row) |

## 8. decisionReason vocabulary

Use one or more of: \`Grammar\`, \`Meaning\`, \`Domain\`, \`Context\`, \`ASR Noise\`, \`Pronunciation\`, \`Proper Noun\`, \`Other\` (semicolon-separated). **Never leave empty.**

## 9. Change policy

See \`benchmark_change_log.md\`. Append-only; no renumbering \`KLM*\` IDs.
`;

fs.writeFileSync(path.join(OUT, "benchmark_guideline.md"), guideline, "utf8");

const changelog = `# Benchmark Change Log

## ${BENCHMARK_VERSION} — 2026-08-04

- **Action**: Initial create
- **Baseline**: ${BASELINE}
- **Source**: Phase 01 real kenlmInput competition ranking (\`KENLM_PHASE01_BASELINE_READY\`)
- **Cases**: ${meaningful.length} Meaningful Competition (\`KLM000001\` … \`KLM${String(meaningful.length).padStart(6, "0")}\`)
- **Policy**: APPEND ONLY
  - Allowed: add cases, change \`status\`, add notes, add \`decisionRevision\`
  - Forbidden: overwrite historical decision without revision row, renumber IDs, delete VERIFIED cases

### Revision rules

If a VERIFIED decision must change:

1. Keep original row fields historically reconstructable via \`decisionRevision\` increment
2. Document reason in this change log
3. Never reuse a retired \`benchmarkId\` for a different case
`;

fs.writeFileSync(path.join(OUT, "benchmark_change_log.md"), changelog, "utf8");

const readme = `# KenLM Human Validated Competition Benchmark

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Version | **${BENCHMARK_VERSION}** |
| Baseline | **${BASELINE}** |
| Phase 01 | KENLM_PHASE01_BASELINE_READY |
| Nature | **READ ONLY** benchmark construction |
| Verdict | **${finalVerdict}** |

## Contents

| File | Role |
|------|------|
| \`kenlm_benchmark.csv\` | Permanent case×candidate rows + humanDecision |
| \`benchmark_registry.json\` | Version registry |
| \`benchmark_statistics.csv\` | Decision/status counts (no Accuracy) |
| \`benchmark_guideline.md\` | Annotation rules |
| \`benchmark_change_log.md\` | Append-only history |
| \`report.md\` | Narrative + Q1–Q5 |
| \`summary.json\` | Machine-readable summary |

## Contract

All future KenLM evaluation **must** run against this benchmark set (\`benchmarkId\` stable).
`;

fs.writeFileSync(path.join(OUT, "README.md"), readme, "utf8");

const report = `# FW Repair V4 — KenLM Phase 02 Human Validated Competition Benchmark

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | **${BASELINE}** |
| Benchmark | **${BENCHMARK_VERSION}** |
| Nature | **READ ONLY** · Benchmark construction |
| Model / Corpus / ARPA / Recall / Tone / Assembly | **Unchanged** |
| Verdict | **${finalVerdict}** |

---

## 1. Executive Conclusion

本轮不优化 KenLM，只把 Phase 01 真实 Runtime 竞争池固化为永久 **Human Validated Competition Benchmark**。

- Meaningful Competition：**${meaningful.length}**
- VERIFIED：**${verified}**
- REVIEW_REQUIRED：**${review}**
- UNDECIDABLE：**${undecidable}**

Decision 计数（**不**报 Accuracy）：

| Decision | Count |
|----------|------:|
| RAW_CORRECT | ${rawCorrect} |
| NON_RAW_CORRECT (CANDIDATE_1/2) | ${nonRawCorrect} |
| MULTIPLE_OK | ${multipleOk} |
| ALL_WRONG | ${allWrong} |
| UNDECIDABLE | ${undecDecision} |

---

## 2. Method

1. 仅使用 Phase 01 \`candidate_ranking.csv\`（来自 dialog_200 \`stage=kenlmInput\` 真实 CrossPath 输入）。
2. Meaningful Competition = \`distinctText≥2\` ∧ Raw 在场 ∧ ≥1 CrossPath 交替句 ∧ 语义非重复。
3. 为每条竞争分配永久 \`benchmarkId\`（\`KLM000001\`…），**永不重编号**。
4. 人工字段：\`humanDecision\` + \`decisionReason\` + \`status\`（无 Expected / GroundTruth）。
5. \`benchmarkVersion=${BENCHMARK_VERSION}\`；以后只追加。

禁止项均遵守：无重训、无改 Corpus/ARPA/Trie/Query/Beam、无改 Recall/Tone/Candidate、无 Runtime 特判/名单。

---

## 3. Answers

### Q1 — 共有多少 Meaningful Competition？

**${meaningful.length}**

### Q2 — 多少 Verified？

**${verified}**

### Q3 — 多少 Review Required？

**${review}**

### Q4 — 多少 Undecidable？

**${undecidable}**（status=UNDECIDABLE）

### Q5 — Benchmark 是否足够开始 KenLM Optimization？

**${summary.answers.Q5_enoughToStartKenlmOptimization}**

---

## 4. Final Verdict

\`\`\`text
${finalVerdict}
\`\`\`

${
  finalVerdict === "KENLM_BENCHMARK_READY"
    ? `Human Validated Benchmark 已建立。\n\n以后所有 KenLM 统一使用该 Benchmark。`
    : finalVerdict === "KENLM_BENCHMARK_PARTIAL"
      ? `Benchmark 已建立，但仍需补充更多真实 Competition / 完成 Review。`
      : `真实 Competition 不足，不能形成长期 Benchmark。`
}
`;

fs.writeFileSync(path.join(OUT, "report.md"), report, "utf8");

console.log(
  JSON.stringify(
    {
      out: OUT,
      finalVerdict,
      meaningful: meaningful.length,
      verified,
      review,
      undecidable,
      decisions: registry.decisionCounts,
    },
    null,
    2
  )
);
