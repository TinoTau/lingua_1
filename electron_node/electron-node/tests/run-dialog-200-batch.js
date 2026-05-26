#!/usr/bin/env node
/**
 * dialog_200 批量 pipeline 验收
 *
 * 用法：
 *   set PROJECT_ROOT=D:\Programs\github\lingua_1
 *   npm run start   # 节点 + test server 5020
 *   node tests/run-dialog-200-batch.js
 *   node tests/run-dialog-200-batch.js "D:\Programs\github\lingua_1\test wav\dialog_200"
 *   node tests/run-dialog-200-batch.js --limit 20
 */
const fs = require('fs');
const path = require('path');
const { assessContractPass } = require('./lib/recover-contract-assess');

const args = process.argv.slice(2);
let limit = null;
let dirArg = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i += 1;
  } else if (!a.startsWith('--')) {
    dirArg = a;
  }
}

const DIALOG_DIR = dirArg
  ? path.resolve(dirArg)
  : path.resolve(__dirname, '../../../test wav/dialog_200');

const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');

function getPort() {
  const cfgPath = path.join(process.env.APPDATA || '', 'lingua-electron-node', 'electron-node-config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.testServer?.port) return cfg.testServer.port;
    } catch (_) {}
  }
  return 5020;
}

async function waitHealth(port, maxMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function runWav(port, wavPath, sessionId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      srcLang: 'zh',
      tgtLang: 'en',
      use_lexicon: true,
      is_manual_cut: true,
      session_id: sessionId,
      lexicon_v2_intent_enabled: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function contractRow(caseDef, data) {
  const extra = data.extra || {};
  const repair = extra.sentence_repair || {};
  const lifecycle = extra.recover_lifecycle || {};
  const text = (data.text_asr || '').trim();
  const contract = assessContractPass(extra, data);
  const replacements = (repair.replacements || []).map((r) => ({
    from: r.from,
    to: r.to,
    hotwordId: r.hotwordId,
    phoneticScore: r.phoneticScore,
    source: r.source,
  }));
  const modified = repair.modified === true;
  const modifiedWithoutReplacement = modified && replacements.length === 0;
  const restoreMetrics = extra.restore_metrics ?? null;
  return {
    id: caseDef.id,
    scenario: caseDef.scenario,
    pass: contract.pass,
    contract_failures: contract.failures,
    text_asr_preview: text.slice(0, 80),
    recover_contract_version: extra.recover_contract_version,
    recover_lifecycle: lifecycle,
    lexicon_runtime_status: extra.lexicon_runtime_status,
    nbest_synthetic: extra.nbest_synthetic,
    segment_synthetic: extra.segment_synthetic,
    ctc_nbest_preserved: extra.ctc_nbest_preserved,
    aggregation_resync_reason: extra.aggregation_resync_reason,
    asr_service_id: extra.asr_service_id,
    asr_nbest_count: extra.asr_nbest_count ?? (extra.asr_nbest || []).length,
    ctc_nbest_lost:
      (extra.asr_nbest_count ?? (extra.asr_nbest || []).length) > 1 &&
      extra.ctc_nbest_preserved !== true,
    hypothesis_count: (extra.asr_hypotheses || []).length,
    recall_hypothesis_text: extra.recall_hypothesis_text,
    picked_hypothesis_rank: repair.pickedHypothesisRank ?? 0,
    candidate_source: repair.candidateSource ?? null,
    restore_metrics: restoreMetrics,
    picked_from_raw_ctc_nbest_count: restoreMetrics?.picked_from_raw_ctc_nbest_count ?? null,
    picked_from_phonetic_expansion_count: restoreMetrics?.picked_from_phonetic_expansion_count ?? null,
    phonetic_expanded_sentence_candidates_count:
      restoreMetrics?.phonetic_expanded_sentence_candidates_count ?? null,
    recover_skipped: extra.recover_skipped === true,
    repair_skip_reason: extra.repair_skip_reason ?? null,
    window_candidate_count: (extra.window_candidates || []).length,
    sentence_candidate_count: (extra.sentence_candidates || []).length,
    sentence_repair_executed: repair.executed === true,
    sentence_repair_modified: modified,
    sentence_repair_skip_reason: repair.skipReason ?? lifecycle.skipReason ?? null,
    modified_without_replacement: modifiedWithoutReplacement,
    contract_violation_modified_without_replacement: modifiedWithoutReplacement,
    replacements_applied: replacements.length > 0,
    replacements_count: replacements.length,
    replacements,
    kenlm_score: repair.kenlmScore,
    combined_score: repair.combinedScore,
    kenlm_timing: repair.kenlmTiming,
    rerank_ms: repair.rerankMs,
    pipeline_ms: extra.pipeline_ms,
    extra,
    error: null,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarizeAsrServiceId(rows) {
  const dist = {};
  for (const row of rows) {
    const id = row.asr_service_id || 'unknown';
    dist[id] = (dist[id] || 0) + 1;
  }
  return { asr_service_id_distribution: dist };
}

function summarizeCtcNbest(rows) {
  let available = 0;
  let preserved = 0;
  let lost = 0;
  let resyncSynthetic = 0;
  for (const row of rows) {
    if ((row.asr_nbest_count || 0) > 1) {
      available += 1;
    }
    if (row.ctc_nbest_preserved === true) {
      preserved += 1;
    }
    if (row.ctc_nbest_lost === true) {
      lost += 1;
    }
    if (row.aggregation_resync_reason === 'segment_mismatch_no_ctc_nbest') {
      resyncSynthetic += 1;
    }
  }
  return {
    ctc_nbest_available_count: available,
    ctc_nbest_preserved_count: preserved,
    ctc_nbest_lost_count: lost,
    aggregation_resync_synthetic_count: resyncSynthetic,
  };
}

function summarizeQualityMetrics(rows) {
  const noWindow = {};
  const pickedSrc = {};
  let withWindow = 0;
  let withWindowAndSentenceCandidate = 0;
  let expansionEmptyWithWindows = 0;
  const dropReasonTotals = {};
  for (const row of rows) {
    const d = row.extra?.window_recall_diagnostics;
    if (d?.noWindowBucket) {
      noWindow[d.noWindowBucket] = (noWindow[d.noWindowBucket] || 0) + 1;
    }
    const src = row.candidate_source;
    if (src) {
      pickedSrc[src] = (pickedSrc[src] || 0) + 1;
    }
    const wc = row.window_candidate_count || 0;
    const sc = row.sentence_candidate_count || 0;
    if (wc > 0) {
      withWindow += 1;
      if (sc > 0) {
        withWindowAndSentenceCandidate += 1;
      } else {
        expansionEmptyWithWindows += 1;
      }
    }
    const funnel = row.extra?.expansion_funnel;
    if (funnel?.dropReasonDistribution) {
      for (const [reason, n] of Object.entries(funnel.dropReasonDistribution)) {
        dropReasonTotals[reason] = (dropReasonTotals[reason] || 0) + n;
      }
    }
  }
  const sampleQuality = rows.find((r) => r.extra?.qualityConfig)?.extra?.qualityConfig;
  return {
    qualityConfig: sampleQuality ?? {
      recallMinPhoneticScore: 0.5,
      expansionMinPhoneticScore: 0.5,
      selectionMinPhoneticScore: 0.85,
      multiWindowScoreEpsilon: 0.005,
    },
    no_window_bucket_distribution: noWindow,
    picked_candidate_source_distribution: pickedSrc,
    with_window_count: withWindow,
    with_window_and_sentence_candidate_count: withWindowAndSentenceCandidate,
    with_window_sentence_candidate_rate:
      withWindow > 0 ? withWindowAndSentenceCandidate / withWindow : 0,
    expansion_empty_with_windows_count: expansionEmptyWithWindows,
    expansion_drop_reason_totals: dropReasonTotals,
  };
}

function summarizeAlignmentMetrics(rows) {
  const mismatchType = {};
  let aligned = 0;
  let mismatched = 0;
  let augmentDroppedJobs = 0;
  const augmentDropReason = {};
  let crossBoundaryRiskCount = 0;
  let augmentSilentDropSuspect = 0;

  for (const row of rows) {
    const align = row.extra?.segment_alignment_diagnostics;
    if (align?.alignmentStatus === 'aligned') {
      aligned += 1;
    } else if (align?.alignmentStatus === 'mismatched') {
      mismatched += 1;
      const mt = align.mismatchType ?? 'unknown';
      mismatchType[mt] = (mismatchType[mt] || 0) + 1;
    }

    const aug = row.extra?.nbest_augment_diagnostics;
    if (aug?.augmentSliceDropped) {
      augmentDroppedJobs += 1;
      const reason = aug.dropReason ?? 'unknown';
      augmentDropReason[reason] = (augmentDropReason[reason] || 0) + 1;
    }

    const wr = row.extra?.window_recall_diagnostics;
    const dropped = wr?.nbestAugmentDroppedSlices ?? 0;
    const events = wr?.nbestAugmentDropEvents?.length ?? 0;
    if (dropped > 0 && events === 0) {
      augmentSilentDropSuspect += 1;
    }

    if (row.extra?.cross_boundary_risk?.crossBoundaryRisk === true) {
      crossBoundaryRiskCount += 1;
    }
  }

  const mismatchTotal = Object.values(mismatchType).reduce((a, b) => a + b, 0);
  const unknownMismatch =
    mismatchTotal > 0 ? (mismatchType.unknown || 0) / mismatchTotal : 0;

  return {
    segment_alignment_aligned_count: aligned,
    segment_alignment_mismatched_count: mismatched,
    mismatch_type_distribution: mismatchType,
    mismatch_unknown_rate: unknownMismatch,
    nbest_augment_dropped_job_count: augmentDroppedJobs,
    nbest_augment_drop_reason_distribution: augmentDropReason,
    augment_silent_drop_suspect_count: augmentSilentDropSuspect,
    cross_boundary_risk_count: crossBoundaryRiskCount,
  };
}

function summarizeV5Metrics(rows) {
  let diffWindows = 0;
  let enumerated = 0;
  let sliding = 0;
  let topkCandidates = 0;
  let outOfBundle = 0;
  let nearPinyinAttempts = 0;
  let modifiedWithoutReplacement = 0;
  let noOpRepair = 0;
  let aliasHitTotal = 0;
  let exactLookupHitTotal = 0;
  let top1HitTotal = 0;
  let pinyinAttemptTotal = 0;
  let pinyinHitTotal = 0;
  let topkAttemptTotal = 0;
  let editPenaltySum = 0;
  let editPenaltySamples = 0;
  const skipV5 = {};
  const topkByLen = { '2': 0, '3': 0, '4': 0, '5': 0 };
  let v5Jobs = 0;
  let sentenceCandidateBudget = null;

  for (const row of rows) {
    if (row.extra?.recover_contract_version !== 'v5-scored-lexicon-topk') continue;
    v5Jobs += 1;
    const m = row.extra?.v5_metrics || {};
    diffWindows += m.windows_from_nbest_diff_count ?? 0;
    enumerated += m.windows_enumerated ?? 0;
    sliding += m.sliding_window_count ?? 0;
    topkCandidates += m.lexicon_pinyin_topk_candidate_count ?? 0;
    outOfBundle += m.out_of_bundle_candidate_count ?? 0;
    nearPinyinAttempts += m.near_pinyin_attempt_count ?? 0;
    modifiedWithoutReplacement += m.modified_without_replacement_count ?? 0;
    noOpRepair += m.no_op_repair_count ?? 0;
    aliasHitTotal += m.alias_hit_count ?? 0;
    exactLookupHitTotal += m.exact_lookup_hit_count ?? 0;
    top1HitTotal += m.top1_hit_count ?? 0;
    pinyinAttemptTotal += m.pinyin_attempt_count ?? 0;
    pinyinHitTotal += m.pinyin_hit_count ?? 0;
    const wr = row.extra?.window_recall_diagnostics || {};
    const attemptMap = wr.topkAttemptsByTermLength || {};
    for (const n of Object.values(attemptMap)) {
      topkAttemptTotal += n || 0;
    }
    if (!Object.keys(attemptMap).length) {
      topkAttemptTotal += wr.pinyinAttemptCount ?? 0;
    }
    editPenaltySum += m.edit_distance_penalty_sum ?? 0;
    editPenaltySamples += m.edit_distance_penalty_samples ?? 0;
    if (sentenceCandidateBudget === null && m.sentence_candidate_budget != null) {
      sentenceCandidateBudget = m.sentence_candidate_budget;
    }
    const sr = m.skip_reason_v5 || {};
    for (const [k, v] of Object.entries(sr)) {
      skipV5[k] = (skipV5[k] || 0) + (v || 0);
    }
    const rates = m.topk_hit_rate_by_term_length || {};
    for (const len of ['2', '3', '4', '5']) {
      if ((rates[len] ?? 0) > 0) topkByLen[len] += 1;
    }
  }

  const topkHitRate =
    topkAttemptTotal > 0 ? Math.min(1, topkCandidates / Math.max(topkAttemptTotal, 1)) : 0;
  const top1HitRate = topkCandidates > 0 ? top1HitTotal / topkCandidates : 0;
  const aliasHitRate = topkCandidates > 0 ? aliasHitTotal / topkCandidates : 0;
  const pinyinHitRate = pinyinAttemptTotal > 0 ? pinyinHitTotal / pinyinAttemptTotal : 0;
  const noOpRepairRate = v5Jobs > 0 ? noOpRepair / v5Jobs : 0;

  return {
    v5_job_count: v5Jobs,
    windows_from_nbest_diff_ratio: enumerated > 0 ? diffWindows / enumerated : 0,
    sliding_window_count_total: sliding,
    lexicon_pinyin_topk_candidate_total: topkCandidates,
    out_of_bundle_total: outOfBundle,
    near_pinyin_attempt_count: nearPinyinAttempts,
    modified_without_replacement_count_total: modifiedWithoutReplacement,
    no_op_repair_count_total: noOpRepair,
    no_op_repair_rate: noOpRepairRate,
    alias_hit_count_total: aliasHitTotal,
    alias_hit_rate: aliasHitRate,
    exact_lookup_hit_count_total: exactLookupHitTotal,
    top1_hit_count_total: top1HitTotal,
    top1_hit_rate: top1HitRate,
    topk_hit_rate: topkHitRate,
    pinyin_attempt_count_total: pinyinAttemptTotal,
    pinyin_hit_count_total: pinyinHitTotal,
    pinyin_hit_rate: pinyinHitRate,
    edit_distance_penalty_sum: editPenaltySum,
    edit_distance_penalty_samples: editPenaltySamples,
    sentence_candidate_budget: sentenceCandidateBudget,
    skip_reason_v5_distribution: skipV5,
    topk_hit_jobs_by_term_length: topkByLen,
  };
}

function summarizeCanonicalOnly(rows) {
  let confusionEvidenceTotal = 0;
  for (const row of rows) {
    const candidates = row.extra?.window_candidates || [];
    for (const c of candidates) {
      if (c.source === 'confusion_evidence') {
        confusionEvidenceTotal += 1;
      }
    }
  }
  return { confusion_evidence_total: confusionEvidenceTotal };
}

function summarizeRecallCoverageMetrics(rows) {
  let fuzzyAttempt = 0;
  let fuzzyHit = 0;
  let pinyinAttempt = 0;
  let pinyinHit = 0;
  let withCoverageDiag = 0;
  const whyRejected = {};
  let regressionHit = 0;
  const regressionIds = new Set();

  try {
    const manifestPath = path.join(__dirname, '../../docs/recover/v4/q17-regression-manifest.json');
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const c of m.cases || []) {
        regressionIds.add(c.caseId);
      }
    }
  } catch (_) {}

  for (const row of rows) {
    const wr = row.extra?.window_recall_diagnostics;
    fuzzyAttempt += wr?.fuzzyObservedAttemptCount ?? 0;
    fuzzyHit += wr?.fuzzyObservedHitCount ?? 0;
    pinyinAttempt += wr?.pinyinAttemptCount ?? 0;
    pinyinHit += wr?.pinyinHitCount ?? 0;
    const cov = row.extra?.recall_coverage_diagnostics;
    if (cov) {
      withCoverageDiag += 1;
      const w = cov.whyRejected ?? 'unknown';
      whyRejected[w] = (whyRejected[w] || 0) + 1;
    }
    if (regressionIds.has(row.id) && (row.window_candidate_count || 0) > 0) {
      regressionHit += 1;
    }
  }

  return {
    recall_fuzzy_observed_attempt_total: fuzzyAttempt,
    recall_fuzzy_observed_hit_total: fuzzyHit,
    recall_pinyin_attempt_total: pinyinAttempt,
    recall_pinyin_hit_total: pinyinHit,
    recall_coverage_diagnostics_job_count: withCoverageDiag,
    recall_why_rejected_distribution: whyRejected,
    q17_regression_window_hit_count:
      regressionIds.size > 0 ? regressionHit : null,
    q17_regression_window_hit_rate:
      regressionIds.size > 0 ? regressionHit / regressionIds.size : null,
  };
}

function summarizeKenlmTiming(rows) {
  const batches = rows
    .map((r) => r.kenlm_timing?.batchMs)
    .filter((n) => typeof n === 'number' && n >= 0);
  if (!batches.length) return null;
  const sorted = [...batches].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    sample_count: sorted.length,
    avg_ms: sum / sorted.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    max_ms: sorted[sorted.length - 1],
  };
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('Missing manifest. Run: python "test wav/dialog_200/gen_dialog_200_wavs.py"');
    process.exit(1);
  }

  let cases = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (limit > 0) cases = cases.slice(0, limit);

  const port = getPort();
  console.log('Waiting for test server on', port, '...');
  if (!(await waitHealth(port))) {
    console.error('Test server not ready. Start node with PROJECT_ROOT set.');
    process.exit(1);
  }

  const report = {
    timestamp: new Date().toISOString(),
    port,
    dialogDir: DIALOG_DIR,
    projectRoot: process.env.PROJECT_ROOT || null,
    testScope: 'Recover V5 single-turn contract test',
    intentEvaluationScope: 'disabled_or_not_applicable',
    intentE2EValidated: false,
    recoverContractValidated: true,
    total: cases.length,
    cases: [],
    summary: {},
  };

  let pass = 0;
  let fail = 0;
  let skip = 0;

  for (const caseDef of cases) {
    const wavPath = path.join(DIALOG_DIR, caseDef.file);
    if (!fs.existsSync(wavPath)) {
      report.cases.push({ id: caseDef.id, pass: false, skip: true, error: 'missing wav' });
      skip += 1;
      console.log(`[${caseDef.id}] SKIP missing wav`);
      continue;
    }
    const sessionId = `d200-${caseDef.id}-${Date.now()}`;
    try {
      const data = await runWav(port, wavPath, sessionId);
      const row = contractRow(caseDef, data);
      report.cases.push(row);
      if (row.pass) {
        pass += 1;
        console.log(
          `[${caseDef.id}] PASS`,
          row.text_asr_preview.slice(0, 50),
          'modified',
          row.sentence_repair_modified
        );
      } else {
        fail += 1;
        console.log(`[${caseDef.id}] FAIL`, row);
      }
    } catch (e) {
      fail += 1;
      report.cases.push({ id: caseDef.id, scenario: caseDef.scenario, pass: false, error: e.message });
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }

  const evaluated = report.cases.filter((r) => !r.skip);
  const skipReasonDist = {};
  for (const row of evaluated) {
    const reason =
      row.sentence_repair_skip_reason ?? row.repair_skip_reason ?? row.recover_lifecycle?.skipReason ?? 'none';
    skipReasonDist[reason] = (skipReasonDist[reason] || 0) + 1;
  }

  report.summary = {
    total: cases.length,
    pass,
    passed: pass,
    fail,
    failed: fail,
    skip,
    pipeline_ok_rate: cases.length - skip > 0 ? pass / (cases.length - skip) : 0,
    lexicon_runtime_ok_count: evaluated.filter((r) => r.lexicon_runtime_status === 'ok').length,
    recover_executed_count: evaluated.filter((r) => r.recover_lifecycle?.executed === true).length,
    sentence_repair_executed_count: evaluated.filter((r) => r.sentence_repair_executed === true).length,
    sentence_repair_modified_count: evaluated.filter((r) => r.sentence_repair_modified).length,
    contract_violation_modified_without_replacement_count: evaluated.filter(
      (r) => r.contract_violation_modified_without_replacement
    ).length,
    replacements_applied_count: evaluated.filter((r) => r.replacements_applied).length,
    window_candidates_nonempty_count: evaluated.filter((r) => (r.window_candidate_count || 0) > 0).length,
    phonetic_expanded_sentence_candidates_count: evaluated.reduce(
      (sum, r) => sum + (r.phonetic_expanded_sentence_candidates_count ?? 0),
      0
    ),
    picked_from_raw_ctc_nbest_count: evaluated.filter(
      (r) => (r.picked_from_raw_ctc_nbest_count ?? 0) > 0
    ).length,
    picked_from_phonetic_expansion_count: evaluated.filter(
      (r) => (r.picked_from_phonetic_expansion_count ?? 0) > 0
    ).length,
    skip_reason_distribution: skipReasonDist,
    intentEvaluationScope: 'disabled_or_not_applicable',
    intentE2EValidated: false,
    recoverContractValidated: true,
    ...(evaluated[0]?.extra?.configLoadSucceeded !== undefined
      ? {
          configLoadSucceeded: evaluated[0].extra.configLoadSucceeded,
          configParseError: evaluated[0].extra.configParseError ?? null,
          runtimeFeatureDowngrade: evaluated[0].extra.runtimeFeatureDowngrade ?? false,
          downgradeReason: evaluated[0].extra.downgradeReason ?? null,
          downgradedFeatures: evaluated[0].extra.downgradedFeatures ?? [],
        }
      : {}),
    kenlm_timing_summary: summarizeKenlmTiming(evaluated),
    ...summarizeCtcNbest(evaluated),
    ...summarizeAsrServiceId(evaluated),
    ...summarizeQualityMetrics(evaluated),
    ...summarizeAlignmentMetrics(evaluated),
    ...summarizeRecallCoverageMetrics(evaluated),
    v5_summary: summarizeV5Metrics(evaluated),
    ...summarizeCanonicalOnly(evaluated),
    by_scenario: {},
  };
  for (const row of report.cases) {
    const sc = row.scenario || 'unknown';
    if (!report.summary.by_scenario[sc]) {
      report.summary.by_scenario[sc] = { pass: 0, fail: 0, skip: 0 };
    }
    if (row.skip) report.summary.by_scenario[sc].skip += 1;
    else if (row.pass) report.summary.by_scenario[sc].pass += 1;
    else report.summary.by_scenario[sc].fail += 1;
  }

  const outPath = path.join(__dirname, 'dialog-200-batch-result.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nWrote', outPath);
  console.log('Summary', JSON.stringify(report.summary, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
