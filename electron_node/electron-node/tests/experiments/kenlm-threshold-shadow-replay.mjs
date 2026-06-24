#!/usr/bin/env node
/**
 * Read-only KenLM threshold shadow replay on frozen Dialog200 batch diagnostics.
 * Re-simulates pick + apply from stored span/rerank data — no prod config/code changes.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BATCH_PATH = path.resolve(__dirname, '../lexicon-expansion-v1_1-dialog200-batch-result.json');
const QUALITY_PATH = path.resolve(__dirname, '../lexicon-expansion-v1_1-dialog200-quality-perf.json');
const MANIFEST_PATH = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');
const OUT_JSON = path.join(__dirname, 'kenlm-threshold-shadow-replay-results.json');

const V4_LIMITS = { maxIntervalEnumNodes: 1024, maxIntervalRepairPicksPerPath: 16 };

function rawOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function applyReplacementsRightToLeft(rawText, picks) {
  const sorted = [...picks].sort((a, b) => b.start - a.start);
  let text = rawText;
  for (const p of sorted) {
    text = text.slice(0, p.start) + p.word + text.slice(p.end);
  }
  return text;
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push(cur);
  }
  return merged;
}

function gapRangesInCoarseSpan(spanStart, spanEnd, repairPicks) {
  const clipped = repairPicks
    .map((pick) => ({
      start: Math.max(pick.span.start, spanStart),
      end: Math.min(pick.span.end, spanEnd),
    }))
    .filter((x) => x.start < x.end);
  const merged = mergeIntervals(clipped);
  const gaps = [];
  let cursor = spanStart;
  for (const covered of merged) {
    if (cursor < covered.start) gaps.push({ start: cursor, end: covered.start });
    cursor = Math.max(cursor, covered.end);
  }
  if (cursor < spanEnd) gaps.push({ start: cursor, end: spanEnd });
  return gaps;
}

function buildGapCanonicalPicks(rawText, coarseRanges, repairPicks) {
  const gaps = [];
  for (const coarse of coarseRanges) {
    if (coarse.start >= coarse.end) continue;
    for (const gap of gapRangesInCoarseSpan(coarse.start, coarse.end, repairPicks)) {
      const text = rawText.slice(gap.start, gap.end);
      gaps.push({
        span: { text, start: gap.start, end: gap.end },
        word: text,
        source: 'canonical_exact',
        priorScore: 0,
        repairTarget: false,
        candidateScore: 0,
      });
    }
  }
  return gaps;
}

function pickOverlapsAny(candidate, chosen) {
  for (const other of chosen) {
    if (rawOverlap(candidate.span.start, candidate.span.end, other.span.start, other.span.end)) {
      return true;
    }
  }
  return false;
}

function allNonOverlapSubsets(picks, rejectedOverlap) {
  const subsets = [[]];
  function extend(start, current) {
    for (let i = start; i < picks.length; i++) {
      const pick = picks[i];
      if (pickOverlapsAny(pick, current)) {
        rejectedOverlap.count += 1;
        continue;
      }
      const next = [...current, pick];
      subsets.push(next);
      extend(i + 1, next);
    }
  }
  extend(0, []);
  return subsets;
}

function enumerateIntervalPaths(spanSets, coarseRanges, rawText) {
  const paths = [];
  let enumNodes = 0;
  let rejectedOverlap = 0;
  let capped = false;

  function visitSlot(slotIndex, chosen) {
    enumNodes += 1;
    if (enumNodes > V4_LIMITS.maxIntervalEnumNodes) {
      capped = true;
      return;
    }
    if (slotIndex >= spanSets.length) {
      if (chosen.length <= V4_LIMITS.maxIntervalRepairPicksPerPath) {
        const gapPicks = buildGapCanonicalPicks(rawText, coarseRanges, chosen);
        paths.push([...chosen, ...gapPicks]);
      }
      return;
    }
    const slotRepairs = spanSets[slotIndex].filter((p) => p.repairTarget);
    const rejectCounter = { count: 0 };
    const subsets = allNonOverlapSubsets(slotRepairs, rejectCounter);
    rejectedOverlap += rejectCounter.count;
    for (const subset of subsets) {
      if (chosen.length + subset.length > V4_LIMITS.maxIntervalRepairPicksPerPath) continue;
      let overlapsPrior = false;
      for (const pick of subset) {
        if (pickOverlapsAny(pick, chosen)) {
          overlapsPrior = true;
          rejectedOverlap += 1;
          break;
        }
      }
      if (overlapsPrior) continue;
      visitSlot(slotIndex + 1, [...chosen, ...subset]);
      if (capped) return;
    }
  }

  visitSlot(0, []);
  return { paths, rejectedOverlap, capped };
}

function buildSentenceCandidates(rawText, spanSets, maxSentenceCandidates, coarseRanges) {
  if (!spanSets.length || maxSentenceCandidates <= 0) return [];
  const { paths } = enumerateIntervalPaths(spanSets, coarseRanges, rawText);
  const scored = paths.map((picks) => {
    const repairOnly = picks.filter((p) => p.repairTarget);
    const text = applyReplacementsRightToLeft(
      rawText,
      repairOnly.map((p) => ({ start: p.span.start, end: p.span.end, word: p.word }))
    );
    const candidateScore = repairOnly.reduce((s, p) => s + p.candidateScore, 0);
    return { text, replacements: picks, candidateScore, repairCount: repairOnly.length };
  });
  scored.sort((a, b) => b.candidateScore - a.candidateScore);
  const uniqueByText = new Map();
  for (const combo of scored) {
    if (!uniqueByText.has(combo.text)) uniqueByText.set(combo.text, combo);
  }
  return [...uniqueByText.values()].slice(0, maxSentenceCandidates);
}

function mapSentenceToApproved(picked, requireRepairTarget) {
  const approved = [];
  for (const repl of picked.replacements) {
    if (!repl.repairTarget) continue;
    if (repl.word === repl.span.text) continue;
    if (requireRepairTarget && !repl.repairTarget) continue;
    approved.push({
      start: repl.span.start,
      end: repl.span.end,
      candidateText: repl.word,
    });
  }
  return approved;
}

function applyApproved(raw, approved) {
  if (!approved.length) return raw;
  return applyReplacementsRightToLeft(
    raw,
    approved.map((r) => ({ start: r.start, end: r.end, word: r.candidateText }))
  );
}

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function cer(ref, hyp) {
  const r = norm(ref);
  const h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  const m = r.length;
  const n = h.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        r[i - 1] === h[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n] / r.length;
}

function exactMatch(ref, hyp) {
  return norm(ref) === norm(hyp);
}

function spanSetsFromBatch(spans) {
  return spans.map((span) =>
    (span.candidates || []).map((c) => ({
      span: { text: span.text, start: span.start, end: span.end },
      word: c.word,
      source: c.source || 'lexicon_pinyin_topk',
      priorScore: c.priorScore ?? 0,
      repairTarget: c.repairTarget !== false,
      candidateScore: c.candidateScore ?? c.priorScore ?? 0,
    }))
  );
}

function rebuildCombinations(rawText, spans, maxSentenceCandidates) {
  const spanSets = spanSetsFromBatch(spans);
  const coarseRanges = spans.map((s) => ({ start: s.start, end: s.end }));
  return buildSentenceCandidates(rawText, spanSets, maxSentenceCandidates, coarseRanges);
}

function pickIndexForMaxDelta(deltas, maxDelta) {
  if (!deltas?.length) return -1;
  let best = -1;
  let bestD = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < deltas.length; i++) {
    if (deltas[i] > bestD) {
      bestD = deltas[i];
      best = i;
    }
  }
  return Math.abs(bestD - maxDelta) <= 1e-4 ? best : -1;
}

function shadowFinalForCase(c, threshold) {
  const fw = c.extra?.fw_detector;
  const sr = fw?.sentenceRerank;
  const raw = (c.raw_asr_preview || c.extra?.raw_asr_text || '').trim();
  const actualFinal = (c.text_asr_preview || '').trim();
  const maxDelta = sr?.maxDelta ?? 0;
  const comboCount = sr?.combinationCount ?? 0;
  const deltas = sr?.allCombinationDeltas;
  const maxSentenceCandidates = fw?.configSnapshot?.maxSentenceCandidates ?? 16;
  const requireRepairTarget = fw?.configSnapshot?.candidateRequireRepairTarget !== false;

  if (!comboCount || comboCount <= 1 || !deltas?.length) {
    return { raw, final: raw, picked: false, appliedCount: 0, maxDelta, reason: 'no_combinations', repairCount: 0 };
  }
  if (maxDelta < threshold) {
    return { raw, final: raw, picked: false, appliedCount: 0, maxDelta, reason: 'below_threshold', repairCount: 0 };
  }
  // Cases already applied at production gate (t=3) keep observed final for all lower thresholds.
  if ((c.fw_applied_count || 0) > 0 && sr?.pickedIsRaw === false && maxDelta >= 3) {
    return {
      raw,
      final: actualFinal,
      picked: true,
      appliedCount: c.fw_applied_count || 0,
      maxDelta,
      reason: 'production_applied',
      repairCount: c.fw_applied_count || 0,
    };
  }

  const combinations = rebuildCombinations(raw, fw.spans || [], maxSentenceCandidates);
  const idx = pickIndexForMaxDelta(deltas, maxDelta);
  if (idx < 0 || idx >= combinations.length) {
    return {
      raw,
      final: raw,
      picked: false,
      appliedCount: 0,
      maxDelta,
      reason: 'rebuild_index_mismatch',
      rebuiltCount: combinations.length,
      repairCount: 0,
    };
  }

  const combo = combinations[idx];
  const approved = mapSentenceToApproved(combo, requireRepairTarget);
  const final = approved.length ? applyApproved(raw, approved) : raw;
  const repairCount = approved.length;

  return {
    raw,
    final,
    picked: approved.length > 0,
    appliedCount: repairCount,
    maxDelta,
    reason: approved.length ? 'shadow_rebuilt' : 'picked_empty_approved',
    comboText: combo.text,
    repairCount,
  };
}

function evaluateThreshold(cases, refById, threshold) {
  const perCase = [];
  let improved = 0;
  let degraded = 0;
  let unchanged = 0;
  let exact = 0;
  let applyCases = 0;
  const cerFinals = [];
  const cerRaws = [];

  for (const c of cases) {
    const ref = refById[c.id] || '';
    const raw = (c.raw_asr_preview || '').trim();
    const shadow = shadowFinalForCase(c, threshold);
    const rawCer = cer(ref, raw);
    const finalCer = cer(ref, shadow.final);
    cerRaws.push(rawCer);
    cerFinals.push(finalCer);
    if (exactMatch(ref, shadow.final)) exact++;
    if (shadow.appliedCount > 0) applyCases++;
    const delta = finalCer - rawCer;
    if (delta < -0.0001) improved++;
    else if (delta > 0.0001) degraded++;
    else unchanged++;
    perCase.push({
      id: c.id,
      scenario: c.scenario,
      threshold,
      maxDelta: shadow.maxDelta,
      picked: shadow.picked,
      appliedCount: shadow.appliedCount,
      repairCount: shadow.repairCount,
      rawCer,
      finalCer,
      cerDelta: delta,
      raw: shadow.raw,
      final: shadow.final,
      reason: shadow.reason,
      comboText: shadow.comboText,
      productionApplied: c.fw_applied_count || 0,
    });
  }

  return {
    threshold,
    cer: {
      avg_raw: cerRaws.reduce((s, v) => s + v, 0) / cerRaws.length,
      avg_final: cerFinals.reduce((s, v) => s + v, 0) / cerFinals.length,
    },
    exact_match: exact,
    improved,
    degraded,
    unchanged,
    apply_cases: applyCases,
    perCase,
  };
}

function main() {
  const batchRaw = fs.readFileSync(BATCH_PATH);
  const batch = JSON.parse(batchRaw.toString());
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const quality = JSON.parse(fs.readFileSync(QUALITY_PATH, 'utf8'));
  const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));
  const cases = batch.cases.filter((c) => !c.skip);

  let rebuildOk = 0;
  let rebuildFail = 0;
  for (const c of cases) {
    const sr = c.extra?.fw_detector?.sentenceRerank;
    if (!sr?.allCombinationDeltas?.length) continue;
    const combos = rebuildCombinations(c.raw_asr_preview, c.extra.fw_detector.spans, 16);
    const idx = pickIndexForMaxDelta(sr.allCombinationDeltas, sr.maxDelta);
    if (idx >= 0 && idx < combos.length) rebuildOk++;
    else rebuildFail++;
  }

  const thresholds = [3, 2, 1];
  const results = Object.fromEntries(thresholds.map((t) => [t, evaluateThreshold(cases, refById, t)]));

  const baseline = results[3];
  const t2 = results[2];
  const t1 = results[1];

  const prodApplied = new Set(
    cases.filter((c) => (c.fw_applied_count || 0) > 0).map((c) => c.id)
  );

  function newRows(lower) {
    return lower.perCase.filter((x) => x.appliedCount > 0 && !prodApplied.has(x.id));
  }

  function newDegraded(lower) {
    return lower.perCase.filter((x) => {
      if (!prodApplied.has(x.id) && x.appliedCount > 0 && x.finalCer > x.rawCer + 0.0001) return true;
      return false;
    });
  }

  function newImproved(lower) {
    return lower.perCase.filter((x) => {
      if (!prodApplied.has(x.id) && x.appliedCount > 0 && x.finalCer < x.rawCer - 0.0001) return true;
      return false;
    });
  }

  const newApply2 = newRows(t2);
  const newApply1 = newRows(t1);
  const newDeg2 = newDegraded(t2);
  const newDeg1 = newDegraded(t1);
  const newImp2 = newImproved(t2);
  const newImp1 = newImproved(t1);

  const focusIds = ['d082', 'd007', 'd045', 'd180', 'd187'];
  const focus = Object.fromEntries(
    focusIds.map((id) => [
      id,
      Object.fromEntries(thresholds.map((t) => [t, results[t].perCase.find((x) => x.id === id)])),
    ])
  );

  const out = {
    meta: {
      audit: 'FW_Repair_V4_KenLM_Threshold_Shadow_Replay_Audit',
      timestamp: new Date().toISOString(),
      batchPath: BATCH_PATH,
      batchTimestamp: batch.timestamp,
      datasetChecksumSha256_16: crypto.createHash('sha256').update(batchRaw).digest('hex').slice(0, 16),
      manifestCount: manifest.length,
      rebuildValidation: { ok: rebuildOk, fail: rebuildFail, rate: rebuildOk / (rebuildOk + rebuildFail) },
    },
    environment: {
      scoreMode: 'raw_log_delta',
      productionThreshold: 3,
      batchConfig: batch.cases[0]?.extra?.fw_detector?.configSnapshot,
      lexiconBundle: batch.cases[0]?.extra?.fw_detector?.runtime?.bundleDir,
    },
    frozenBaseline: {
      fromQualityPerf: quality.quality,
      fromShadowT3: {
        avg_cer_final: Number(baseline.cer.avg_final.toFixed(4)),
        exact_match: baseline.exact_match,
        improved: baseline.improved,
        degraded: baseline.degraded,
        apply_cases: baseline.apply_cases,
      },
    },
    sweep: thresholds.map((t) => ({
      threshold: t,
      apply_cases: results[t].apply_cases,
      improved: results[t].improved,
      degraded: results[t].degraded,
      avg_cer_final: Number(results[t].cer.avg_final.toFixed(4)),
      exact_match: results[t].exact_match,
      vs_t3: {
        apply_delta: results[t].apply_cases - baseline.apply_cases,
        improved_delta: results[t].improved - baseline.improved,
        degraded_delta: results[t].degraded - baseline.degraded,
        cer_delta: Number((results[t].cer.avg_final - baseline.cer.avg_final).toFixed(4)),
        exact_delta: results[t].exact_match - baseline.exact_match,
      },
    })),
    newApply: {
      t2: newApply2.map((x) => ({
        id: x.id,
        threshold: 2,
        maxDelta: x.maxDelta,
        raw: x.raw,
        final: x.final,
        repairCount: x.repairCount,
      })),
      t1: newApply1.map((x) => ({
        id: x.id,
        threshold: 1,
        maxDelta: x.maxDelta,
        raw: x.raw,
        final: x.final,
        repairCount: x.repairCount,
      })),
    },
    newDegraded: {
      t2: newDeg2.map((x) => ({
        id: x.id,
        threshold: 2,
        rawCer: x.rawCer,
        finalCer: x.finalCer,
        cerChange: x.finalCer - x.rawCer,
        raw: x.raw,
        final: x.final,
      })),
      t1: newDeg1.map((x) => ({
        id: x.id,
        threshold: 1,
        rawCer: x.rawCer,
        finalCer: x.finalCer,
        cerChange: x.finalCer - x.rawCer,
        raw: x.raw,
        final: x.final,
      })),
    },
    newImproved: {
      t2_count: newImp2.length,
      t1_count: newImp1.length,
      t2_ids: newImp2.map((x) => x.id),
      t1_ids: newImp1.map((x) => x.id),
    },
    sensitivity: [
      {
        threshold: 2,
        new_apply: newApply2.length,
        new_improved: newImp2.length,
        new_degraded: newDeg2.length,
        gain_risk_ratio: newDeg2.length ? Number((newImp2.length / newDeg2.length).toFixed(2)) : null,
      },
      {
        threshold: 1,
        new_apply: newApply1.length,
        new_improved: newImp1.length,
        new_degraded: newDeg1.length,
        gain_risk_ratio: newDeg1.length ? Number((newImp1.length / newDeg1.length).toFixed(2)) : null,
      },
    ],
    focusCases: focus,
    singleSpanT1: t1.perCase.filter((x) => x.appliedCount > 0 && x.repairCount === 1).length,
    multiSpanT1: t1.perCase.filter((x) => x.appliedCount > 0 && x.repairCount > 1).length,
    singleSpanT3: baseline.perCase.filter((x) => x.appliedCount > 0 && x.repairCount === 1).length,
    multiSpanT3: baseline.perCase.filter((x) => x.appliedCount > 0 && x.repairCount > 1).length,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
}

main();
