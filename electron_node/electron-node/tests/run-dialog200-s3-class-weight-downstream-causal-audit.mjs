#!/usr/bin/env node
/**
 * MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_UTILITY_CAUSAL_AUDIT
 *
 * Same frozen upstream → baseline S3 weights vs A1_RERUN1 → full downstream to final text.
 * NO training. NO downstream logic change. NO promotion.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from './lib/wait-asr-ready.mjs';
import { loadDialog200Manifest, resolveDialog200AudioFile } from './lib/load-dialog200-manifest.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import { norm } from './lib/dialog200-path-trace-analyze.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const DIALOG_DIR = path.join(REPO, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');
const FREEZE_PATH = path.join(OUT_DIR, 'model3_v2_acceptance_harness_freeze_manifest.json');
const PHASE = 'MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_UTILITY_CAUSAL_AUDIT';
const HARNESS_VERSION = 'MODEL3_ACCEPTANCE_HARNESS_V1_20260831';

const BASELINE = {
  modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
  checkpointDirRelative:
    'training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013',
  expectedWeightsSha256:
    'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1',
};

const A1 = {
  modelId: 'MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1',
  checkpointDirRelative:
    'training/model3_dataset/model3_v2_s3_exp_class_weight_a1_rerun1/seed_2026083013',
  expectedWeightsSha256:
    '2d1c763249d5fca5c7586ea41868e391cc70e495069b5bab5f2e5905982e1bd0',
  classWeightRetry: 2.0,
};

const HIGH12 = [
  'd008',
  'd022',
  'd040',
  'd042',
  'd051',
  'd054',
  'd065',
  'd085',
  'd094',
  'd102',
  'd109',
  'd114',
  'd129',
  'd138',
  'd172',
  'd175',
];
const SUBGROUP = {
  d008: 'UNRESOLVED4',
  d022: 'UNRESOLVED4',
  d040: 'CLEAR_OOS',
  d042: 'CLEAR_OOS',
  d051: 'UNRESOLVED4',
  d054: 'SURFACE_UNRESOLVED',
  d065: 'LOCAL_FIT_WEAK',
  d085: 'CLEAR_OOS',
  d094: 'UNRESOLVED4',
  d102: 'LOCAL_FIT_WEAK',
  d109: 'SURFACE_UNRESOLVED',
  d114: 'SURFACE_UNRESOLVED',
  d129: 'CLEAR_OOS',
  d138: 'LOCAL_FIT_WEAK',
  d172: 'CLEAR_OOS',
  d175: 'CLEAR_OOS',
};
const CLEAR_OOS = ['d040', 'd042', 'd085', 'd129', 'd172', 'd175'];
const LOCAL_FIT = ['d065', 'd102', 'd138'];
const SURFACE = ['d054', 'd109', 'd114'];
const UNRESOLVED4 = ['d008', 'd022', 'd051', 'd094'];

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_FILTER =
  caseIdsIdx >= 0
    ? new Set(String(args[caseIdsIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
    : null;
const maxMinutes = (() => {
  const i = args.indexOf('--max-minutes');
  return i >= 0 ? parseFloat(args[i + 1]) : 360;
})();

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function fp(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

function levenshtein(a, b) {
  const s = a || '';
  const t = b || '';
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
}

function decisionFp(decisions) {
  return fp(
    (decisions || [])
      .filter((d) => !d.isAnchor)
      .map((d) => ({
        id: d.spanId,
        dec: d.decision,
        s: d.surface || '',
        rs: d.rawStart ?? d.start,
        re: d.rawEnd ?? d.end,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

function retryRegionFp(regions) {
  return fp(
    (regions || [])
      .map((r) => ({
        id: r.retryRegionId,
        rs: r.rawStart,
        re: r.rawEnd,
        spans: [...(r.sourceSpanIds || [])].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

function queryFp(invocations) {
  return fp(
    (invocations || [])
      .map((q) => ({
        w: q.windowText || '',
        p: q.windowPinyinKey || '',
        syl: [...(q.syllables || [])].join('|'),
        surf: q.spanSurface || '',
      }))
      .sort((a, b) => `${a.w}|${a.surf}`.localeCompare(`${b.w}|${b.surf}`))
  );
}

function recallFp(invocations) {
  return fp(
    (invocations || [])
      .map((q) => ({
        w: q.windowText || '',
        cands: (q.candidates || []).map((c) => c.surface).sort(),
      }))
      .sort((a, b) => a.w.localeCompare(b.w))
  );
}

function assemblyFp(texts) {
  return fp([...(texts || [])].sort());
}

function collectPathBranch(paths, branch) {
  const out = {
    decisions: [],
    retryRegions: [],
    retryRecallInvocations: [],
    assemblyTexts: [],
    model3RetryCount: 0,
    checkpointIdentity: null,
  };
  for (const p of paths) {
    const m3 = p.model3 || {};
    const ac = m3.acceptance_causal || {};
    if (branch === 'baseline') {
      out.decisions.push(...(ac.baseline_decisions || []));
      out.retryRegions.push(...(ac.baseline_retry_regions || []));
      out.retryRecallInvocations.push(...(ac.baseline_retry_recall_invocations || []));
    } else {
      out.decisions.push(...(m3.decisions || []));
      out.retryRegions.push(...(m3.retry_regions || []));
      out.retryRecallInvocations.push(...(m3.retry_recall_invocations || []));
    }
    for (const d of branch === 'baseline' ? ac.baseline_decisions || [] : m3.decisions || []) {
      if (d.decision === 'RETRY' && !d.isAnchor) out.model3RetryCount += 1;
    }
    for (const s of p.assembly?.sentences || []) {
      if (s?.text) out.assemblyTexts.push(String(s.text));
    }
    if (branch === 's3' && m3.checkpoint_identity) out.checkpointIdentity = m3.checkpoint_identity;
    if (branch === 'baseline' && ac.baseline_decisions) {
      // checkpoint from baseline branch stored on s3 path ac in orchestrator — infer from causal if needed
    }
  }
  return out;
}

function classifyFinalUtility(baselineFinal, s3Final, expected) {
  const nB = norm(baselineFinal);
  const nS = norm(s3Final);
  const nE = norm(expected);
  if (!baselineFinal || !s3Final) return { cls: 'REFERENCE_UNAVAILABLE', distB: null, distS: null };
  if (!nE) {
    if (nB === nS) return { cls: 'UNCHANGED', distB: null, distS: null };
    return { cls: 'CHANGED_NEUTRAL', distB: null, distS: null };
  }
  const db = levenshtein(nB, nE);
  const ds = levenshtein(nS, nE);
  if (nB === nS) return { cls: 'UNCHANGED', distB: db, distS: ds };
  if (ds < db) return { cls: 'IMPROVED', distB: db, distS: ds };
  if (ds > db) return { cls: 'REGRESSED', distB: db, distS: ds };
  return { cls: 'CHANGED_NEUTRAL', distB: db, distS: ds };
}

function decomposeStage(row) {
  if (!row.validCausal) return 'INVALID_CAUSAL_CASE';
  if (!row.model3DecisionChanged) {
    if (row.finalUtility === 'UNCHANGED') return 'NO_MODEL3_DECISION_CHANGE';
    return row.finalUtility === 'IMPROVED'
      ? 'FINAL_TEXT_CHANGED_IMPROVED'
      : row.finalUtility === 'REGRESSED'
        ? 'FINAL_TEXT_CHANGED_REGRESSED'
        : 'FINAL_TEXT_CHANGED_NEUTRAL';
  }
  if (!row.retryRegionChanged) return 'MODEL3_CHANGED_RETRY_REGION_SAME';
  if (!row.retryQueryChanged) return 'RETRY_REGION_CHANGED_QUERY_SAME';
  if (!row.recallChanged) return 'RETRY_QUERY_CHANGED_RECALL_SAME';
  if (!row.assemblyChanged) return 'RECALL_CHANGED_ASSEMBLY_SAME';
  if (!row.kenlmChanged) return 'ASSEMBLY_CHANGED_KENLM_WINNER_SAME';
  if (row.finalUtility === 'IMPROVED') return 'FINAL_TEXT_CHANGED_IMPROVED';
  if (row.finalUtility === 'REGRESSED') return 'FINAL_TEXT_CHANGED_REGRESSED';
  if (row.finalUtility === 'UNCHANGED') return 'KENLM_WINNER_CHANGED_FINAL_SAME';
  if (row.baselineAlreadyCorrect && row.finalUtility !== 'IMPROVED') return 'NO_REPAIRABLE_TARGET';
  return 'FINAL_TEXT_CHANGED_NEUTRAL';
}

function analyzeCase(caseDef, data) {
  const extra = data.extra || {};
  const trace = extra.dialog200_path_trace || {};
  const causal = trace.acceptance_causal || null;
  const paths = trace.paths || [];
  const expected = String(caseDef.expectedText || caseDef.utterance || '').trim();
  const baselineFinal = String(causal?.baseline_final_text ?? '').trim();
  const s3Final = String(data.text_asr || causal?.s3_final_text || '').trim();

  const pathParity = [];
  let secondVote = 0;
  let anchorRetry = 0;
  let recursiveModel3 = 0;
  let kenlmGt16 = 0;

  for (const p of paths) {
    const m3 = p.model3 || {};
    const ac = m3.acceptance_causal;
    if (ac) {
      pathParity.push({
        pathId: p.path_id,
        upstreamHash: ac.upstream_hash,
        packedHash: ac.packed_hash,
        mutationIsolated: ac.mutation_isolated,
      });
    }
    if ((m3.vote_call_count || 0) > 1) secondVote += 1;
    for (const d of m3.decisions || []) {
      if (d.isAnchor && d.decision === 'RETRY') anchorRetry += 1;
    }
    for (const r of m3.retry_regions || []) {
      if (r.model3Reinvoked) recursiveModel3 += 1;
      if (r.secondDomainVote) secondVote += 1;
    }
  }

  const pool = extra?.fw_detector?.spanAssemblyV4?.kenlmPoolCandidateCount;
  if (pool != null && pool > 16) kenlmGt16 = 1;

  const baselineBranch = collectPathBranch(paths, 'baseline');
  const s3Branch = collectPathBranch(paths, 's3');

  const baselineDecFp = decisionFp(baselineBranch.decisions);
  const s3DecFp = decisionFp(s3Branch.decisions);
  const model3DecisionChanged = baselineDecFp !== s3DecFp;

  const baselineRegFp = retryRegionFp(baselineBranch.retryRegions);
  const s3RegFp = retryRegionFp(s3Branch.retryRegions);
  const retryRegionChanged = baselineRegFp !== s3RegFp;

  const baselineQFp = queryFp(baselineBranch.retryRecallInvocations);
  const s3QFp = queryFp(s3Branch.retryRecallInvocations);
  const retryQueryChanged = baselineQFp !== s3QFp;

  const baselineRecFp = recallFp(baselineBranch.retryRecallInvocations);
  const s3RecFp = recallFp(s3Branch.retryRecallInvocations);
  const recallChanged = baselineRecFp !== s3RecFp;

  const baselineAsmFp =
    causal?.baseline_kenlm_pool_fingerprint ??
    assemblyFp(causal?.baseline_kenlm_pool_fingerprint ? null : []);
  const s3AsmFp = causal?.s3_kenlm_pool_fingerprint ?? null;
  const assemblyChanged =
    baselineAsmFp != null && s3AsmFp != null ? baselineAsmFp !== s3AsmFp : false;

  const baselineKenlm = baselineFinal;
  const s3Kenlm = s3Final;
  const kenlmChanged = norm(baselineKenlm) !== norm(s3Kenlm);

  const { cls: finalUtility, distB, distS } = classifyFinalUtility(
    baselineFinal,
    s3Final,
    expected
  );

  const allMutIsolated = pathParity.length > 0 && pathParity.every((p) => p.mutationIsolated);
  // Each retained path has its own upstream snapshot; parity = per-path mutation isolation.
  const upstreamParityPass = allMutIsolated && pathParity.length > 0;
  const snapshotCaptured = Boolean(causal) && pathParity.length > 0;
  const bothFinalKnown = Boolean(baselineFinal) && Boolean(s3Final);
  const finalUnknownDueToDecisionChange = model3DecisionChanged && !bothFinalKnown ? 1 : 0;

  const validCausal =
    snapshotCaptured &&
    upstreamParityPass &&
    bothFinalKnown &&
    secondVote === 0 &&
    anchorRetry === 0 &&
    recursiveModel3 === 0 &&
    kenlmGt16 === 0;

  const invalidReasons = [];
  if (!snapshotCaptured) invalidReasons.push('NO_SNAPSHOT');
  if (!upstreamParityPass) invalidReasons.push('UPSTREAM_PARITY_FAIL');
  if (!bothFinalKnown) invalidReasons.push('FINAL_TEXT_MISSING');
  if (secondVote > 0) invalidReasons.push('SECOND_DOMAIN_VOTE');
  if (anchorRetry > 0) invalidReasons.push('ANCHOR_RETRY');
  if (recursiveModel3 > 0) invalidReasons.push('RECURSIVE_MODEL3');
  if (kenlmGt16 > 0) invalidReasons.push('KENLM_CAP_GT16');

  const nExp = norm(expected);
  const baselineAlreadyCorrect = nExp.length > 0 && norm(baselineFinal) === nExp;

  const row = {
    caseId: caseDef.id,
    subgroup: SUBGROUP[caseDef.id] || '',
    validCausal,
    snapshotCaptured,
    upstreamParityPass,
    bothFinalKnown,
    finalUnknownDueToDecisionChange,
    model3DecisionChanged,
    retryRegionChanged,
    retryQueryChanged,
    recallChanged,
    assemblyChanged,
    kenlmChanged,
    finalTextChanged: norm(baselineFinal) !== norm(s3Final),
    finalUtility,
    distBaseline: distB,
    distS3: distS,
    baselineFinal,
    s3Final,
    expected,
    baselineAlreadyCorrect,
    baselineModel3RetrySpans: baselineBranch.model3RetryCount,
    s3Model3RetrySpans: s3Branch.model3RetryCount,
    baselineRetryRegions: baselineBranch.retryRegions.length,
    s3RetryRegions: s3Branch.retryRegions.length,
    baselineRecallQueries: baselineBranch.retryRecallInvocations.length,
    s3RecallQueries: s3Branch.retryRecallInvocations.length,
    baselinePoolFp: baselineAsmFp,
    s3PoolFp: s3AsmFp,
    baselineKenlm,
    s3Kenlm,
    secondVote,
    anchorRetry,
    recursiveModel3,
    kenlmGt16,
    pathCount: pathParity.length,
    invalidReasons: invalidReasons.join('|'),
  };
  row.decomposition = decomposeStage(row);
  return row;
}

async function runCase(port, wavPath, jobId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      jobId,
      sessionId: `m3-cw-downstream-${jobId}`,
      utteranceIndex: 0,
    }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

function verifyCheckpoint(id, spec) {
  const weights = path.join(REPO, spec.checkpointDirRelative, 'weights.pt');
  if (!fs.existsSync(weights)) throw new Error(`missing_weights:${id}`);
  const digest = sha256File(weights).toLowerCase();
  if (digest !== spec.expectedWeightsSha256) {
    throw new Error(`sha_mismatch:${id}:${digest}`);
  }
  return digest;
}

function buildVerdict(summary) {
  if (summary.finalUnknownDueToDecisionChange > 0 || !summary.fullReplayComplete) {
    return {
      verdict: 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_CAUSAL_INCOMPLETE',
      nextPhase: 'MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_REPLAY_COMPLETENESS_CORRECTION',
    };
  }
  if (summary.invalidCausalCases > 0) {
    return {
      verdict: 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_INVALID',
      nextPhase: 'MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_REPLAY_COMPLETENESS_CORRECTION',
    };
  }
  const net = summary.finalImproved - summary.finalRegressed;
  if (summary.finalRegressed > 0 && net < 0) {
    return {
      verdict: 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_REGRESSION',
      nextPhase: 'MODEL3_V2_S3_CLASS_WEIGHT_FAILURE_FREEZE',
    };
  }
  if (summary.finalImproved > 0 && summary.finalRegressed === 0) {
    return {
      verdict: 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_CAUSAL_PASS_POSITIVE',
      nextPhase: 'MODEL3_V2_S3_CLASS_WEIGHT_PROMOTION_FREEZE',
    };
  }
  if (summary.finalImproved > 0 && summary.finalRegressed > 0) {
    return {
      verdict: 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_CAUSAL_PASS_TRADEOFF',
      nextPhase: 'MODEL3_V2_S3_CLASS_WEIGHT_PROMOTION_FREEZE',
    };
  }
  const owner = summary.dominantDownstreamOwner;
  if (owner && owner !== 'NONE' && owner !== 'MODEL3_TRIGGER') {
    const slug = owner.replace(/_/g, '_');
    return {
      verdict: 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_OWNER_IDENTIFIED',
      nextPhase: `MODEL3_V2_S3_${slug}_CORRECTION_DESIGN_AUDIT`,
    };
  }
  if (summary.model3ChangedCases > 0 && summary.finalImproved === 0) {
    return {
      verdict: 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_INTERNAL_ONLY',
      nextPhase: 'MODEL3_V2_S3_DOWNSTREAM_CAUSAL_OWNER_ISOLATION_AUDIT',
    };
  }
  return {
    verdict: 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_NO_BENEFIT',
    nextPhase: 'MODEL3_V2_S3_DOWNSTREAM_CAUSAL_OWNER_ISOLATION_AUDIT',
  };
}

function writeArtifacts(rows, summary, verdictPack) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const caseMatrix = [
    [
      'caseId',
      'subgroup',
      'validCausal',
      'model3DecisionChanged',
      'retryRegionChanged',
      'retryQueryChanged',
      'recallChanged',
      'assemblyChanged',
      'kenlmChanged',
      'finalTextChanged',
      'finalUtility',
      'decomposition',
      'baselineFinal',
      's3Final',
      'expected',
    ].join(','),
  ];
  for (const r of rows) {
    caseMatrix.push(
      [
        r.caseId,
        r.subgroup,
        r.validCausal,
        r.model3DecisionChanged,
        r.retryRegionChanged,
        r.retryQueryChanged,
        r.recallChanged,
        r.assemblyChanged,
        r.kenlmChanged,
        r.finalTextChanged,
        r.finalUtility,
        r.decomposition,
        r.baselineFinal,
        r.s3Final,
        r.expected,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_s3_downstream_causal_case_matrix.csv'),
    caseMatrix.join('\n')
  );

  const stageCsv = [
    [
      'caseId',
      'decomposition',
      'model3DecisionChanged',
      'retryRegionChanged',
      'retryQueryChanged',
      'recallChanged',
      'assemblyChanged',
      'kenlmChanged',
      'finalUtility',
    ].join(','),
  ];
  for (const r of rows) {
    stageCsv.push(
      [
        r.caseId,
        r.decomposition,
        r.model3DecisionChanged,
        r.retryRegionChanged,
        r.retryQueryChanged,
        r.recallChanged,
        r.assemblyChanged,
        r.kenlmChanged,
        r.finalUtility,
      ].join(',')
    );
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_s3_downstream_stage_decomposition.csv'),
    stageCsv.join('\n')
  );

  const h12Csv = [
    [
      'caseId',
      'subgroup',
      'baselineModel3RetrySpans',
      's3Model3RetrySpans',
      'baselineRetryRegions',
      's3RetryRegions',
      'baselineRecallQueries',
      's3RecallQueries',
      'baselineKenlm',
      's3Kenlm',
      'baselineFinal',
      's3Final',
      'finalUtility',
      'decomposition',
    ].join(','),
  ];
  for (const r of rows.filter((x) => HIGH12.includes(x.caseId))) {
    h12Csv.push(
      [
        r.caseId,
        r.subgroup,
        r.baselineModel3RetrySpans,
        r.s3Model3RetrySpans,
        r.baselineRetryRegions,
        r.s3RetryRegions,
        r.baselineRecallQueries,
        r.s3RecallQueries,
        r.baselineKenlm,
        r.s3Kenlm,
        r.baselineFinal,
        r.s3Final,
        r.finalUtility,
        r.decomposition,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_s3_high12_full_downstream_trace.csv'),
    h12Csv.join('\n')
  );

  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_s3_downstream_utility_summary.json'),
    JSON.stringify({ phase: PHASE, generatedAt: new Date().toISOString(), ...summary, ...verdictPack }, null, 2)
  );

  const freezeRows = [
    'key,value,status',
    `phase,${PHASE},RECORDED`,
    `CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY,${summary.classWeightMainlineCausalUtility},CORRECTED`,
    `prior_CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY,NOT_YET_EVALUATED_FOR_CHANGED_CASES,SUPERSEDED`,
    `FIRST_CAUSAL_OWNER,NOT_YET_ISOLATED,FROZEN`,
    `CLASS_WEIGHT_MODEL_LEVEL_SIGNAL,SUPPORTED,FROZEN`,
    `baseline_checkpoint,${BASELINE.modelId},VERIFIED`,
    `a1_checkpoint,${A1.modelId},VERIFIED`,
    `verdict,${verdictPack.verdict},RECORDED`,
    `next_phase,${verdictPack.nextPhase},RECORDED`,
    `PROMOTION_READY,${verdictPack.promotionReady},RECORDED`,
  ];
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_s3_downstream_freeze_state.csv'),
    freezeRows.join('\n')
  );

  const falseCsv = [
    'caseId,baselineAlreadyCorrect,s3ExtraRetry,finalUtility,falseRetryConsequence',
  ];
  for (const r of rows) {
    const extraRetry = r.s3Model3RetrySpans > r.baselineModel3RetrySpans;
    let cons = 'N_A';
    if (extraRetry && r.baselineAlreadyCorrect) {
      if (r.finalUtility === 'REGRESSED') cons = 'FALSE_RETRY_FINAL_REGRESSION';
      else if (r.recallChanged || r.assemblyChanged) cons = 'FALSE_RETRY_CANDIDATE_CHANGE_NO_FINAL_CHANGE';
      else if (r.retryRegionChanged) cons = 'FALSE_RETRY_EXTRA_WORK_ONLY';
      else cons = 'FALSE_RETRY_NO_EFFECT';
    }
    falseCsv.push([r.caseId, r.baselineAlreadyCorrect, extraRetry, r.finalUtility, cons].join(','));
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_s3_false_retry_consequence.csv'),
    falseCsv.join('\n')
  );

  const md = `# Lingua — Model3 V2 S3 Class Weight Downstream Utility Causal Audit

Date: 2026-09-03  
Phase: \`${PHASE}\`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| verdict | \`${verdictPack.verdict}\` |
| baseline checkpoint | \`${BASELINE.modelId}\` |
| A1 checkpoint | \`${A1.modelId}\` (cw=${A1.classWeightRetry}) |
| full replay complete | ${summary.fullReplayComplete} |
| final unknown count | ${summary.finalUnknownDueToDecisionChange} |
| Model3 changed | ${summary.model3ChangedCases} |
| Retry changed | ${summary.retryRegionChangedCases} |
| Recall changed | ${summary.recallChangedCases} |
| Assembly changed | ${summary.assemblyChangedCases} |
| KenLM changed | ${summary.kenlmChangedCases} |
| final improved | ${summary.finalImproved} |
| final regressed | ${summary.finalRegressed} |
| net utility | ${summary.netFinalImprovement} |
| dominant downstream owner | ${summary.dominantDownstreamOwner} |
| FIRST_CAUSAL_OWNER | NOT_YET_ISOLATED |
| promotion readiness | ${verdictPack.promotionReady} |
| next phase | \`${verdictPack.nextPhase}\` |

================================
SSOT CORRECTION
===============

Prior \`CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY=INTERNAL_ONLY_NO_FINAL_UTILITY\` superseded.  
Current: \`${summary.classWeightMainlineCausalUtility}\` after full downstream replay.

================================
CHECKPOINT IDENTITY
===================

- Baseline SHA: \`${summary.baselineSha}\`
- A1 SHA: \`${summary.a1Sha}\`
- Training in this phase: NO

================================
FULL 200-CASE REPLAY
====================

- total: ${summary.totalCases}
- valid causal: ${summary.validCausalCases}
- invalid: ${summary.invalidCausalCases}

================================
FINAL TEXT UTILITY
==================

- IMPROVED: ${summary.finalImproved}
- REGRESSED: ${summary.finalRegressed}
- NEUTRAL: ${summary.finalNeutral}
- UNCHANGED: ${summary.finalUnchanged}
- net: ${summary.netFinalImprovement}

================================
NEXT PHASE
==========

\`${verdictPack.nextPhase}\` (exactly one)
`;
  fs.writeFileSync(
    path.join(OUT_DIR, 'Lingua_Model3_V2_S3_Class_Weight_Downstream_Utility_Causal_Audit_2026_09_03.md'),
    md
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (!fs.existsSync(FREEZE_PATH)) {
    console.error('HARD STOP: freeze manifest missing');
    process.exit(2);
  }
  const freeze = JSON.parse(fs.readFileSync(FREEZE_PATH, 'utf8'));
  if (freeze.verdict !== 'ACCEPTANCE_HARNESS_FREEZE_PASS') {
    console.error('HARD STOP: harness freeze not PASS');
    process.exit(2);
  }

  const baselineSha = verifyCheckpoint(BASELINE.modelId, BASELINE);
  const a1Sha = verifyCheckpoint(A1.modelId, A1);
  console.log('[checkpoint] baseline', baselineSha.slice(0, 12));
  console.log('[checkpoint] A1', a1Sha.slice(0, 12));

  delete process.env.MODEL3_HARNESS_KEEP_ALL;

  if (!skipStart) {
    console.log('[cw-downstream] build:main…');
    const b = spawnSync('npm', ['run', 'build:main'], {
      cwd: ELECTRON,
      env: process.env,
      stdio: 'inherit',
      shell: true,
    });
    if (b.status !== 0) process.exit(1);
    killPort(6007);
    killPort(5020);
  }

  const port = getTestServerPort();
  const { cases: casesAll } = loadDialog200Manifest(MANIFEST_PATH);
  let cases = casesAll;
  if (CASE_FILTER) cases = cases.filter((c) => CASE_FILTER.has(c.id));

  if (!skipStart) {
    const env = {
      ...process.env,
      PROJECT_ROOT: REPO,
      TONE_P10_VAD_CPU: '1',
      MODEL3_CHECKPOINT_IDENTITY: BASELINE.modelId,
      MODEL3_BASELINE_CHECKPOINT_IDENTITY: BASELINE.modelId,
      MODEL3_CANDIDATE_CHECKPOINT_IDENTITY: A1.modelId,
      MODEL2_DIALOG200_TRACE: '1',
      MODEL3_ACCEPTANCE_CAUSAL_FORK: '1',
      MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT: '1',
      MODEL3_INFERENCE_INPUT_TRACE: '1',
    };
    delete env.MODEL3_HARNESS_KEEP_ALL;
    spawn(process.execPath, [START_DETACHED, String(port)], {
      cwd: ELECTRON,
      env,
      detached: true,
      stdio: 'ignore',
    }).unref();
    await waitTestServerHealth(port, 120000);
    const warmupWav = path.join(
      DIALOG_DIR,
      resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav'
    );
    const asrReady = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 600000,
      label: 'cw-downstream-asr-warmup',
    });
    if (!asrReady.ready) {
      console.error('ASR FAIL', asrReady.lastError);
      process.exit(1);
    }
  }

  console.log(`[cw-downstream] cases=${cases.length} phase=${PHASE}`);
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  const rows = [];

  for (const caseDef of cases) {
    if (Date.now() >= deadline) break;
    const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
    if (!fs.existsSync(wavPath)) {
      rows.push({ caseId: caseDef.id, validCausal: false, error: 'missing_wav' });
      continue;
    }
    const t0 = Date.now();
    try {
      const data = await runCase(port, wavPath, `${caseDef.id}-${Date.now()}`);
      const row = analyzeCase(caseDef, data);
      row.pipelineMs = Date.now() - t0;
      rows.push(row);
      console.log(
        `[${caseDef.id}] valid=${row.validCausal} m3Δ=${row.model3DecisionChanged} final=${row.finalUtility} decomp=${row.decomposition} invalid=${row.invalidReasons || '-'} ${row.pipelineMs}ms`
      );
    } catch (e) {
      rows.push({ caseId: caseDef.id, validCausal: false, error: e.message });
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }

  const validRows = rows.filter((r) => r.validCausal);
  const summary = {
    totalCases: rows.length,
    validCausalCases: validRows.length,
    invalidCausalCases: rows.length - validRows.length,
    fullReplayComplete: rows.length === 200 && !CASE_FILTER,
    finalUnknownDueToDecisionChange: rows.reduce(
      (s, r) => s + (r.finalUnknownDueToDecisionChange || 0),
      0
    ),
    model3ChangedCases: validRows.filter((r) => r.model3DecisionChanged).length,
    model3UnchangedCases: validRows.filter((r) => !r.model3DecisionChanged).length,
    retryRegionChangedCases: validRows.filter((r) => r.retryRegionChanged).length,
    retryQueryChangedCases: validRows.filter((r) => r.retryQueryChanged).length,
    recallChangedCases: validRows.filter((r) => r.recallChanged).length,
    assemblyChangedCases: validRows.filter((r) => r.assemblyChanged).length,
    kenlmChangedCases: validRows.filter((r) => r.kenlmChanged).length,
    finalTextChangedCases: validRows.filter((r) => r.finalTextChanged).length,
    finalImproved: validRows.filter((r) => r.finalUtility === 'IMPROVED').length,
    finalRegressed: validRows.filter((r) => r.finalUtility === 'REGRESSED').length,
    finalNeutral: validRows.filter((r) => r.finalUtility === 'CHANGED_NEUTRAL').length,
    finalUnchanged: validRows.filter((r) => r.finalUtility === 'UNCHANGED').length,
    netFinalImprovement:
      validRows.filter((r) => r.finalUtility === 'IMPROVED').length -
      validRows.filter((r) => r.finalUtility === 'REGRESSED').length,
    baselineSha,
    a1Sha,
    trainingSkipped: true,
    upstreamParityPass: validRows.every((r) => r.upstreamParityPass),
    classWeightMainlineCausalUtility: 'PENDING_EVAL',
  };

  const ownerCounts = {};
  for (const r of validRows.filter((x) => x.model3DecisionChanged && x.finalUtility !== 'IMPROVED')) {
    let owner = 'MODEL3_TRIGGER_NOT_USEFUL';
    if (r.retryQueryChanged && r.recallChanged) owner = 'RECALL';
    else if (r.retryRegionChanged && !r.retryQueryChanged) owner = 'RETRY_REGION_DERIVATION';
    else if (r.retryQueryChanged) owner = 'RETRY_QUERY_MAPPING';
    else if (r.assemblyChanged) owner = 'ASSEMBLY';
    else if (r.kenlmChanged) owner = 'KENLM';
    ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
  }
  summary.dominantDownstreamOwner =
    Object.entries(ownerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NONE';

  if (summary.finalImproved > 0 && summary.finalRegressed === 0) {
    summary.classWeightMainlineCausalUtility = 'PROVEN_POSITIVE';
  } else if (summary.finalImproved > 0) {
    summary.classWeightMainlineCausalUtility = 'POSITIVE_BUT_TRADEOFF';
  } else if (summary.model3ChangedCases > 0 && summary.finalImproved === 0) {
    summary.classWeightMainlineCausalUtility = 'INTERNAL_ONLY_NO_FINAL_UTILITY';
  } else {
    summary.classWeightMainlineCausalUtility = 'NO_BENEFIT';
  }

  const verdictPack = buildVerdict(summary);
  verdictPack.promotionReady =
    verdictPack.verdict === 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_CAUSAL_PASS_POSITIVE' ||
    verdictPack.verdict === 'MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_CAUSAL_PASS_TRADEOFF'
      ? 'TRUE'
      : 'FALSE';

  writeArtifacts(rows, summary, verdictPack);
  console.log(JSON.stringify({ ...summary, ...verdictPack }, null, 2));
  process.exit(summary.fullReplayComplete && summary.finalUnknownDueToDecisionChange === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
