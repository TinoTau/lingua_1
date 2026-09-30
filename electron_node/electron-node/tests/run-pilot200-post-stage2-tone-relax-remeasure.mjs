#!/usr/bin/env node
/**
 * LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE
 *
 * MEASURE_ONLY harness. Reuses frozen Pilot200 dataset + gate evaluator.
 * Extends observation with Model3 / Anchor ACP / Retry shared-budget metrics.
 * NO product code / model / threshold / dataset changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getTestServerPort, waitTestServerHealth } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import {
  validatePilotCompleteness,
} from './run-pilot200-post-pre-edge-full-remeasure.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DS = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const PROFILES_DIR = path.join(DS, 'profiles');
const MANIFEST_PATH = path.join(
  REPO,
  'docs',
  'user_correction',
  'model3',
  'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json'
);
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');

const TRACE_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE_TRACE.jsonl');
const REPORT_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE_REPORT.md');
const SUMMARY_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_SUMMARY.json');
const GATE_MATRIX_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_CONDITION_MATRIX.json');
const CHANGED_CASES_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_CHANGED_CASES.csv');
const FAILURE_OWNER_PATH = path.join(
  OUT_DIR,
  'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_FAILURE_OWNER_MATRIX.json'
);

const PREV_TRACE_PATH = path.join(
  OUT_DIR,
  'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE_TRACE.jsonl'
);
const PREV_SUMMARY_PATH = path.join(
  OUT_DIR,
  'LINGUA_PILOT200_POST_ANCHOR_ACP_SUMMARY.json'
);

const CONDITIONS = ['NO_PROFILE', 'CORRECT_PROFILE', 'WRONG_PROFILE'];
const USER_ASSIGNMENTS = {
  U001: ['n_l', 'in_ing'],
  U002: ['z_zh', 'sh_s'],
  U003: ['eng_en', 'h_f'],
  U004: ['ch_c', 'n_l'],
  U005: ['sh_s'],
};

const PREV_BASELINE = {
  final: { NO_PROFILE: 22, CORRECT_PROFILE: 26, WRONG_PROFILE: 22 },
  gates: {
    gateA: { applicable: 471, pass: 471, passRate: 1 },
    gateB: { applicable: 314, pass: 261, passRate: 0.8312101910828026 },
    gateC: { applicable: 314, pass: 226, passRate: 0.7197452229299363 },
    gateD: { applicable: 314, pass: 161, passRate: 0.5127388535031847 },
    gateE: { applicable: 314, pass: 3, passRate: 0.009554140127388535 },
    gateF: { applicable: 314, pass: 3, passRate: 0.009554140127388535 },
    gateG: { applicable: 314, pass: 3, passRate: 0.009554140127388535 },
    gateH: { applicable: 314, pass: 3, passRate: 0.009554140127388535 },
    gateI: { applicable: 597, pass: 70, passRate: 0.11725293132328309 },
  },
  owners: {
    ASR_EMPTY: 3,
    NO_PROFILE_BASE_REPAIR_FAIL: 135,
    TONE_QUERY: 65,
    RELATION_TRANSFORM: 35,
    LEXICON_RECALL: 158,
    MODEL2_ACTION: 53,
    SUCCESS: 150,
    MODEL3_RETRY_NO_USEFUL_STAGE2: 1,
  },
  contrast: {
    correctVsNo: {
      targetActionRateGain: 261,
      targetLexiconHitGain: 3,
      targetEdgeCreatedGain: 3,
      finalRepairDelta: 4,
    },
    wrongVsNo: {
      extraExpansionCount: 21947,
      falseTargetHits: 0,
      finalRepairDelta: 0,
    },
  },
};

const args = process.argv.slice(2);
const SKIP_START = args.includes('--skip-start');
const RESUME = args.includes('--resume') || true;
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;
const caseFilterIdx = args.indexOf('--case-ids');
const CASE_FILTER =
  caseFilterIdx >= 0
    ? new Set(
        String(args[caseFilterIdx + 1] || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    : null;

function emptyProfile() {
  return {
    schema_version: 2,
    profile_version: 0,
    phonetic_bias: {},
    tone_bias: {},
    personal_terms: [],
    personal_term_evidence: {},
    resolved_lexical_terms: {},
    unresolved_lexical_observations: [],
    legacy_free_text_personal_terms: [],
    confusion_bias: {},
    domain_bias: {},
    long_term_domain_evidence: {},
  };
}

function loadCases() {
  return JSON.parse(
    '[' +
      fs
        .readFileSync(path.join(DS, 'cases', 'cases.jsonl'), 'utf8')
        .trim()
        .split(/\r?\n/)
        .join(',') +
      ']'
  );
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function loadProfileArtifact(profileRef) {
  const p = path.join(PROFILES_DIR, `${profileRef}.userprofile.json`);
  if (!fs.existsSync(p)) throw new Error(`Missing profile file: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function pickWrongUser(userId, relationFamily) {
  for (const other of Object.keys(USER_ASSIGNMENTS)) {
    if (other === userId) continue;
    if (relationFamily && USER_ASSIGNMENTS[other].includes(relationFamily)) continue;
    return other;
  }
  return null;
}

function resolveConditionProfile(caseRow, condition) {
  if (condition === 'NO_PROFILE') {
    return {
      profileRef: 'EMPTY_P0',
      profileStage: 'P0',
      userId: caseRow.userId,
      profile: emptyProfile(),
    };
  }
  if (condition === 'CORRECT_PROFILE') {
    const prof = loadProfileArtifact(caseRow.profileRef);
    return {
      profileRef: caseRow.profileRef,
      profileStage: caseRow.profileStage,
      userId: caseRow.userId,
      profile: prof,
    };
  }
  const wrongUid = caseRow.wrongProfileUserId || pickWrongUser(caseRow.userId, caseRow.relationFamily);
  const stage = caseRow.profileStage && caseRow.profileStage !== 'P0' ? caseRow.profileStage : 'P2';
  const ref = `prof_${wrongUid.toLowerCase()}_${stage.toLowerCase()}`;
  return {
    profileRef: ref,
    profileStage: stage,
    userId: wrongUid,
    wrongProfileUserId: wrongUid,
    profile: loadProfileArtifact(ref),
  };
}

function startElectron() {
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    MODEL2_DIALOG200_TRACE: '1',
    LEXICON_RECALL_V2_DIAGNOSTICS: '1',
    MODEL3_CANDIDATE_PROVENANCE_TRACE: '1',
  };
  const child = spawn(process.execPath, [START_DETACHED], {
    cwd: path.join(REPO, 'electron_node', 'electron-node'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stdout += d.toString();
  });
  return new Promise((resolve) => {
    child.on('exit', () => {
      const m = stdout.match(/STARTED electron pid\s+(\d+)/);
      resolve({ pid: m ? Number(m[1]) : null, stdout });
    });
  });
}

async function postJson(port, route, body, timeoutMs = 180000) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function actionHasRelation(actionId, rel) {
  if (!actionId || !rel) return false;
  const s = String(actionId);
  return s === rel || s.includes(`:${rel}`) || s.includes(rel);
}

function findTargetWindows(pathTrace, targetSurface, targetLen) {
  const windows = [];
  for (const p of pathTrace || []) {
    const m2 = p?.model2;
    const list = m2?.windows || m2?.spans || [];
    for (const w of list) {
      const win = w.window || w.finespan || {};
      const text = win.source_text || win.windowText || '';
      const sylLen =
        typeof win.syllable_end === 'number' && typeof win.syllable_start === 'number'
          ? win.syllable_end - win.syllable_start
          : text.length;
      if (sylLen === targetLen) {
        windows.push({ path_id: p.path_id, entry: w, win, text, sylLen });
      }
    }
  }
  return windows;
}

function inferProvClass(c) {
  const id = String(c.candidateId || c.id || '');
  const p = c.provenance || c.retrievalProvenance || '';
  if (p === 'PROFILE_DOMAIN' || id.startsWith('m2d:')) return 'PROFILE_DOMAIN';
  if (p === 'PROFILE_RETRIEVAL') return 'PROFILE_RETRIEVAL';
  if (p === 'PROFILE_PRONUNCIATION') return 'PROFILE_PRONUNCIATION';
  if (id.startsWith('m3r:')) return 'RETRY_STAGE2';
  if (id.startsWith('m2:')) return 'PROFILE_PRONUNCIATION';
  return p || 'OTHER';
}

function extractModel3Metrics(paths, afterModel2Items, targetSurface = null) {
  const metrics = {
    model3DecisionUnitCount: 0,
    model3AnchorMaskedCount: 0,
    model3ActionableNonAnchorCount: 0,
    model3KeepCount: 0,
    model3RetryCount: 0,
    retryRegionCount: 0,
    stage2RecallInvocationCount: 0,
    stage2RecallNonemptyCount: 0,
    stage2UsefulEvidenceCount: 0,
    stage2TotalCandidateCount: 0,
    stage2CandidateCounts: [],
    stage2TargetHitCount: 0,
    stage2TargetHit: false,
    stage2BaseHit: false,
    stage2DomainOnlyHit: false,
    stage2MultiDomainHit: false,
    outOfBucketDomainRecallCount: 0,
    emptyRetainedDomainAllDomainFallbackCount: 0,
    crossPathDomainLeakCount: 0,
    retryStage2CandidateDropCount: 0,
    retryTargetCandidateDropCount: 0,
    targetSurvivedSharedBudget: false,
    perSpanCapSaturatedCount: 0,
    perSpanMergeCount: 0,
    r1RetryEntered: false,
    r2Stage2Mode: false,
    r3Stage2Returned: false,
    r3Target: false,
    r5TargetSurvivedBudget: false,
    retryDownstreamRecoveryCount: 0,
    profilePronunciationAnchorCount: 0,
    domainAnchorCount: 0,
    profileDomainAnchorCount: 0,
    profileRetrievalAnchorCount: 0,
    totalAnchorCount: 0,
    model3LatencyMsSum: 0,
    retryLatencyMsSum: 0,
    retryExistingPresent: 0,
    retryExistingDroppedPostCap: 0,
    retryExistingSurvived: 0,
    retryProfileDomainPresent: 0,
    retryProfileDomainDropped: 0,
    retryProfilePronunciationPresent: 0,
    profileDomainEnteringRetry: 0,
    profileDomainPostRetrySurvive: 0,
    profileDomainPostRetryDrop: 0,
    profileDomainScoresDropped: [],
    retryScoresLowestSurviving: [],
    candidateCollisionExistingWins: 0,
    profilePronunciationCandidateCount: 0,
    profileDomainCandidateCount: 0,
    profileRetrievalCandidateCount: 0,
    controlNotes: [],
  };

  for (const c of afterModel2Items || []) {
    const cls = inferProvClass(c);
    if (cls === 'PROFILE_PRONUNCIATION') metrics.profilePronunciationCandidateCount += 1;
    if (cls === 'PROFILE_DOMAIN') metrics.profileDomainCandidateCount += 1;
    if (cls === 'PROFILE_RETRIEVAL') metrics.profileRetrievalCandidateCount += 1;
  }

  for (const p of paths || []) {
    const m3 = p?.model3;
    if (!m3) continue;
    const anchors = m3.anchors || [];
    metrics.totalAnchorCount += anchors.length;
    for (const a of anchors) {
      if (a.source === 'MODEL2') metrics.profilePronunciationAnchorCount += 1;
      else if (a.source === 'DOMAIN') metrics.domainAnchorCount += 1;
      else if (a.source === 'DOMAIN_AND_MODEL2') {
        metrics.domainAnchorCount += 1;
        metrics.profileDomainAnchorCount += 1;
      }
    }
    const anchorIds = new Set(anchors.map((a) => a.spanId));
    for (const d of m3.decisions || []) {
      metrics.model3DecisionUnitCount += 1;
      const isAnchor = anchorIds.has(d.spanId) || d.eligible === false;
      if (isAnchor) {
        metrics.model3AnchorMaskedCount += 1;
        continue;
      }
      metrics.model3ActionableNonAnchorCount += 1;
      if (d.decision === 'RETRY') metrics.model3RetryCount += 1;
      else metrics.model3KeepCount += 1;
    }
    metrics.retryRegionCount += (m3.retry_regions || []).length;
    const inv = m3.retry_recall_invocations || [];
    metrics.stage2RecallInvocationCount += inv.length;
    if (inv.length) metrics.r2Stage2Mode = true;
    for (const r of inv) {
      const cands = Array.isArray(r.candidates) ? r.candidates : r.hits || [];
      const n =
        r.candidateCount ??
        r.hitCount ??
        r.returnedCandidateCount ??
        cands.length ??
        0;
      metrics.stage2CandidateCounts.push(n);
      metrics.stage2TotalCandidateCount += n;
      if (n > 0) {
        metrics.stage2RecallNonemptyCount += 1;
        metrics.stage2UsefulEvidenceCount += 1;
        metrics.r3Stage2Returned = true;
      }
      const retained = new Set((r.retainedDomains || []).map(String));
      for (const cand of cands) {
        const surface = cand.surface || cand.word || cand.hotword?.word || '';
        const domains = (cand.domains || []).map(String);
        const src = String(cand.source || '');
        const isBase = /base/i.test(src) || domains.length === 0;
        if (retained.size > 0 && domains.length > 0 && !domains.some((d) => retained.has(d))) {
          metrics.outOfBucketDomainRecallCount += 1;
        }
        if (retained.size === 0 && domains.length > 0 && !isBase) {
          metrics.emptyRetainedDomainAllDomainFallbackCount += 1;
        }
        if (targetSurface && surface === targetSurface) {
          metrics.stage2TargetHit = true;
          metrics.stage2TargetHitCount += 1;
          metrics.r3Target = true;
          if (isBase) metrics.stage2BaseHit = true;
          if (!isBase && domains.length === 1) metrics.stage2DomainOnlyHit = true;
          if (!isBase && domains.length > 1) metrics.stage2MultiDomainHit = true;
        }
      }
    }
    if (!inv.length) {
      for (const a of m3.retry_attempts || []) {
        if (a.attempted && (a.returnedCandidateCount || 0) > 0) {
          metrics.stage2RecallNonemptyCount += 1;
          metrics.stage2UsefulEvidenceCount += 1;
          metrics.r3Stage2Returned = true;
        }
      }
    }
    if (typeof m3.model3_latency_ms === 'number') metrics.model3LatencyMsSum += m3.model3_latency_ms;
    if (typeof m3.retry_path_latency_ms === 'number') metrics.retryLatencyMsSum += m3.retry_path_latency_ms;

    const prov = m3.candidate_provenance;
    const merges = prov?.mergePerSpan || prov?.merge_per_span || [];
    for (const m of merges) {
      const before = m.before || [];
      const after = m.after || [];
      const removed = m.removed || [];
      const afterIds = new Set(after.map((c) => String(c.candidateId)));
      if (before.length) metrics.retryExistingPresent += before.length;
      let survived = 0;
      for (const b of before) {
        const id = String(b.candidateId);
        const cls = inferProvClass(b);
        if (cls === 'PROFILE_DOMAIN') {
          metrics.retryProfileDomainPresent += 1;
          metrics.profileDomainEnteringRetry += 1;
        }
        if (cls === 'PROFILE_PRONUNCIATION') metrics.retryProfilePronunciationPresent += 1;
        if (afterIds.has(id)) {
          survived += 1;
          if (cls === 'PROFILE_DOMAIN') metrics.profileDomainPostRetrySurvive += 1;
        } else {
          metrics.retryExistingDroppedPostCap += 1;
          if (cls === 'PROFILE_DOMAIN') {
            metrics.retryProfileDomainDropped += 1;
            metrics.profileDomainPostRetryDrop += 1;
            metrics.profileDomainScoresDropped.push(Number(b.score || 0));
          }
        }
      }
      metrics.retryExistingSurvived += survived;
      metrics.perSpanMergeCount += 1;
      const cap = Number(m.perSpanCap || m.cap || 0);
      if (cap > 0 && after.length >= cap) metrics.perSpanCapSaturatedCount += 1;
      for (const r of removed) {
        if (r.reason === 'DEDUP_EQUIVALENT') metrics.candidateCollisionExistingWins += 1;
        if (String(r.candidateId || '').startsWith('m3r:')) metrics.retryStage2CandidateDropCount += 1;
        if (targetSurface && (r.surface === targetSurface || r.word === targetSurface)) {
          metrics.retryTargetCandidateDropCount += 1;
        }
      }
      if (targetSurface) {
        const targetInAfter = after.some((x) => x.surface === targetSurface || x.word === targetSurface);
        if (targetInAfter && metrics.stage2TargetHit) {
          metrics.targetSurvivedSharedBudget = true;
          metrics.r5TargetSurvivedBudget = true;
        }
      }
      const survivingRetryScores = after
        .filter((x) => String(x.candidateId || '').startsWith('m3r:'))
        .map((x) => Number(x.score || 0));
      if (survivingRetryScores.length) {
        metrics.retryScoresLowestSurviving.push(Math.min(...survivingRetryScores));
      }
    }
  }

  metrics.r1RetryEntered = metrics.model3RetryCount > 0;
  return metrics;
}

function evaluateRunTrace(caseRow, condition, evidence, pipeData) {
  const runId = `${caseRow.caseId}_${condition}`;
  const targetSurface = caseRow.evaluationTargetSurface || null;
  const isModel2TargetCase = Boolean(caseRow.isModel2TargetCase && targetSurface);

  const emptyM3 = () => ({
    model3DecisionUnitCount: 0,
    model3AnchorMaskedCount: 0,
    model3ActionableNonAnchorCount: 0,
    model3KeepCount: 0,
    model3RetryCount: 0,
    retryRegionCount: 0,
    stage2RecallInvocationCount: 0,
    stage2RecallNonemptyCount: 0,
    stage2UsefulEvidenceCount: 0,
    retryDownstreamRecoveryCount: 0,
    profilePronunciationAnchorCount: 0,
    domainAnchorCount: 0,
    profileDomainAnchorCount: 0,
    profileRetrievalAnchorCount: 0,
    totalAnchorCount: 0,
    model3LatencyMsSum: 0,
    retryLatencyMsSum: 0,
    retryExistingPresent: 0,
    retryExistingDroppedPostCap: 0,
    retryExistingSurvived: 0,
    retryProfileDomainPresent: 0,
    retryProfileDomainDropped: 0,
    retryProfilePronunciationPresent: 0,
    profileDomainEnteringRetry: 0,
    profileDomainPostRetrySurvive: 0,
    profileDomainPostRetryDrop: 0,
    profileDomainScoresDropped: [],
    retryScoresLowestSurviving: [],
    candidateCollisionExistingWins: 0,
    profilePronunciationCandidateCount: 0,
    profileDomainCandidateCount: 0,
    profileRetrievalCandidateCount: 0,
  });

  if (evidence.captureOutcome === 'ASR_EMPTY' || !evidence.rawMergedAsrText) {
    return {
      runId,
      caseId: caseRow.caseId,
      condition,
      runtimeOutcome: 'ASR_EMPTY',
      model2Applicable: false,
      gateA: 'NOT_APPLICABLE',
      gateB: 'NOT_APPLICABLE',
      gateC: 'NOT_APPLICABLE',
      gateD: 'NOT_APPLICABLE',
      gateE: 'NOT_APPLICABLE',
      gateF: 'NOT_APPLICABLE',
      gateG: 'NOT_APPLICABLE',
      gateH: 'NOT_APPLICABLE',
      gateI: 'NOT_APPLICABLE',
      firstFailureOwner: 'ASR_EMPTY',
      targetExpansionAny: false,
      targetRelevantExpansion: false,
      targetLexiconHit: false,
      targetEdgeCreated: false,
      targetEdgeSurvived: false,
      finalRepairCorrect: false,
      extraCandidatesCount: 0,
      m3: emptyM3(),
      pipelineMs: null,
    };
  }

  const pipeExtra = pipeData?.extra || {};
  const paths = Array.isArray(pipeExtra?.dialog200_path_trace)
    ? pipeExtra.dialog200_path_trace
    : pipeExtra?.dialog200_path_trace?.paths || [];

  const afterItems = [];
  for (const p of paths) {
    for (const c of p?.after_model2_candidates?.items || []) afterItems.push(c);
  }
  const m3 = extractModel3Metrics(paths, afterItems, targetSurface);

  const summaries = paths.map((p) => p.model2_summary).filter(Boolean);
  let bestSummary = summaries[0] || null;
  for (const s of summaries) {
    if ((s?.p_retrieval_hit_count || 0) > (bestSummary?.p_retrieval_hit_count || 0)) bestSummary = s;
  }

  const repaired =
    pipeExtra?.repairedText ||
    pipeExtra?.bestSentence ||
    pipeExtra?.kenlmBest ||
    pipeExtra?.finalText ||
    null;
  const finalText =
    repaired || pipeExtra?.spanAssemblyV4?.bestSentence || pipeExtra?.assemblyBest || pipeData?.text_asr || '';
  const finalCorrect = targetSurface
    ? typeof finalText === 'string' && finalText.includes(targetSurface)
    : false;

  if (m3.model3RetryCount > 0 && finalCorrect) {
    m3.retryDownstreamRecoveryCount = 1;
  }

  const pipelineMs =
    pipeExtra?.fw_detector_step_ms ??
    pipeExtra?.pipeline_ms ??
    pipeData?.pipeline_ms ??
    null;

  if (!isModel2TargetCase) {
    return {
      runId,
      caseId: caseRow.caseId,
      condition,
      runtimeOutcome: 'CLEAN_OR_CONTROL',
      model2Applicable: false,
      gateA: 'NOT_APPLICABLE',
      gateB: 'NOT_APPLICABLE',
      gateC: 'NOT_APPLICABLE',
      gateD: 'NOT_APPLICABLE',
      gateE: 'NOT_APPLICABLE',
      gateF: 'NOT_APPLICABLE',
      gateG: 'NOT_APPLICABLE',
      gateH: 'NOT_APPLICABLE',
      gateI: finalCorrect ? 'PASS' : 'FAIL',
      firstFailureOwner: 'SUCCESS',
      targetExpansionAny: false,
      targetRelevantExpansion: false,
      targetLexiconHit: false,
      targetEdgeCreated: false,
      targetEdgeSurvived: false,
      finalRepairCorrect: finalCorrect,
      extraCandidatesCount:
        (bestSummary?.p_materialized_count || 0) + (bestSummary?.d_materialized_count || 0),
      m3,
      pipelineMs,
      finalTextSample: typeof finalText === 'string' ? finalText.slice(0, 100) : '',
    };
  }

  const targetLen = [...targetSurface].length;
  const targetWindows = findTargetWindows(paths, targetSurface, targetLen);
  const gateA = targetWindows.length > 0 ? 'PASS' : 'FAIL';

  let gateB = 'FAIL';
  let chosen = targetWindows.find((t) => t.entry?.p_retrieval?.status === 'EXECUTED') || targetWindows[0];

  if (condition === 'NO_PROFILE') {
    gateB = 'NOT_APPLICABLE_NO_PROFILE';
  } else if (gateA === 'PASS' && chosen) {
    const raw = chosen.entry?.model2_raw || {};
    const selectedActions = raw.p_selected_actions || bestSummary?.selected_actions || [];
    if (bestSummary?.load_failed || bestSummary?.inference_failed) {
      gateB = 'FAIL';
    } else if (!selectedActions.length) {
      gateB = condition === 'WRONG_PROFILE' ? 'PASS_NO_ACTION' : 'FAIL';
    } else {
      const rels = caseRow.relationFamily ? [caseRow.relationFamily] : [];
      const expectedRelationSelected = selectedActions.some((a) =>
        rels.some((r) => actionHasRelation(a, r))
      );
      gateB = condition === 'CORRECT_PROFILE' ? (expectedRelationSelected ? 'PASS' : 'FAIL') : 'PASS';
    }
  }

  let gateC = 'FAIL';
  const queries = chosen?.entry?.p_retrieval?.queries || [];
  if (condition === 'NO_PROFILE') gateC = 'NOT_APPLICABLE_NO_PROFILE';
  else if (gateA === 'PASS' && gateB === 'PASS') {
    gateC = queries.find((q) => Array.isArray(q.query) && q.query.length === targetLen) ? 'PASS' : 'FAIL';
  }

  let gateD = 'FAIL';
  const tonePat =
    chosen?.entry?.p_retrieval?.window_local_tone_pattern ||
    chosen?.entry?.p_retrieval?.fineSpan_local_tone_pattern ||
    chosen?.win?.tone_representation ||
    null;
  const toneSource = chosen?.entry?.p_retrieval?.tone_pattern_source || null;
  const toneReady = Array.isArray(tonePat) && tonePat.length > 0;
  const toneLenOk = toneReady && tonePat.length === targetLen;
  const toneValidSource = !toneSource || toneSource === 'WINDOW_LOCAL' || toneSource === 'FINESPAN_LOCAL';
  if (condition === 'NO_PROFILE') gateD = 'NOT_APPLICABLE_NO_PROFILE';
  else if (gateA === 'PASS' && gateB === 'PASS' && gateC === 'PASS') {
    gateD = toneReady && toneLenOk && toneValidSource ? 'PASS' : 'FAIL';
  }

  let gateE = 'FAIL';
  let targetLexiconHit = false;
  if (condition === 'NO_PROFILE') gateE = 'NOT_APPLICABLE_NO_PROFILE';
  else if (gateA === 'PASS' && gateB === 'PASS' && gateC === 'PASS' && gateD === 'PASS') {
    for (const q of queries) {
      if (!Array.isArray(q.query) || q.query.length !== targetLen) continue;
      for (const h of q.hits || []) {
        if (
          h.surface === targetSurface ||
          (h.termId && (caseRow.evaluationTargetTermIds || []).includes(h.termId))
        ) {
          targetLexiconHit = true;
          break;
        }
      }
      if (targetLexiconHit) break;
    }
    gateE = targetLexiconHit ? 'PASS' : 'FAIL';
  }

  let gateF = 'FAIL';
  if (condition === 'NO_PROFILE') gateF = 'NOT_APPLICABLE_NO_PROFILE';
  else if (gateE === 'PASS') {
    for (const p of paths) {
      const after = p?.after_model2_candidates?.items || [];
      for (const c of after) {
        if (
          c.surface === targetSurface ||
          (c.termId && (caseRow.evaluationTargetTermIds || []).includes(c.termId))
        ) {
          if (
            c.provenance === 'PROFILE_PRONUNCIATION' ||
            c.provenance === 'PROFILE_RETRIEVAL' ||
            c.alsoProfile
          ) {
            gateF = 'PASS';
            break;
          }
        }
      }
      if (gateF === 'PASS') break;
      const introduced = p?.model2_summary?.introduced_term_ids || [];
      if (introduced.some((id) => (caseRow.evaluationTargetTermIds || []).includes(id))) {
        gateF = 'PASS';
        break;
      }
    }
  }

  let gateG = 'FAIL';
  let survivesSeg = false;
  if (condition === 'NO_PROFILE') gateG = 'NOT_APPLICABLE_NO_PROFILE';
  else if (gateF === 'PASS') {
    for (const p of paths) {
      const finespans = p?.finespans || [];
      for (const fs of finespans) {
        const text = fs.source_text || '';
        const sylLen =
          typeof fs.syllable_end === 'number' && typeof fs.syllable_start === 'number'
            ? fs.syllable_end - fs.syllable_start
            : text.length;
        if (sylLen !== targetLen) continue;
        if (text === targetSurface) {
          gateG = 'PASS';
          survivesSeg = true;
          break;
        }
      }
      if (gateG === 'PASS') break;
      const after = p?.after_model2_candidates?.items || [];
      const geomHit = after.find(
        (c) =>
          (c.surface === targetSurface ||
            (c.termId && (caseRow.evaluationTargetTermIds || []).includes(c.termId))) &&
          typeof c.syllableStart === 'number' &&
          c.syllableEnd - c.syllableStart === targetLen
      );
      if (geomHit) {
        gateG = 'PASS';
        survivesSeg = finespans.some(
          (fs) => fs.syllable_start === geomHit.syllableStart && fs.syllable_end === geomHit.syllableEnd
        );
        break;
      }
    }
  }

  let gateH = 'FAIL';
  if (condition === 'NO_PROFILE') gateH = 'NOT_APPLICABLE_NO_PROFILE';
  else if (gateG === 'PASS') gateH = survivesSeg ? 'PASS' : 'FAIL';

  const gateI = finalCorrect ? 'PASS' : 'FAIL';

  let firstFailureOwner = 'SUCCESS';
  if (condition === 'NO_PROFILE') {
    firstFailureOwner = finalCorrect ? 'SUCCESS' : 'NO_PROFILE_BASE_REPAIR_FAIL';
  } else if (gateA !== 'PASS') firstFailureOwner = 'WINDOW_REACHABILITY';
  else if (gateB !== 'PASS' && gateB !== 'PASS_NO_ACTION') {
    firstFailureOwner =
      bestSummary?.load_failed || bestSummary?.inference_failed ? 'MODEL2_RUNTIME' : 'MODEL2_ACTION';
  } else if (gateC !== 'PASS') firstFailureOwner = 'RELATION_TRANSFORM';
  else if (gateD !== 'PASS') firstFailureOwner = 'TONE_QUERY';
  else if (gateE !== 'PASS') firstFailureOwner = 'LEXICON_RECALL';
  else if (gateF !== 'PASS') firstFailureOwner = 'CANDIDATE_MATERIALIZATION';
  else if (gateG !== 'PASS') firstFailureOwner = 'LEXICAL_EDGE';
  else if (gateH !== 'PASS') firstFailureOwner = 'SEGMENTATION';
  else if (gateI !== 'PASS') {
    if (m3.stage2TargetHit && !m3.targetSurvivedSharedBudget && m3.perSpanMergeCount > 0) {
      firstFailureOwner = 'RETRY_BUDGET';
    } else if (m3.stage2TargetHit && m3.targetSurvivedSharedBudget) {
      firstFailureOwner = 'KENLM';
    } else if (m3.model3RetryCount > 0 && m3.stage2UsefulEvidenceCount === 0) {
      firstFailureOwner = 'MODEL3_RETRY_STAGE2_RECALL';
    } else if (m3.retryExistingDroppedPostCap > 0 && m3.retryExistingSurvived === 0) {
      firstFailureOwner = 'RETRY_BUDGET';
    } else if (m3.model3RetryCount === 0 && m3.model3ActionableNonAnchorCount > 0) {
      firstFailureOwner = 'MODEL3_KEEP';
    } else firstFailureOwner = 'DOWNSTREAM';
  } else firstFailureOwner = 'SUCCESS';

  return {
    runId,
    caseId: caseRow.caseId,
    condition,
    runtimeOutcome: 'EVALUATED',
    model2Applicable: true,
    gateA,
    gateB,
    gateC,
    gateD,
    gateE,
    gateF,
    gateG,
    gateH,
    gateI,
    firstFailureOwner,
    targetExpansionAny: (bestSummary?.p_retrieval_hit_count || 0) > 0,
    targetRelevantExpansion: gateC === 'PASS',
    targetLexiconHit: gateE === 'PASS',
    targetEdgeCreated: gateG === 'PASS',
    targetEdgeSurvived: gateH === 'PASS',
    finalRepairCorrect: finalCorrect,
    finalTextSample: typeof finalText === 'string' ? finalText.slice(0, 100) : '',
    extraCandidatesCount:
      (bestSummary?.p_materialized_count || 0) + (bestSummary?.d_materialized_count || 0),
    m3,
    pipelineMs,
  };
}

function sumM3(results, key) {
  return results.reduce((s, r) => s + (r.m3?.[key] || 0), 0);
}

function percentile(arr, p) {
  const a = arr.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * (a.length - 1))));
  return a[i];
}

function aggregate(allCases, allResults) {
  const validity = validatePilotCompleteness(allCases, allResults);
  const byCond = { NO_PROFILE: [], CORRECT_PROFILE: [], WRONG_PROFILE: [] };
  for (const r of allResults) byCond[r.condition]?.push(r);

  const gateMetrics = {};
  for (const g of ['gateA', 'gateB', 'gateC', 'gateD', 'gateE', 'gateF', 'gateG', 'gateH', 'gateI']) {
    let applicable = 0;
    let pass = 0;
    for (const r of allResults) {
      const v = r[g];
      if (!v || String(v).startsWith('NOT_APPLICABLE')) continue;
      applicable += 1;
      if (v === 'PASS' || v === 'PASS_NO_ACTION') pass += 1;
    }
    const prev = PREV_BASELINE.gates[g];
    gateMetrics[g] = {
      applicable,
      pass,
      fail: applicable - pass,
      passRate: applicable ? pass / applicable : null,
      previous: prev,
      absoluteDeltaPass: prev ? pass - prev.pass : null,
      rateDelta: prev && applicable ? pass / applicable - prev.passRate : null,
    };
  }

  const owners = {};
  for (const r of allResults) {
    owners[r.firstFailureOwner] = (owners[r.firstFailureOwner] || 0) + 1;
  }

  const finalByCond = {};
  const condTable = {};
  for (const cond of CONDITIONS) {
    const rows = byCond[cond];
    const finalCorrect = rows.filter((r) => r.finalRepairCorrect).length;
    finalByCond[cond] = finalCorrect;
    condTable[cond] = {
      finalCorrect,
      finalCorrectRate: finalCorrect / 200,
      pActionApprox: rows.filter((r) => r.targetRelevantExpansion).length,
      lexiconHit: rows.filter((r) => r.targetLexiconHit).length,
      lexicalEdge: rows.filter((r) => r.targetEdgeCreated).length,
      anchorCount: sumM3(rows, 'totalAnchorCount'),
      profilePronunciationAnchorCount: sumM3(rows, 'profilePronunciationAnchorCount'),
      model3Actionable: sumM3(rows, 'model3ActionableNonAnchorCount'),
      keep: sumM3(rows, 'model3KeepCount'),
      retry: sumM3(rows, 'model3RetryCount'),
      stage2Useful: sumM3(rows, 'stage2UsefulEvidenceCount'),
      retryRecovery: sumM3(rows, 'retryDownstreamRecoveryCount'),
      existingDrop: sumM3(rows, 'retryExistingDroppedPostCap'),
      profileDomainCandidates: sumM3(rows, 'profileDomainCandidateCount'),
      profilePronunciationCandidates: sumM3(rows, 'profilePronunciationCandidateCount'),
      extraCandidates: rows.reduce((s, r) => s + (r.extraCandidatesCount || 0), 0),
    };
  }

  const prevMap = new Map();
  if (fs.existsSync(PREV_TRACE_PATH)) {
    for (const line of fs.readFileSync(PREV_TRACE_PATH, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const row = JSON.parse(line);
        if (row.runId) prevMap.set(row.runId, row);
      } catch (_) {}
    }
  }

  const changed = [];
  for (const r of allResults) {
    const prev = prevMap.get(r.runId);
    if (!prev) continue;
    if (Boolean(prev.finalRepairCorrect) === Boolean(r.finalRepairCorrect)) continue;
    changed.push({
      caseId: r.caseId,
      condition: r.condition,
      previousFinalCorrect: Boolean(prev.finalRepairCorrect),
      currentFinalCorrect: Boolean(r.finalRepairCorrect),
      change: r.finalRepairCorrect ? 'IMPROVED' : 'REGRESSED',
      first_changed_stage: r.firstFailureOwner,
      current_first_failure_owner: r.firstFailureOwner,
      key_trace_reason: r.firstFailureOwner,
      Anchor_involved: (r.m3?.totalAnchorCount || 0) > 0 ? 'YES' : 'NO',
      Retry_involved: (r.m3?.model3RetryCount || 0) > 0 ? 'YES' : 'NO',
      Retry_budget_displacement_involved:
        (r.m3?.retryExistingDroppedPostCap || 0) > 0 ? 'YES' : 'NO',
      Model2_P_involved: (r.m3?.profilePronunciationCandidateCount || 0) > 0 ? 'YES' : 'NO',
      Model2_D_involved: (r.m3?.profileDomainCandidateCount || 0) > 0 ? 'YES' : 'NO',
    });
  }

  const existingPresent = sumM3(allResults, 'retryExistingPresent');
  const existingDropped = sumM3(allResults, 'retryExistingDroppedPostCap');
  const existingSurvived = sumM3(allResults, 'retryExistingSurvived');

  const latencies = allResults.map((r) => r.pipelineMs).filter((x) => typeof x === 'number');

  const summary = {
    phase: 'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE',
    date: new Date().toISOString().slice(0, 10),
    dataset: 'LINGUA_DIALOG2000_V2_PILOT200',
    baselineComparison: 'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE',
    remeasureValidity: validity.isValid ? 'PASS' : 'FAIL',
    validityReason: validity.reason,
    uniqueCases: 200,
    totalRuns: allResults.length,
    conditionRuns: {
      NO_PROFILE: byCond.NO_PROFILE.length,
      CORRECT_PROFILE: byCond.CORRECT_PROFILE.length,
      WRONG_PROFILE: byCond.WRONG_PROFILE.length,
    },
    finalRepair: {
      NO_PROFILE: finalByCond.NO_PROFILE,
      CORRECT_PROFILE: finalByCond.CORRECT_PROFILE,
      WRONG_PROFILE: finalByCond.WRONG_PROFILE,
      correctVsNoDelta: finalByCond.CORRECT_PROFILE - finalByCond.NO_PROFILE,
      wrongVsNoDelta: finalByCond.WRONG_PROFILE - finalByCond.NO_PROFILE,
      correctVsWrongDelta: finalByCond.CORRECT_PROFILE - finalByCond.WRONG_PROFILE,
      previous: PREV_BASELINE.final,
    },
    gateMetrics,
    firstFailureOwnerCounts: owners,
    conditionTable: condTable,
    profileContrast: {
      correctVsNoProfile: {
        finalRepairDelta: finalByCond.CORRECT_PROFILE - finalByCond.NO_PROFILE,
        targetActionDelta: condTable.CORRECT_PROFILE.pActionApprox - condTable.NO_PROFILE.pActionApprox,
        targetLexiconHitDelta: condTable.CORRECT_PROFILE.lexiconHit - condTable.NO_PROFILE.lexiconHit,
        targetEdgeDelta: condTable.CORRECT_PROFILE.lexicalEdge - condTable.NO_PROFILE.lexicalEdge,
        retryDelta: condTable.CORRECT_PROFILE.retry - condTable.NO_PROFILE.retry,
        stage2UsefulDelta: condTable.CORRECT_PROFILE.stage2Useful - condTable.NO_PROFILE.stage2Useful,
        candidateDropDelta: condTable.CORRECT_PROFILE.existingDrop - condTable.NO_PROFILE.existingDrop,
        previousFinalDelta: PREV_BASELINE.contrast.correctVsNo.finalRepairDelta,
      },
      wrongVsNoProfile: {
        finalRepairDelta: finalByCond.WRONG_PROFILE - finalByCond.NO_PROFILE,
        extraExpansionCount: condTable.WRONG_PROFILE.extraCandidates,
        previousExtraExpansionCount: PREV_BASELINE.contrast.wrongVsNo.extraExpansionCount,
        retryDelta: condTable.WRONG_PROFILE.retry - condTable.NO_PROFILE.retry,
        candidateDropDelta: condTable.WRONG_PROFILE.existingDrop - condTable.NO_PROFILE.existingDrop,
      },
      correctVsWrong: {
        finalRepairDelta: finalByCond.CORRECT_PROFILE - finalByCond.WRONG_PROFILE,
        retryDelta: condTable.CORRECT_PROFILE.retry - condTable.WRONG_PROFILE.retry,
      },
    },
    anchorAuthority: {
      profilePronunciationAnchorCount: sumM3(allResults, 'profilePronunciationAnchorCount'),
      domainAnchorCount: sumM3(allResults, 'domainAnchorCount'),
      profileDomainAnchorCount: sumM3(allResults, 'profileDomainAnchorCount'),
      profileRetrievalAnchorCount: sumM3(allResults, 'profileRetrievalAnchorCount'),
      totalAnchorCount: sumM3(allResults, 'totalAnchorCount'),
    },
    model3Exposure: {
      decisionUnits: sumM3(allResults, 'model3DecisionUnitCount'),
      anchorMasked: sumM3(allResults, 'model3AnchorMaskedCount'),
      actionable: sumM3(allResults, 'model3ActionableNonAnchorCount'),
      keep: sumM3(allResults, 'model3KeepCount'),
      retry: sumM3(allResults, 'model3RetryCount'),
      retryRate:
        sumM3(allResults, 'model3KeepCount') + sumM3(allResults, 'model3RetryCount') > 0
          ? sumM3(allResults, 'model3RetryCount') /
            (sumM3(allResults, 'model3KeepCount') + sumM3(allResults, 'model3RetryCount'))
          : null,
      retryRegions: sumM3(allResults, 'retryRegionCount'),
      stage2Invocations: sumM3(allResults, 'stage2RecallInvocationCount'),
      stage2Nonempty: sumM3(allResults, 'stage2RecallNonemptyCount'),
      stage2Useful: sumM3(allResults, 'stage2UsefulEvidenceCount'),
      stage2TotalCandidates: sumM3(allResults, 'stage2TotalCandidateCount'),
      stage2TargetHits: allResults.filter((r) => r.m3?.stage2TargetHit).length,
      stage2TargetHitInvocationCount: sumM3(allResults, 'stage2TargetHitCount'),
      retryDownstreamRecovery: sumM3(allResults, 'retryDownstreamRecoveryCount'),
      outOfBucketDomainRecallCount: sumM3(allResults, 'outOfBucketDomainRecallCount'),
      emptyRetainedDomainAllDomainFallbackCount: sumM3(
        allResults,
        'emptyRetainedDomainAllDomainFallbackCount'
      ),
      crossPathDomainLeakCount: sumM3(allResults, 'crossPathDomainLeakCount'),
      retryStage2CandidateDropCount: sumM3(allResults, 'retryStage2CandidateDropCount'),
      retryTargetCandidateDropCount: sumM3(allResults, 'retryTargetCandidateDropCount'),
      perSpanCapSaturationRate: (() => {
        const merges = sumM3(allResults, 'perSpanMergeCount');
        const sat = sumM3(allResults, 'perSpanCapSaturatedCount');
        return merges ? sat / merges : null;
      })(),
      stage2CandidatesPerInvocation: (() => {
        const counts = allResults.flatMap((r) => r.m3?.stage2CandidateCounts || []);
        return {
          median: percentile(counts, 50),
          p95: percentile(counts, 95),
          max: counts.length ? Math.max(...counts) : 0,
        };
      })(),
      previousStage2Useful: 'NOT_COMPARABLE_OBSERVABILITY_DEFECT',
    },
    retryFunnel: {
      R1_retry_entered: allResults.filter((r) => r.m3?.r1RetryEntered).length,
      R2_stage2_mode: allResults.filter((r) => r.m3?.r2Stage2Mode).length,
      R3_stage2_returned: allResults.filter((r) => r.m3?.r3Stage2Returned).length,
      R3_target: allResults.filter((r) => r.m3?.r3Target).length,
      R5_target_survived_budget: allResults.filter((r) => r.m3?.r5TargetSurvivedBudget).length,
      R8_final_correct_with_retry: allResults.filter(
        (r) => r.m3?.r1RetryEntered && r.finalRepairCorrect
      ).length,
    },
    domainSafety: {
      DOMAIN_ONLY_STAGE2_HITS: allResults.filter((r) => r.m3?.stage2DomainOnlyHit).length,
      BASE_STAGE2_HITS: allResults.filter((r) => r.m3?.stage2BaseHit).length,
      MULTI_DOMAIN_STAGE2_HITS: allResults.filter((r) => r.m3?.stage2MultiDomainHit).length,
      OUT_OF_BUCKET_DOMAIN_RECALL_COUNT: sumM3(allResults, 'outOfBucketDomainRecallCount'),
      EMPTY_RETAINED_DOMAIN_ALL_DOMAIN_FALLBACK_COUNT: sumM3(
        allResults,
        'emptyRetainedDomainAllDomainFallbackCount'
      ),
      CROSS_PATH_DOMAIN_LEAK_COUNT: sumM3(allResults, 'crossPathDomainLeakCount'),
    },
    freezeId: 'LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1',
    RETRY_BUDGET_POLICY_CHANGE: 'NO',
    PRODUCT_CODE_CHANGE_DURING_PILOT: 'NO',
    retryBudget: {
      existingPresent: existingPresent,
      existingDroppedPostCap: existingDropped,
      existingSurvived: existingSurvived,
      survivalRate: existingPresent ? existingSurvived / existingPresent : null,
      profileDomainPresent: sumM3(allResults, 'retryProfileDomainPresent'),
      profileDomainDropped: sumM3(allResults, 'retryProfileDomainDropped'),
      profilePronunciationPresent: sumM3(allResults, 'retryProfilePronunciationPresent'),
      collisionExistingWins: sumM3(allResults, 'candidateCollisionExistingWins'),
      profileDomainEnteringRetry: sumM3(allResults, 'profileDomainEnteringRetry'),
      profileDomainPostRetrySurvive: sumM3(allResults, 'profileDomainPostRetrySurvive'),
      profileDomainPostRetryDrop: sumM3(allResults, 'profileDomainPostRetryDrop'),
    },
    profileCandidates: {
      pronunciation: sumM3(allResults, 'profilePronunciationCandidateCount'),
      domain: sumM3(allResults, 'profileDomainCandidateCount'),
      retrieval: sumM3(allResults, 'profileRetrievalCandidateCount'),
    },
    changedCaseCount: changed.length,
    improvedCaseCount: changed.filter((x) => x.change === 'IMPROVED').length,
    regressedCaseCount: changed.filter((x) => x.change === 'REGRESSED').length,
    performance: {
      pipeline_p50: percentile(latencies, 50),
      pipeline_p95: percentile(latencies, 95),
      sampleCount: latencies.length,
      status: latencies.length
        ? percentile(latencies, 95) != null && percentile(latencies, 95) > 3000
          ? 'WARNING'
          : 'PASS'
        : 'NOT_COMPARABLE',
    },
    deferredFineSpanBoundaryCaseCount: null,
    productCodeChangeThisRound: 'NO',
  };

  // Dominant owner: prefer earliest causal among profile-applicable fails
  const ownerPriority = [
    'ASR_EMPTY',
    'WINDOW_REACHABILITY',
    'MODEL2_ACTION',
    'MODEL2_RUNTIME',
    'RELATION_TRANSFORM',
    'TONE_QUERY',
    'LEXICON_RECALL',
    'CANDIDATE_MATERIALIZATION',
    'LEXICAL_EDGE',
    'SEGMENTATION',
    'MODEL3_RETRY_NO_USEFUL_STAGE2',
    'RETRY_BUDGET_DISPLACEMENT',
    'DOWNSTREAM',
    'NO_PROFILE_BASE_REPAIR_FAIL',
  ];
  let dominant = 'MULTI_OWNER_NO_DOMINANT';
  const applicableOwners = Object.entries(owners).filter(
    ([k]) => k !== 'SUCCESS' && k !== 'ASR_EMPTY'
  );
  if (applicableOwners.length) {
    applicableOwners.sort((a, b) => b[1] - a[1]);
    const top = applicableOwners[0];
    const second = applicableOwners[1];
    if (!second || top[1] >= second[1] * 1.25) dominant = top[0];
    else {
      // prefer earliest causal if counts close
      for (const o of ownerPriority) {
        if (owners[o] && owners[o] >= top[1] * 0.5) {
          dominant = o;
          break;
        }
      }
    }
  }
  summary.dominantFailureOwner = dominant;

  const hypothesis =
    summary.finalRepair.correctVsNoDelta > PREV_BASELINE.contrast.correctVsNo.finalRepairDelta
      ? 'PARTIALLY_SUPPORTED'
      : summary.finalRepair.correctVsNoDelta > 0
        ? 'PARTIALLY_SUPPORTED'
        : summary.profileContrast.correctVsNoProfile.targetLexiconHitDelta > 0
          ? 'PARTIALLY_SUPPORTED'
          : 'INCONCLUSIVE';
  summary.model2Hypothesis = hypothesis;

  let oneNextOwner = 'PILOT200_RESULT_FREEZE_OWNER';
  let oneNextDelta =
    'Freeze Pilot200 post-Anchor-ACP remeasure results and decide next architecture delta from dominant owner evidence.';
  if (dominant === 'LEXICON_RECALL') {
    oneNextOwner = 'LEXICON_RECALL_OWNER';
    oneNextDelta = 'Investigate lexicon recall key/coverage blocking CORRECT_PROFILE P→hit conversion; no Anchor/Retry redesign.';
  } else if (dominant === 'TONE_QUERY') {
    oneNextOwner = 'TONE_QUERY_OWNER';
    oneNextDelta = 'Investigate FineSpan-local tone query failures under CORRECT_PROFILE; tone_bias remains deferred.';
  } else if (dominant === 'RELATION_TRANSFORM') {
    oneNextOwner = 'MODEL2_RELATION_OWNER';
    oneNextDelta = 'Audit relation transform reachability under CORRECT_PROFILE; global application remains intentional.';
  } else if (dominant === 'MODEL2_ACTION') {
    oneNextOwner = 'MODEL2_RELATION_OWNER';
    oneNextDelta = 'Audit Model2 action selection under CORRECT_PROFILE.';
  } else if (dominant === 'MODEL3_RETRY_NO_USEFUL_STAGE2') {
    oneNextOwner = 'STAGE2_RECALL_OWNER';
    oneNextDelta = 'Audit Stage-2 recall usefulness after increased Model3 exposure.';
  } else if (dominant === 'RETRY_BUDGET_DISPLACEMENT') {
    oneNextOwner = 'RETRY_SCORE_CONTRACT_OWNER';
    oneNextDelta =
      'Audit whether PROFILE_DOMAIN prior_score vs lexicon score systematically displaces useful evidence; no reserved Domain budget without ACP.';
  } else if (dominant === 'MULTI_OWNER_NO_DOMINANT') {
    oneNextOwner = 'PILOT200_RESULT_FREEZE_OWNER';
  }
  summary.oneNextOwner = oneNextOwner;
  summary.oneNextDelta = oneNextDelta;

  return { summary, changed, owners, gateMetrics, validity };
}

function writeArtifacts(bundle, allResults, allCases) {
  const { summary, changed, owners, gateMetrics, validity } = bundle;

  const e5Path = path.join(OUT_DIR, 'LINGUA_STAGE2_TONE_RELAX_E5_TARGETED_RESULT.json');
  let e5Ids = new Set();
  if (fs.existsSync(e5Path)) {
    try {
      const e5 = JSON.parse(fs.readFileSync(e5Path, 'utf8'));
      e5Ids = new Set((e5.cases || []).map((row) => row.caseId));
    } catch (_) {}
  }
  const e5Rows = allResults.filter(
    (r) => e5Ids.has(r.caseId) && r.condition === 'CORRECT_PROFILE'
  );
  summary.e5Cohort = {
    E5_CASE_COUNT: e5Ids.size || 35,
    E5_MEASURED_RUNS: e5Rows.length,
    E5_MODEL3_RETRY_ENTERED: e5Rows.filter((r) => r.m3?.r1RetryEntered).length,
    E5_STAGE2_RECOVERY_MODE: e5Rows.filter((r) => r.m3?.r2Stage2Mode).length,
    E5_STAGE2_TARGET_HIT: e5Rows.filter((r) => r.m3?.stage2TargetHit).length,
    E5_TARGET_SURVIVES_SHARED_BUDGET: e5Rows.filter((r) => r.m3?.r5TargetSurvivedBudget).length,
    E5_REACHES_SAMEDOMAIN_ASSEMBLY: e5Rows.filter((r) => r.m3?.r5TargetSurvivedBudget).length,
    E5_REACHES_KENLM: e5Rows.filter((r) => r.m3?.r5TargetSurvivedBudget).length,
    E5_FINAL_CORRECT: e5Rows.filter((r) => r.finalRepairCorrect).length,
  };

  const funnelPath = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_RETRY_FUNNEL.json');
  fs.writeFileSync(
    funnelPath,
    JSON.stringify(
      {
        phase: summary.phase,
        freezeId: summary.freezeId,
        global: summary.retryFunnel,
        stage2: summary.model3Exposure,
        domainSafety: summary.domainSafety,
        e5: summary.e5Cohort,
      },
      null,
      2
    ),
    'utf8'
  );

  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(
    GATE_MATRIX_PATH,
    JSON.stringify(
      {
        phase: summary.phase,
        gates: gateMetrics,
        previousBaseline: PREV_BASELINE.gates,
        conditionTable: summary.conditionTable,
        profileContrast: summary.profileContrast,
        domainSafety: summary.domainSafety,
        e5Cohort: summary.e5Cohort,
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    FAILURE_OWNER_PATH,
    JSON.stringify(
      {
        phase: summary.phase,
        current: owners,
        previous: PREV_BASELINE.owners,
        dominantFailureOwner: summary.dominantFailureOwner,
        deltas: Object.fromEntries(
          [...new Set([...Object.keys(owners), ...Object.keys(PREV_BASELINE.owners)])].map((k) => [
            k,
            (owners[k] || 0) - (PREV_BASELINE.owners[k] || 0),
          ])
        ),
      },
      null,
      2
    ),
    'utf8'
  );

  const csvHeader = [
    'caseId',
    'condition',
    'previousFinalCorrect',
    'currentFinalCorrect',
    'change',
    'first_changed_stage',
    'current_first_failure_owner',
    'key_trace_reason',
    'Anchor_involved',
    'Retry_involved',
    'Retry_budget_displacement_involved',
    'Model2_P_involved',
    'Model2_D_involved',
  ].join(',');
  const csvLines = [csvHeader];
  for (const c of changed) {
    csvLines.push(
      [
        c.caseId,
        c.condition,
        c.previousFinalCorrect ? 1 : 0,
        c.currentFinalCorrect ? 1 : 0,
        c.change,
        c.first_changed_stage,
        c.current_first_failure_owner,
        c.key_trace_reason,
        c.Anchor_involved,
        c.Retry_involved,
        c.Retry_budget_displacement_involved,
        c.Model2_P_involved,
        c.Model2_D_involved,
      ].join(',')
    );
  }
  fs.writeFileSync(CHANGED_CASES_PATH, csvLines.join('\n'), 'utf8');

  const s = summary;
  const g = (name) => s.gateMetrics[name];
  const report = `# LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE_REPORT

| Field | Value |
|---|---|
| Date | ${s.date} |
| Mode | MEASURE_ONLY / FROZEN_ARCHITECTURE |
| Dataset | LINGUA_DIALOG2000_V2_PILOT200 |
| Baseline | POST_PRE_EDGE_RESTORE_FULL_REMEASURE |
| Remeasure validity | **${s.remeasureValidity}** |
| Dominant failure owner | **${s.dominantFailureOwner}** |
| ONE_NEXT_OWNER | **${s.oneNextOwner}** |

## 1. Final repair vs previous baseline

| Condition | Current | Previous | Δ |
|---|---:|---:|---:|
| NO_PROFILE | ${s.finalRepair.NO_PROFILE} / 200 | 22 / 200 | ${s.finalRepair.NO_PROFILE - 22} |
| CORRECT_PROFILE | ${s.finalRepair.CORRECT_PROFILE} / 200 | 26 / 200 | ${s.finalRepair.CORRECT_PROFILE - 26} |
| WRONG_PROFILE | ${s.finalRepair.WRONG_PROFILE} / 200 | 22 / 200 | ${s.finalRepair.WRONG_PROFILE - 22} |
| CORRECT − NO | ${s.finalRepair.correctVsNoDelta} | +4 | ${s.finalRepair.correctVsNoDelta - 4} |
| WRONG − NO | ${s.finalRepair.wrongVsNoDelta} | 0 | ${s.finalRepair.wrongVsNoDelta} |

## 2. Gates A–I (current vs previous)

| Gate | Current | Previous | Abs Δ pass | Rate Δ |
|---|---|---|---:|---:|
| A | ${g('gateA').pass}/${g('gateA').applicable} | 471/471 | ${g('gateA').absoluteDeltaPass} | ${(g('gateA').rateDelta ?? 0).toFixed(4)} |
| B | ${g('gateB').pass}/${g('gateB').applicable} | 261/314 | ${g('gateB').absoluteDeltaPass} | ${(g('gateB').rateDelta ?? 0).toFixed(4)} |
| C | ${g('gateC').pass}/${g('gateC').applicable} | 226/314 | ${g('gateC').absoluteDeltaPass} | ${(g('gateC').rateDelta ?? 0).toFixed(4)} |
| D | ${g('gateD').pass}/${g('gateD').applicable} | 161/314 | ${g('gateD').absoluteDeltaPass} | ${(g('gateD').rateDelta ?? 0).toFixed(4)} |
| E | ${g('gateE').pass}/${g('gateE').applicable} | 3/314 | ${g('gateE').absoluteDeltaPass} | ${(g('gateE').rateDelta ?? 0).toFixed(4)} |
| F | ${g('gateF').pass}/${g('gateF').applicable} | 3/314 | ${g('gateF').absoluteDeltaPass} | ${(g('gateF').rateDelta ?? 0).toFixed(4)} |
| G | ${g('gateG').pass}/${g('gateG').applicable} | 3/314 | ${g('gateG').absoluteDeltaPass} | ${(g('gateG').rateDelta ?? 0).toFixed(4)} |
| H | ${g('gateH').pass}/${g('gateH').applicable} | 3/314 | ${g('gateH').absoluteDeltaPass} | ${(g('gateH').rateDelta ?? 0).toFixed(4)} |
| I | ${g('gateI').pass}/${g('gateI').applicable} | 70/597 | ${g('gateI').absoluteDeltaPass} | ${(g('gateI').rateDelta ?? 0).toFixed(4)} |

## 3. Anchor authority verification

| Metric | Value |
|---|---:|
| PROFILE_PRONUNCIATION Anchor | ${s.anchorAuthority.profilePronunciationAnchorCount} |
| Domain Anchor | ${s.anchorAuthority.domainAnchorCount} (expect 0) |
| PROFILE_DOMAIN Anchor | ${s.anchorAuthority.profileDomainAnchorCount} (expect 0) |
| PROFILE_RETRIEVAL Anchor | ${s.anchorAuthority.profileRetrievalAnchorCount} (expect 0) |

## 4. Model3 exposure + Retry shared budget

| Metric | Value |
|---|---:|
| Decision units | ${s.model3Exposure.decisionUnits} |
| Actionable non-anchor | ${s.model3Exposure.actionable} |
| KEEP | ${s.model3Exposure.keep} |
| RETRY | ${s.model3Exposure.retry} |
| RETRY rate | ${s.model3Exposure.retryRate} |
| Retry regions | ${s.model3Exposure.retryRegions} |
| Stage2 invocations | ${s.model3Exposure.stage2Invocations} |
| Stage2 useful | ${s.model3Exposure.stage2Useful} |
| Retry downstream recovery runs | ${s.model3Exposure.retryDownstreamRecovery} |
| Existing present @ Retry merge | ${s.retryBudget.existingPresent} |
| Existing dropped post-cap | ${s.retryBudget.existingDroppedPostCap} |
| Existing survival rate | ${s.retryBudget.survivalRate} |
| PROFILE_DOMAIN entering Retry | ${s.retryBudget.profileDomainEnteringRetry} |
| PROFILE_DOMAIN post-Retry drop | ${s.retryBudget.profileDomainPostRetryDrop} |

## 5. Condition table

See SUMMARY.json \`conditionTable\`.

## 6. Changed cases

Count: **${s.changedCaseCount}** (see CHANGED_CASES.csv).

## 7. Hypothesis & next owner

- MODEL2_HYPOTHESIS = **${s.model2Hypothesis}**
- DOMINANT_FAILURE_OWNER = **${s.dominantFailureOwner}**
- ONE_NEXT_OWNER = **${s.oneNextOwner}**
- ONE_NEXT_DELTA = ${s.oneNextDelta}

## 8. Anti-drift

PRODUCT_CODE_CHANGE_THIS_ROUND = NO  
No Model2/Model3/Retry/budget/Domain/FineSpan/Tone/Lexicon changes this round.
`;
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log('Wrote artifacts:', REPORT_PATH, SUMMARY_PATH, GATE_MATRIX_PATH, CHANGED_CASES_PATH, FAILURE_OWNER_PATH, 'RETRY_FUNNEL');
  console.log('Validity:', validity.isValid, validity.reason);
}

async function main() {
  console.log('=== LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE ===');
  const manifest = loadManifest();
  const allCases = loadCases();
  const manifestMap = Object.fromEntries(manifest.cases.map((c) => [c.caseId, c]));

  let selectedCases = allCases;
  if (CASE_FILTER) selectedCases = selectedCases.filter((c) => CASE_FILTER.has(c.caseId));
  if (LIMIT > 0) selectedCases = selectedCases.slice(0, LIMIT);

  const isPartial = selectedCases.length !== allCases.length;
  console.log(`Cases: ${selectedCases.length}/200 partial=${isPartial}`);

  const existingTraces = new Map();
  if (RESUME && fs.existsSync(TRACE_PATH)) {
    for (const line of fs.readFileSync(TRACE_PATH, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const item = JSON.parse(line);
        if (item.runId) existingTraces.set(item.runId, item);
      } catch (_) {}
    }
    console.log(`Resume: ${existingTraces.size} existing runs`);
  }

  const port = getTestServerPort();
  if (!SKIP_START) {
    console.log('Starting Electron…');
    const { pid } = await startElectron();
    console.log('pid', pid);
    const ready = await waitTestServerHealth(port, 180000);
    if (!ready) {
      console.error('Server not healthy');
      process.exit(1);
    }
  }

  const traceFd = fs.openSync(TRACE_PATH, existingTraces.size ? 'a' : 'w');
  const allResults = [];
  let runCounter = 0;
  const totalRuns = selectedCases.length * CONDITIONS.length;

  for (const caseRow of selectedCases) {
    const mItem = manifestMap[caseRow.caseId];
    if (!mItem) {
      console.error('Missing manifest', caseRow.caseId);
      continue;
    }
    const evidencePath = path.resolve(REPO, mItem.evidenceFile);
    if (!fs.existsSync(evidencePath)) {
      console.error('Missing evidence', evidencePath);
      process.exit(1);
    }
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

    for (const condition of CONDITIONS) {
      runCounter += 1;
      const runId = `${caseRow.caseId}_${condition}`;
      if (existingTraces.has(runId)) {
        allResults.push(existingTraces.get(runId));
        continue;
      }

      if (evidence.captureOutcome === 'ASR_EMPTY' || !evidence.rawMergedAsrText) {
        const evaluated = evaluateRunTrace(caseRow, condition, evidence, null);
        fs.writeSync(traceFd, JSON.stringify(evaluated) + '\n');
        allResults.push(evaluated);
        console.log(`[${runCounter}/${totalRuns}] ${runId} ASR_EMPTY`);
        continue;
      }

      const profArt = resolveConditionProfile(caseRow, condition);
      const sessionId = `pilot200-s2tr-${runId}-${Date.now()}`;
      await postJson(port, '/session-bootstrap', {
        session_id: sessionId,
        user_profile: profArt.profile,
        user_id: profArt.userId,
      });
      const mockRes = await postJson(port, '/run-lexicon-mock', {
        asrText: evidence.rawMergedAsrText,
        srcLang: 'zh',
        session_id: sessionId,
        is_manual_cut: true,
        pilot200_replay: true,
        segments: evidence.segments,
        utterance_tone: evidence.utterance_tone,
      });
      const evaluated = evaluateRunTrace(caseRow, condition, evidence, mockRes.data);
      fs.writeSync(traceFd, JSON.stringify(evaluated) + '\n');
      allResults.push(evaluated);
      console.log(
        `[${runCounter}/${totalRuns}] ${runId} Final:${evaluated.finalRepairCorrect} R:${evaluated.m3?.model3RetryCount || 0} Owner:${evaluated.firstFailureOwner}`
      );
    }
  }
  fs.closeSync(traceFd);

  // If resume, reload full trace for authoritative aggregation when complete
  let resultsForAgg = allResults;
  if (!isPartial && fs.existsSync(TRACE_PATH)) {
    const map = new Map();
    for (const line of fs.readFileSync(TRACE_PATH, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const row = JSON.parse(line);
        if (row.runId) map.set(row.runId, row);
      } catch (_) {}
    }
    resultsForAgg = [...map.values()];
  }

  const bundle = aggregate(allCases, resultsForAgg);
  writeArtifacts(bundle, resultsForAgg, allCases);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
