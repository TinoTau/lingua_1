#!/usr/bin/env node
/**
 * Offline ASR repair quality normalized baseline (audit/eval only).
 * Reuses production OpenCC t→cn (opencc-js/t2cn) + existing dialog200 punctuation/whitespace norm.
 * Does NOT enter Electron runtime / ASR / FW / Model3 / etc.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const OUT = __dirname;
const RUN_ID = 'dialog200_full_pipeline_20260909_001141';
const require = createRequire(path.join(ELECTRON, 'package.json'));
const OpenCC = require('opencc-js/t2cn');
const convert = OpenCC.Converter({ from: 't', to: 'cn' });

/** Same punctuation/whitespace strip as dialog200-path-trace-analyze.mjs `norm`. */
function stripPunctWsCase(s) {
  return String(s || '')
    .replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '')
    .toLowerCase();
}

/**
 * Offline-only: NFKC + OpenCC t→cn + punctuation/whitespace/case strip.
 * Symmetric for RAW / FINAL / REFERENCE. No synonym/homophone equivalence.
 */
export function normalizeForAsrRepairEvaluation(text) {
  const nfkc = String(text ?? '').normalize('NFKC');
  const simplified = convert(nfkc);
  return stripPunctWsCase(simplified);
}

function levenshtein(a, b) {
  a = a || '';
  b = b || '';
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function cer(ref, hyp) {
  if (!ref) return hyp ? 1 : 0;
  return levenshtein(ref, hyp) / ref.length;
}

function classifyNormalizedOutcome(rawN, finalN, refN) {
  const rawD = levenshtein(rawN, refN);
  const finalD = levenshtein(finalN, refN);
  if (rawN === refN) return { outcome: 'ALREADY_CORRECT_NORMALIZED', rawD, finalD };
  if (finalN === refN) return { outcome: 'ASR_REPAIR_FULL_RESCUE', rawD, finalD };
  if (finalD < rawD) return { outcome: 'ASR_REPAIR_PARTIAL_IMPROVEMENT', rawD, finalD };
  if (finalD > rawD) return { outcome: 'ASR_REPAIR_REGRESSED', rawD, finalD };
  return { outcome: 'ASR_REPAIR_UNCHANGED', rawD, finalD };
}

/** User-visible Baseline V1 space: punctuation/whitespace strip only (NO OpenCC). */
function originalOutcome(raw, final, ref) {
  const r = stripPunctWsCase(raw);
  const f = stripPunctWsCase(final);
  const e = stripPunctWsCase(ref);
  const rawOk = r === e;
  const finalOk = f === e;
  const dr = levenshtein(r, e);
  const df = levenshtein(f, e);
  if (rawOk && finalOk) return 'CORRECT_PRESERVED';
  if (rawOk && !finalOk) return 'CORRECT_BROKEN';
  if (!rawOk && finalOk) return 'FULL_RESCUE';
  if (df < dr) return 'PARTIAL_IMPROVEMENT';
  if (df > dr) return 'REGRESSION';
  return 'UNCHANGED';
}

function runSyntheticTests() {
  const cases = [
    {
      name: 'script_only',
      raw: '我想開通短信提醒',
      final: '我想开通短信提醒',
      ref: '我想开通短信提醒',
      expect: 'ALREADY_CORRECT_NORMALIZED',
    },
    {
      name: 'real_repair',
      raw: '我要中贝',
      final: '我要中杯',
      ref: '我要中杯',
      expect: 'ASR_REPAIR_FULL_RESCUE',
    },
    {
      name: 'partial_real_repair',
      raw: '中贝蓝没马分',
      final: '中杯蓝没马分',
      ref: '中杯蓝莓马芬',
      expect: 'ASR_REPAIR_PARTIAL_IMPROVEMENT',
    },
    {
      name: 'regression_hidden_by_script',
      raw: '我想開通中貝',
      final: '我想开中没',
      ref: '我想开通中杯',
      expect: 'ASR_REPAIR_REGRESSED',
    },
  ];
  const failures = [];
  for (const c of cases) {
    const rawN = normalizeForAsrRepairEvaluation(c.raw);
    const finalN = normalizeForAsrRepairEvaluation(c.final);
    const refN = normalizeForAsrRepairEvaluation(c.ref);
    const { outcome: got } = classifyNormalizedOutcome(rawN, finalN, refN);
    if (got !== c.expect) {
      failures.push({ name: c.name, expect: c.expect, got, rawN, finalN, refN });
    }
  }
  if (normalizeForAsrRepairEvaluation('中贝') === normalizeForAsrRepairEvaluation('中杯')) {
    failures.push({ name: 'homophone_not_collapsed', expect: 'distinct', got: 'same' });
  }
  return failures;
}

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function writeCsv(file, rows) {
  if (!rows.length) {
    fs.writeFileSync(file, '', 'utf8');
    return;
  }
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const body = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join(
    '\n'
  );
  fs.writeFileSync(file, '\ufeff' + body + '\n', 'utf8');
}

function buildReport(s, matrixRows) {
  const matrixMd = matrixRows
    .map((r) => `| ${r.original_outcome} | ${r.normalized_repair_outcome} | ${r.count} |`)
    .join('\n');
  const partialStill =
    matrixRows.find(
      (r) =>
        r.original_outcome === 'PARTIAL_IMPROVEMENT' &&
        r.normalized_repair_outcome === 'ASR_REPAIR_PARTIAL_IMPROVEMENT'
    )?.count ?? 0;
  return `# ASR Repair Quality Normalized Baseline Audit

Generated: 2026-09-10  
Phase: \`ASR_REPAIR_QUALITY_NORMALIZED_BASELINE_AUDIT\`  
Mode: READ_ONLY / OFFLINE  
RUN_ID: \`${s.runId}\`

## Verdict

\`${s.verdict}\`

## Two baselines (both kept)

| Baseline | Meaning | Status |
|----------|---------|--------|
| \`LINGUA_DIALOG200_BASELINE_V1\` | USER_VISIBLE end-to-end text quality | **FROZEN** (25→31, +6) |
| \`LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1\` | ASR **content** repair after script/punct/ws norm | **NEW** |

\`\`\`text
LINGUA_DIALOG200_BASELINE_V1 = USER_VISIBLE_END_TO_END_BASELINE
LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1 = CONTENT_REPAIR_BASELINE
\`\`\`

## Normalization (offline only)

\`\`\`text
NFKC → OpenCC t→cn (opencc-js/t2cn, same as FW normalizeForFwRepairInput)
→ punctuation/whitespace strip (dialog200 norm)
→ Latin lowercase
\`\`\`

Symmetric on RAW/FINAL/REFERENCE. No synonym/homophone equivalence.  
**Not wired into production runtime** (audit tooling under \`docs/user_correction/model3/\` only).

Synthetic tests: **PASS**

## Normalized metrics (200 / 200)

| Metric | Value |
|--------|------:|
| RAW_NORMALIZED_CORRECT | **${s.RAW_NORMALIZED_CORRECT}** |
| FINAL_NORMALIZED_CORRECT | **${s.FINAL_NORMALIZED_CORRECT}** |
| NORMALIZED_NET_CORRECT_GAIN | **${s.NORMALIZED_NET_CORRECT_GAIN}** |
| RAW_NORMALIZED_CER | **${s.RAW_NORMALIZED_CER}** |
| FINAL_NORMALIZED_CER | **${s.FINAL_NORMALIZED_CER}** |
| NORMALIZED_CER_DELTA | **${s.NORMALIZED_CER_DELTA}** |
| ALREADY_CORRECT_NORMALIZED | ${s.ALREADY_CORRECT_NORMALIZED} |
| ASR_REPAIR_FULL_RESCUE | **${s.ASR_REPAIR_FULL_RESCUE}** |
| ASR_REPAIR_PARTIAL_IMPROVEMENT | **${s.ASR_REPAIR_PARTIAL_IMPROVEMENT}** |
| ASR_REPAIR_UNCHANGED | ${s.ASR_REPAIR_UNCHANGED} |
| ASR_REPAIR_REGRESSED | **${s.ASR_REPAIR_REGRESSED}** |
| NORMALIZATION_CHANGED (surface-only raw→final) | ${s.NORMALIZATION_CHANGED_CASES} |
| cases_with_raw_script_difference | ${s.cases_with_raw_script_difference} |
| cases_with_final_script_change | ${s.cases_with_final_script_change} |

REGRESSED_CASE_IDS: ${s.REGRESSED_CASE_IDS.length ? s.REGRESSED_CASE_IDS.join(', ') : '(none)'}

## Reinterpretation of V1 outcomes

| | Count |
|--|------:|
| Original FULL_RESCUE | ${s.ORIGINAL_FULL_RESCUE_COUNT} |
| → reclassified ALREADY_CORRECT_NORMALIZED | **${s.FULL_RESCUE_RECLASSIFIED_AS_ALREADY_CORRECT}** |
| Original PARTIAL_IMPROVEMENT | ${s.ORIGINAL_PARTIAL_IMPROVEMENT_COUNT} |
| → still ASR_REPAIR_PARTIAL_IMPROVEMENT | **${partialStill}** |
| → reclassified ASR_REPAIR_UNCHANGED | **${s.PARTIAL_RECLASSIFIED_AS_UNCHANGED}** |
| Original improved (FULL+PARTIAL) | ${s.original_improved_cases} |
| Normalized ASR repair improved (FULL+PARTIAL) | **${s.normalized_asr_repair_improved_cases}** |
| Improvements removed by normalization calibration | **${s.improvements_removed_by_normalization}** |

## Original vs Normalized matrix

| original_outcome | normalized_repair_outcome | count |
|---|---|---:|
${matrixMd}

## Required answers

| # | Answer |
|---|--------|
| A | Of V1 exact +6: **${s.ASR_REPAIR_FULL_RESCUE}** are true ASR content full rescues; **${s.FULL_RESCUE_RECLASSIFIED_AS_ALREADY_CORRECT}/${s.ORIGINAL_FULL_RESCUE_COUNT}** FULL_RESCUE were already correct after script norm. \`NORMALIZED_NET_CORRECT_GAIN\` = **${s.NORMALIZED_NET_CORRECT_GAIN}** |
| B | **${s.FULL_RESCUE_RECLASSIFIED_AS_ALREADY_CORRECT}/${s.ORIGINAL_FULL_RESCUE_COUNT}** already correct in normalized space |
| C | Still true ASR_REPAIR_PARTIAL among original PARTIAL: **${partialStill}** |
| D | PARTIAL that are normalization-only (→ UNCHANGED): **${s.PARTIAL_RECLASSIFIED_AS_UNCHANGED}** |
| E | Normalized regressions: **${s.ASR_REPAIR_REGRESSED}** — IDs listed above |
| F | RAW_NORMALIZED_CORRECT = **${s.RAW_NORMALIZED_CORRECT}** |
| G | FINAL_NORMALIZED_CORRECT = **${s.FINAL_NORMALIZED_CORRECT}** |
| H | NORMALIZED_NET_CORRECT_GAIN = **${s.NORMALIZED_NET_CORRECT_GAIN}** |
| I | CER ${s.RAW_NORMALIZED_CER} → ${s.FINAL_NORMALIZED_CER} (Δ ${s.NORMALIZED_CER_DELTA}) |
| J | User-visible +6 remains real as presentation quality. True lexical/phonetic exact rescue gain is **${s.NORMALIZED_NET_CORRECT_GAIN}**; partial content distance improvement remains **${s.ASR_REPAIR_PARTIAL_IMPROVEMENT}** cases; **${s.ASR_REPAIR_REGRESSED}** content regressions were masked in V1 |
| K | MULTI_ERROR **not** next: only ${s.ASR_REPAIR_PARTIAL_IMPROVEMENT} true content partials remain. Suggested: \`${s.suggested_next_audit}\` |
| L | ONE next: \`${s.suggested_next_audit}\` |

## Suggested (not frozen) normalized gates

\`\`\`text
ASR_REPAIR_FULL_RESCUE >= ${s.ASR_REPAIR_FULL_RESCUE}
ASR_REPAIR_PARTIAL_IMPROVEMENT >= ${s.ASR_REPAIR_PARTIAL_IMPROVEMENT}
ASR_REPAIR_REGRESSED <= ${s.ASR_REPAIR_REGRESSED}
NORMALIZED_NET_CORRECT_GAIN >= ${s.NORMALIZED_NET_CORRECT_GAIN}
FINAL_NORMALIZED_CER <= ${s.FINAL_NORMALIZED_CER}
\`\`\`

Do **not** replace V1 gates yet. Dual acceptance later.

## Freeze

\`\`\`text
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
FULL_MAINLINE = KEEP FROZEN
LINGUA_DIALOG200_BASELINE_V1 = KEEP FROZEN
\`\`\`

This phase is evaluation calibration only.
`;
}

function main() {
  const synthFail = runSyntheticTests();
  if (synthFail.length) {
    console.error('SYNTHETIC_TEST_FAIL', JSON.stringify(synthFail, null, 2));
    process.exit(2);
  }

  const jsonl = path.join(OUT, `fresh_dialog200_raw_cases_${RUN_ID}.jsonl`);
  const cases = fs
    .readFileSync(jsonl, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((o) => o.caseId && o.reference != null && !o.error);

  if (cases.length !== 200) {
    console.error(`EXPECTED_200_GOT_${cases.length}`);
    process.exit(3);
  }

  const outRows = [];
  const matrix = new Map();
  const counts = {
    ALREADY_CORRECT_NORMALIZED: 0,
    ASR_REPAIR_FULL_RESCUE: 0,
    ASR_REPAIR_PARTIAL_IMPROVEMENT: 0,
    ASR_REPAIR_UNCHANGED: 0,
    ASR_REPAIR_REGRESSED: 0,
  };
  let normalizationChanged = 0;
  let casesWithRawScriptDiff = 0;
  let casesWithFinalScriptChange = 0;
  let rawNormCorrect = 0;
  let finalNormCorrect = 0;
  let rawUserVisibleCorrect = 0;
  let finalUserVisibleCorrect = 0;
  const rawCers = [];
  const finalCers = [];
  const regressedIds = [];
  let originalFull = 0;
  let originalPartial = 0;
  let fullRescueReclassAlready = 0;
  let partialReclassUnchanged = 0;
  let originalImproved = 0;
  let normalizedImproved = 0;
  let improvementsRemovedByNorm = 0;

  for (const rec of cases) {
    const cid = rec.caseId;
    const raw = rec.rawMergedAsrText ?? '';
    const final = rec.finalPostprocessText ?? '';
    const ref = rec.reference ?? '';
    const origOutcome = originalOutcome(raw, final, ref);
    if (stripPunctWsCase(raw) === stripPunctWsCase(ref)) rawUserVisibleCorrect += 1;
    if (stripPunctWsCase(final) === stripPunctWsCase(ref)) finalUserVisibleCorrect += 1;
    if (origOutcome === 'FULL_RESCUE') originalFull += 1;
    if (origOutcome === 'PARTIAL_IMPROVEMENT') originalPartial += 1;
    if (origOutcome === 'FULL_RESCUE' || origOutcome === 'PARTIAL_IMPROVEMENT') {
      originalImproved += 1;
    }

    const rawN = normalizeForAsrRepairEvaluation(raw);
    const finalN = normalizeForAsrRepairEvaluation(final);
    const refN = normalizeForAsrRepairEvaluation(ref);
    const { outcome, rawD, finalD } = classifyNormalizedOutcome(rawN, finalN, refN);
    const rawOk = rawN === refN;
    const finalOk = finalN === refN;

    counts[outcome] += 1;
    if (rawOk) rawNormCorrect += 1;
    if (finalOk) finalNormCorrect += 1;
    rawCers.push(cer(refN, rawN));
    finalCers.push(cer(refN, finalN));

    const originalsDiffer = raw !== final;
    const normEqual = rawN === finalN;
    const surfaceOnlyNorm = originalsDiffer && normEqual;
    if (surfaceOnlyNorm) normalizationChanged += 1;

    const rawStrip = stripPunctWsCase(String(raw).normalize('NFKC'));
    if (rawStrip !== rawN) casesWithRawScriptDiff += 1;
    if (surfaceOnlyNorm) casesWithFinalScriptChange += 1;

    if (outcome === 'ASR_REPAIR_REGRESSED') regressedIds.push(cid);
    if (origOutcome === 'FULL_RESCUE' && outcome === 'ALREADY_CORRECT_NORMALIZED') {
      fullRescueReclassAlready += 1;
    }
    if (origOutcome === 'PARTIAL_IMPROVEMENT' && outcome === 'ASR_REPAIR_UNCHANGED') {
      partialReclassUnchanged += 1;
    }
    if (
      outcome === 'ASR_REPAIR_FULL_RESCUE' ||
      outcome === 'ASR_REPAIR_PARTIAL_IMPROVEMENT'
    ) {
      normalizedImproved += 1;
    }
    if (
      (origOutcome === 'FULL_RESCUE' || origOutcome === 'PARTIAL_IMPROVEMENT') &&
      !(
        outcome === 'ASR_REPAIR_FULL_RESCUE' ||
        outcome === 'ASR_REPAIR_PARTIAL_IMPROVEMENT'
      )
    ) {
      improvementsRemovedByNorm += 1;
    }

    const key = `${origOutcome}|${outcome}`;
    matrix.set(key, (matrix.get(key) || 0) + 1);

    outRows.push({
      caseId: cid,
      raw_original: raw,
      final_original: final,
      reference_original: ref,
      raw_normalized: rawN,
      final_normalized: finalN,
      reference_normalized: refN,
      raw_normalized_distance: rawD,
      final_normalized_distance: finalD,
      raw_normalized_correct: rawOk ? 'YES' : 'NO',
      final_normalized_correct: finalOk ? 'YES' : 'NO',
      normalization_changed_raw_to_final: surfaceOnlyNorm ? 'YES' : 'NO',
      original_outcome: origOutcome,
      normalized_repair_outcome: outcome,
    });
  }

  if (rawUserVisibleCorrect !== 25 || finalUserVisibleCorrect !== 31) {
    console.warn(
      `WARN_USER_VISIBLE_MISMATCH raw=${rawUserVisibleCorrect} final=${finalUserVisibleCorrect} expected 25/31`
    );
  }
  if (originalFull !== 6 || originalPartial !== 60) {
    console.warn(
      `WARN_OUTCOME_MISMATCH full=${originalFull} partial=${originalPartial} expected 6/60`
    );
  }

  const summary = {
    baselineId: 'LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1',
    companionUserVisibleBaseline: 'LINGUA_DIALOG200_BASELINE_V1',
    runId: RUN_ID,
    TOTAL_CASES: outRows.length,
    user_visible_sanity: {
      RAW_CORRECT: rawUserVisibleCorrect,
      FINAL_CORRECT: finalUserVisibleCorrect,
    },
    normalization: {
      traditionalToSimplified: 'opencc-js/t2cn (same as FW normalizeForFwRepairInput)',
      punctuationWhitespace: 'dialog200-path-trace-analyze.mjs norm',
      latinLowercase: true,
      location: 'offline audit tooling only',
    },
    RAW_NORMALIZED_CORRECT: rawNormCorrect,
    FINAL_NORMALIZED_CORRECT: finalNormCorrect,
    NORMALIZED_NET_CORRECT_GAIN: finalNormCorrect - rawNormCorrect,
    RAW_NORMALIZED_CER: Number(mean(rawCers).toFixed(4)),
    FINAL_NORMALIZED_CER: Number(mean(finalCers).toFixed(4)),
    NORMALIZED_CER_DELTA: Number((mean(finalCers) - mean(rawCers)).toFixed(4)),
    ALREADY_CORRECT_NORMALIZED: counts.ALREADY_CORRECT_NORMALIZED,
    ASR_REPAIR_FULL_RESCUE: counts.ASR_REPAIR_FULL_RESCUE,
    ASR_REPAIR_PARTIAL_IMPROVEMENT: counts.ASR_REPAIR_PARTIAL_IMPROVEMENT,
    ASR_REPAIR_UNCHANGED: counts.ASR_REPAIR_UNCHANGED,
    ASR_REPAIR_REGRESSED: counts.ASR_REPAIR_REGRESSED,
    NORMALIZATION_CHANGED_CASES: normalizationChanged,
    ORIGINAL_FULL_RESCUE_COUNT: originalFull,
    ORIGINAL_PARTIAL_IMPROVEMENT_COUNT: originalPartial,
    FULL_RESCUE_RECLASSIFIED_AS_ALREADY_CORRECT: fullRescueReclassAlready,
    PARTIAL_RECLASSIFIED_AS_UNCHANGED: partialReclassUnchanged,
    cases_with_raw_script_difference: casesWithRawScriptDiff,
    cases_with_final_script_change: casesWithFinalScriptChange,
    original_improved_cases: originalImproved,
    normalized_asr_repair_improved_cases: normalizedImproved,
    improvements_removed_by_normalization: improvementsRemovedByNorm,
    REGRESSED_CASE_IDS: regressedIds,
    synthetic_tests: 'PASS',
    MODEL3_FROZEN: true,
    RETRY_ARCHITECTURE_FROZEN: true,
    BASELINE_V1_FROZEN: true,
    suggested_next_audit:
      counts.ASR_REPAIR_PARTIAL_IMPROVEMENT >= 20
        ? 'MULTI_ERROR_REPAIR_COVERAGE_TARGETED_AUDIT'
        : counts.ASR_REPAIR_FULL_RESCUE + counts.ASR_REPAIR_PARTIAL_IMPROVEMENT < 10
          ? 'ACTUAL_ASR_REPAIR_SUCCESS_FAILURE_TARGETED_AUDIT'
          : 'ACTUAL_ASR_REPAIR_SUCCESS_FAILURE_TARGETED_AUDIT',
    verdict:
      fullRescueReclassAlready >= 5 || improvementsRemovedByNorm >= 30
        ? 'ASR_REPAIR_NORMALIZED_BASELINE_PASS_MAJOR_REINTERPRETATION'
        : 'ASR_REPAIR_NORMALIZED_BASELINE_PASS',
  };

  // Spec §31: if true repair improvement is scarce, prefer success/failure audit over multi-error
  if (
    summary.ASR_REPAIR_FULL_RESCUE === 0 &&
    summary.NORMALIZED_NET_CORRECT_GAIN === 0 &&
    summary.ASR_REPAIR_PARTIAL_IMPROVEMENT < 20
  ) {
    summary.suggested_next_audit = 'ACTUAL_ASR_REPAIR_SUCCESS_FAILURE_TARGETED_AUDIT';
  } else if (summary.ASR_REPAIR_PARTIAL_IMPROVEMENT >= 20) {
    summary.suggested_next_audit = 'MULTI_ERROR_REPAIR_COVERAGE_TARGETED_AUDIT';
  } else if (summary.ASR_REPAIR_FULL_RESCUE + summary.ASR_REPAIR_PARTIAL_IMPROVEMENT < 10) {
    summary.suggested_next_audit = 'ACTUAL_ASR_REPAIR_SUCCESS_FAILURE_TARGETED_AUDIT';
  }

  writeCsv(path.join(OUT, 'ASR_Repair_Normalized_Case_Results.csv'), outRows);
  const matrixRows = [...matrix.entries()]
    .map(([k, count]) => {
      const [original_outcome, normalized_repair_outcome] = k.split('|');
      return { original_outcome, normalized_repair_outcome, count };
    })
    .sort((a, b) => b.count - a.count);
  writeCsv(path.join(OUT, 'Original_vs_Normalized_Outcome_Matrix.csv'), matrixRows);
  fs.writeFileSync(
    path.join(OUT, 'ASR_Repair_Normalized_Baseline_V1.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUT, 'ASR_Repair_Quality_Normalized_Baseline_Audit.md'),
    buildReport(summary, matrixRows),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        verdict: summary.verdict,
        user_visible: summary.user_visible_sanity,
        RAW_N: summary.RAW_NORMALIZED_CORRECT,
        FINAL_N: summary.FINAL_NORMALIZED_CORRECT,
        NET_N: summary.NORMALIZED_NET_CORRECT_GAIN,
        CER: [summary.RAW_NORMALIZED_CER, summary.FINAL_NORMALIZED_CER, summary.NORMALIZED_CER_DELTA],
        FULL_RESCUE_REAL: summary.ASR_REPAIR_FULL_RESCUE,
        PARTIAL_REAL: summary.ASR_REPAIR_PARTIAL_IMPROVEMENT,
        UNCHANGED: summary.ASR_REPAIR_UNCHANGED,
        REGRESSED: summary.ASR_REPAIR_REGRESSED,
        REGRESSED_IDS: summary.REGRESSED_CASE_IDS,
        ORIG_FULL: summary.ORIGINAL_FULL_RESCUE_COUNT,
        ORIG_PARTIAL: summary.ORIGINAL_PARTIAL_IMPROVEMENT_COUNT,
        RECLASS_FULL: summary.FULL_RESCUE_RECLASSIFIED_AS_ALREADY_CORRECT,
        RECLASS_PARTIAL_UNCHANGED: summary.PARTIAL_RECLASSIFIED_AS_UNCHANGED,
        NEXT: summary.suggested_next_audit,
      },
      null,
      2
    )
  );
}

main();
