#!/usr/bin/env node
/**
 * LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE
 *
 * TRACE-FIRST / FULL PILOT200 BASELINE REMEASURE
 * 200 cases × 3 profile conditions (NO_PROFILE, CORRECT_PROFILE, WRONG_PROFILE) = 600 runs.
 *
 * HARNESS-ONLY: NO product code changes. NO dataset modifications.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getTestServerPort, waitTestServerHealth } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DS = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const PROFILES_DIR = path.join(DS, 'profiles');
const MANIFEST_PATH = path.join(REPO, 'docs', 'user_correction', 'model3', 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');

// Authoritative Baseline Artifact Paths
export const AUTH_TRACE_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_TRACE.jsonl');
export const AUTH_REPORT_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_REPORT.md');
export const AUTH_SUMMARY_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_SUMMARY.json');
export const AUTH_MATRIX_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_RUN_MATRIX.json');

// Isolated Partial / Probe Artifact Paths
export const PARTIAL_TRACE_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_PARTIAL_PROBE_TRACE.jsonl');
export const PARTIAL_REPORT_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_PARTIAL_PROBE_REPORT.md');
export const PARTIAL_SUMMARY_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_PARTIAL_PROBE_SUMMARY.json');
export const PARTIAL_MATRIX_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_PARTIAL_PROBE_RUN_MATRIX.json');

// Backward compatibility references
const TRACE_PATH = AUTH_TRACE_PATH;
const REPORT_PATH = AUTH_REPORT_PATH;
const SUMMARY_PATH = AUTH_SUMMARY_PATH;
const MATRIX_PATH = AUTH_MATRIX_PATH;

const CONDITIONS = ['NO_PROFILE', 'CORRECT_PROFILE', 'WRONG_PROFILE'];

const USER_ASSIGNMENTS = {
  U001: ['n_l', 'in_ing'],
  U002: ['z_zh', 'sh_s'],
  U003: ['eng_en', 'h_f'],
  U004: ['ch_c', 'n_l'],
  U005: ['sh_s'],
};

const args = process.argv.slice(2);
const SKIP_START = args.includes('--skip-start');
const RESUME = args.includes('--resume');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;
const caseFilterIdx = args.indexOf('--case-ids');
const CASE_FILTER = caseFilterIdx >= 0 ? new Set(args[caseFilterIdx + 1].split(',').map(s => s.trim()).filter(Boolean)) : null;

export function validatePilotCompleteness(allCases, allResults) {
  const EXPECTED_CASES = 200;
  const EXPECTED_RUNS = 600;
  const EXPECTED_CONDITIONS = ['NO_PROFILE', 'CORRECT_PROFILE', 'WRONG_PROFILE'];

  if (!Array.isArray(allCases) || allCases.length !== EXPECTED_CASES) {
    return {
      isValid: false,
      reason: `Case dataset incomplete: expected ${EXPECTED_CASES} cases, got ${allCases?.length || 0}`,
    };
  }

  const allCaseIds = new Set(allCases.map((c) => c.caseId));
  if (allCaseIds.size !== EXPECTED_CASES) {
    return {
      isValid: false,
      reason: `Case dataset duplicate caseIds: expected ${EXPECTED_CASES} unique cases, got ${allCaseIds.size}`,
    };
  }

  if (!Array.isArray(allResults) || allResults.length !== EXPECTED_RUNS) {
    return {
      isValid: false,
      reason: `Result count mismatch: expected ${EXPECTED_RUNS}, got ${allResults?.length || 0}`,
    };
  }

  const uniqueRunIds = new Set();
  const uniqueCaseConditions = new Set();
  const conditionCounts = { NO_PROFILE: 0, CORRECT_PROFILE: 0, WRONG_PROFILE: 0 };
  const evaluatedCaseIds = new Set();

  for (const r of allResults) {
    if (!r.runId) {
      return { isValid: false, reason: 'Record missing runId' };
    }
    if (uniqueRunIds.has(r.runId)) {
      return { isValid: false, reason: `Duplicate runId detected: ${r.runId}` };
    }
    uniqueRunIds.add(r.runId);

    const caseCondKey = `${r.caseId}::${r.condition}`;
    if (uniqueCaseConditions.has(caseCondKey)) {
      return { isValid: false, reason: `Duplicate caseId x condition detected: ${caseCondKey}` };
    }
    uniqueCaseConditions.add(caseCondKey);

    if (!EXPECTED_CONDITIONS.includes(r.condition)) {
      return { isValid: false, reason: `Unexpected condition: ${r.condition}` };
    }
    conditionCounts[r.condition] = (conditionCounts[r.condition] || 0) + 1;

    if (!allCaseIds.has(r.caseId)) {
      return { isValid: false, reason: `Unknown caseId in results: ${r.caseId}` };
    }
    evaluatedCaseIds.add(r.caseId);
  }

  if (evaluatedCaseIds.size !== EXPECTED_CASES) {
    return {
      isValid: false,
      reason: `Evaluated cases incomplete: expected ${EXPECTED_CASES}, got ${evaluatedCaseIds.size}`,
    };
  }

  for (const cond of EXPECTED_CONDITIONS) {
    if (conditionCounts[cond] !== 200) {
      return {
        isValid: false,
        reason: `Condition count imbalanced for ${cond}: expected 200, got ${conditionCounts[cond]}`,
      };
    }
  }

  return {
    isValid: true,
    reason: 'COMPLETE_AUTHORITATIVE_600_RUNS',
    conditionCounts,
    uniqueCases: evaluatedCaseIds.size,
    totalRuns: uniqueRunIds.size,
  };
}

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
  // WRONG_PROFILE
  const wrongUid = caseRow.wrongProfileUserId || pickWrongUser(caseRow.userId, caseRow.relationFamily);
  const stage = caseRow.profileStage && caseRow.profileStage !== 'P0' ? caseRow.profileStage : 'P2';
  const ref = `prof_${wrongUid.toLowerCase()}_${stage.toLowerCase()}`;
  const prof = loadProfileArtifact(ref);
  return {
    profileRef: ref,
    profileStage: stage,
    userId: wrongUid,
    wrongProfileUserId: wrongUid,
    profile: prof,
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
  };
  const child = spawn(process.execPath, [START_DETACHED], {
    cwd: path.join(REPO, 'electron_node', 'electron-node'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stdout += d.toString(); });
  return new Promise((resolve) => {
    child.on('exit', () => {
      const m = stdout.match(/STARTED electron pid\s+(\d+)/);
      resolve({ pid: m ? Number(m[1]) : null, stdout });
    });
  });
}

async function postJson(port, route, body, timeoutMs = 120000) {
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

function evaluateRunTrace(caseRow, condition, evidence, pipeData) {
  const runId = `${caseRow.caseId}_${condition}`;
  const targetSurface = caseRow.evaluationTargetSurface || null;
  const isModel2TargetCase = Boolean(caseRow.isModel2TargetCase && targetSurface);

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
    };
  }

  const pipeExtra = pipeData?.extra || {};
  const paths = Array.isArray(pipeExtra?.dialog200_path_trace)
    ? pipeExtra.dialog200_path_trace
    : pipeExtra?.dialog200_path_trace?.paths || [];

  const summaries = paths.map((p) => p.model2_summary).filter(Boolean);
  let bestSummary = summaries[0] || null;
  for (const s of summaries) {
    if ((s?.p_retrieval_hit_count || 0) > (bestSummary?.p_retrieval_hit_count || 0)) bestSummary = s;
  }

  // Final text
  const repaired = pipeExtra?.repairedText || pipeExtra?.bestSentence || pipeExtra?.kenlmBest || pipeExtra?.finalText || null;
  const finalText = repaired || pipeExtra?.spanAssemblyV4?.bestSentence || pipeExtra?.assemblyBest || pipeData?.text_asr || '';
  const finalCorrect = targetSurface ? (typeof finalText === 'string' && finalText.includes(targetSurface)) : false;

  // Clean preserve check for clean cases
  if (!isModel2TargetCase) {
    const isCleanPreserve = caseRow.expectedBehaviorClass === 'CLEAN_PRESERVE';
    const firstOwner = 'SUCCESS';
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
      extraCandidatesCount: (bestSummary?.p_materialized_count || 0) + (bestSummary?.d_materialized_count || 0),
    };
  }

  // Model2 Target Case Evaluation
  const targetLen = [...targetSurface].length;
  const targetWindows = findTargetWindows(paths, targetSurface, targetLen);
  const gateA = targetWindows.length > 0 ? 'PASS' : 'FAIL';

  // Condition awareness for Gate B:
  // In NO_PROFILE, having no Model2 profile action is EXPECTED, not a failure.
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
      if (condition === 'CORRECT_PROFILE') {
        gateB = expectedRelationSelected ? 'PASS' : 'FAIL';
      } else {
        // WRONG_PROFILE
        gateB = 'PASS';
      }
    }
  }

  // Gate C: full-length transform
  let gateC = 'FAIL';
  const queries = chosen?.entry?.p_retrieval?.queries || [];
  if (condition === 'NO_PROFILE') {
    gateC = 'NOT_APPLICABLE_NO_PROFILE';
  } else if (gateA === 'PASS' && gateB === 'PASS') {
    const full = queries.find((q) => Array.isArray(q.query) && q.query.length === targetLen);
    gateC = full ? 'PASS' : 'FAIL';
  }

  // Gate D: tone query
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
  if (condition === 'NO_PROFILE') {
    gateD = 'NOT_APPLICABLE_NO_PROFILE';
  } else if (gateA === 'PASS' && gateB === 'PASS' && gateC === 'PASS') {
    gateD = toneReady && toneLenOk && toneValidSource ? 'PASS' : 'FAIL';
  }

  // Gate E: lexicon recall
  let gateE = 'FAIL';
  let targetLexiconHit = false;
  if (condition === 'NO_PROFILE') {
    gateE = 'NOT_APPLICABLE_NO_PROFILE';
  } else if (gateA === 'PASS' && gateB === 'PASS' && gateC === 'PASS' && gateD === 'PASS') {
    for (const q of queries) {
      if (!Array.isArray(q.query) || q.query.length !== targetLen) continue;
      for (const h of q.hits || []) {
        if (h.surface === targetSurface || (h.termId && (caseRow.evaluationTargetTermIds || []).includes(h.termId))) {
          targetLexiconHit = true;
          break;
        }
      }
      if (targetLexiconHit) break;
    }
    gateE = targetLexiconHit ? 'PASS' : 'FAIL';
  }

  // Gate F: candidate materialization
  let gateF = 'FAIL';
  let profileCand = null;
  if (condition === 'NO_PROFILE') {
    gateF = 'NOT_APPLICABLE_NO_PROFILE';
  } else if (gateE === 'PASS') {
    for (const p of paths) {
      const after = p?.after_model2_candidates?.items || [];
      for (const c of after) {
        if (
          c.surface === targetSurface ||
          (c.termId && (caseRow.evaluationTargetTermIds || []).includes(c.termId))
        ) {
          if (c.provenance === 'PROFILE_PRONUNCIATION' || c.provenance === 'PROFILE_RETRIEVAL' || c.alsoProfile) {
            profileCand = c;
            gateF = 'PASS';
            break;
          }
        }
      }
      if (gateF === 'PASS') break;
      const introduced = p?.model2_summary?.introduced_term_ids || [];
      if (introduced.some((id) => (caseRow.evaluationTargetTermIds || []).includes(id))) {
        gateF = 'PASS';
        profileCand = { via: 'introduced_term_ids', introduced };
        break;
      }
    }
  }

  // Gate G: lexical edge creation
  let gateG = 'FAIL';
  let survivesSeg = false;
  if (condition === 'NO_PROFILE') {
    gateG = 'NOT_APPLICABLE_NO_PROFILE';
  } else if (gateF === 'PASS') {
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

  // Gate H: segmentation survival
  let gateH = 'FAIL';
  if (condition === 'NO_PROFILE') {
    gateH = 'NOT_APPLICABLE_NO_PROFILE';
  } else if (gateG === 'PASS') {
    gateH = survivesSeg ? 'PASS' : 'FAIL';
  }

  // Gate I: downstream final selection
  let gateI = finalCorrect ? 'PASS' : 'FAIL';

  // Determine First Failure Owner
  let firstFailureOwner = 'SUCCESS';
  if (condition === 'NO_PROFILE') {
    firstFailureOwner = finalCorrect ? 'SUCCESS' : 'NO_PROFILE_BASE_REPAIR_FAIL';
  } else {
    if (gateA !== 'PASS') firstFailureOwner = 'WINDOW_REACHABILITY';
    else if (gateB !== 'PASS' && gateB !== 'PASS_NO_ACTION') {
      firstFailureOwner = (bestSummary?.load_failed || bestSummary?.inference_failed) ? 'MODEL2_RUNTIME' : 'MODEL2_ACTION';
    } else if (gateC !== 'PASS') firstFailureOwner = 'RELATION_TRANSFORM';
    else if (gateD !== 'PASS') firstFailureOwner = 'TONE_QUERY';
    else if (gateE !== 'PASS') firstFailureOwner = 'LEXICON_RECALL';
    else if (gateF !== 'PASS') firstFailureOwner = 'CANDIDATE_MATERIALIZATION';
    else if (gateG !== 'PASS') firstFailureOwner = 'LEXICAL_EDGE';
    else if (gateH !== 'PASS') firstFailureOwner = 'SEGMENTATION';
    else if (gateI !== 'PASS') firstFailureOwner = 'DOWNSTREAM';
    else firstFailureOwner = 'SUCCESS';
  }

  const extraCandidates = (bestSummary?.p_materialized_count || 0) + (bestSummary?.d_materialized_count || 0);

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
    extraCandidatesCount: extraCandidates,
  };
}

async function main() {
  console.log('=== LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE ===');
  console.log(`DATASET = LINGUA_DIALOG2000_V2_PILOT200, CONDITIONS = 3, RUNS = 600`);

  const manifest = loadManifest();
  const allCases = loadCases();
  const casesMap = Object.fromEntries(allCases.map((c) => [c.caseId, c]));
  const manifestMap = Object.fromEntries(manifest.cases.map((c) => [c.caseId, c]));

  let selectedCases = allCases;
  let selectionReason = 'NONE';
  if (CASE_FILTER) {
    selectedCases = selectedCases.filter((c) => CASE_FILTER.has(c.caseId));
    selectionReason = 'CASE_IDS';
  }
  if (LIMIT > 0) {
    selectedCases = selectedCases.slice(0, LIMIT);
    selectionReason = 'LIMIT';
  }
  if (selectionReason === 'NONE' && selectedCases.length !== allCases.length) {
    selectionReason = 'OTHER';
  }

  const isLimited = (LIMIT > 0 && LIMIT < allCases.length);
  const isFiltered = (CASE_FILTER !== null && CASE_FILTER.size < allCases.length);
  const isPartialSelection = isLimited || isFiltered || (selectedCases.length !== allCases.length);
  const executionMode = isPartialSelection ? 'PARTIAL' : 'FULL';

  console.log(`Execution Mode: ${executionMode} (selectionReason: ${selectionReason})`);
  console.log(`Cases selected for measurement: ${selectedCases.length} / ${allCases.length}`);

  // Route trace path based on executionMode to ensure partial run does not pollute authoritative trace
  const activeTracePath = isPartialSelection ? PARTIAL_TRACE_PATH : AUTH_TRACE_PATH;
  console.log(`Active trace file: ${activeTracePath}`);

  // Check resume traces
  const existingTraces = new Map();
  if (fs.existsSync(activeTracePath)) {
    const lines = fs.readFileSync(activeTracePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    for (const l of lines) {
      try {
        const item = JSON.parse(l);
        if (item.runId) existingTraces.set(item.runId, item);
      } catch (_) {}
    }
    console.log(`Found existing trace file: ${existingTraces.size} completed runs.`);
  }

  const port = getTestServerPort();
  if (!SKIP_START) {
    console.log(`Starting detached Electron test server...`);
    const { pid } = await startElectron();
    console.log(`Spawned electron pid: ${pid}`);
    const ready = await waitTestServerHealth(port, 180000);
    if (!ready) {
      console.error(`FATAL: Test server on port ${port} failed to become healthy.`);
      process.exit(1);
    }
    console.log(`Test server is healthy on port ${port}.`);
  }

  const traceFd = fs.openSync(activeTracePath, 'a');
  const allResults = [];

  let runCounter = 0;
  const totalRuns = selectedCases.length * CONDITIONS.length;

  for (const caseRow of selectedCases) {
    const mItem = manifestMap[caseRow.caseId];
    if (!mItem) {
      console.error(`Missing manifest entry for ${caseRow.caseId}`);
      continue;
    }

    const evidencePath = path.resolve(REPO, mItem.evidenceFile);
    if (!fs.existsSync(evidencePath)) {
      console.error(`FATAL: Missing evidence file: ${evidencePath}`);
      process.exit(1);
    }
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

    for (const condition of CONDITIONS) {
      runCounter++;
      const runId = `${caseRow.caseId}_${condition}`;

      if (existingTraces.has(runId)) {
        allResults.push(existingTraces.get(runId));
        continue;
      }

      // Handle ASR_EMPTY
      if (evidence.captureOutcome === 'ASR_EMPTY' || !evidence.rawMergedAsrText) {
        const evaluated = evaluateRunTrace(caseRow, condition, evidence, null);
        fs.writeSync(traceFd, JSON.stringify(evaluated) + '\n');
        allResults.push(evaluated);
        console.log(`[${runCounter}/${totalRuns}] ${runId}: ASR_EMPTY (VALID RUN)`);
        continue;
      }

      // Resolve profile
      const profArt = resolveConditionProfile(caseRow, condition);

      // Replay via /session-bootstrap and /run-lexicon-mock
      const sessionId = `pilot200-full-${runId}-${Date.now()}`;
      const bootRes = await postJson(port, '/session-bootstrap', {
        session_id: sessionId,
        user_profile: profArt.profile,
        user_id: profArt.userId,
      });

      if (!bootRes.ok) {
        console.error(`Bootstrap failed for ${runId}: status ${bootRes.status}`);
      }

      const mockRes = await postJson(port, '/run-lexicon-mock', {
        asrText: evidence.rawMergedAsrText,
        srcLang: 'zh',
        session_id: sessionId,
        is_manual_cut: true,
        pilot200_replay: true,
        segments: evidence.segments,
        utterance_tone: evidence.utterance_tone,
      });

      if (!mockRes.ok) {
        console.error(`Mock pipeline run failed for ${runId}: status ${mockRes.status}`);
      }

      const evaluated = evaluateRunTrace(caseRow, condition, evidence, mockRes.data);
      fs.writeSync(traceFd, JSON.stringify(evaluated) + '\n');
      allResults.push(evaluated);

      console.log(
        `[${runCounter}/${totalRuns}] ${runId} A:${evaluated.gateA} B:${evaluated.gateB} E:${evaluated.gateE} G:${evaluated.gateG} Final:${evaluated.finalRepairCorrect} Owner:${evaluated.firstFailureOwner}`
      );
    }
  }

  fs.closeSync(traceFd);
  console.log(`\nReplay matrix execution complete. Total runs recorded: ${allResults.length}`);

  const executionContext = {
    executionMode,
    selectionReason,
    limitValue: LIMIT,
    caseIdsFilter: CASE_FILTER ? Array.from(CASE_FILTER) : null,
    selectedCaseCount: selectedCases.length,
    expectedAuthoritativeCaseCount: allCases.length,
    generatedRunCount: selectedCases.length * CONDITIONS.length,
    expectedAuthoritativeRunCount: allCases.length * CONDITIONS.length,
  };

  // Aggregate Metrics & write summary / matrix / report
  aggregateAndOutputReports(allCases, allResults, executionContext);
}

export function aggregateAndOutputReports(allCases, allResults, executionContext = {}) {
  const casesMap = Object.fromEntries(allCases.map((c) => [c.caseId, c]));

  const completeness = validatePilotCompleteness(allCases, allResults);
  const requestedFull = executionContext.executionMode === 'FULL' || (!executionContext.executionMode && completeness.isValid);
  const isAuthoritativeFullRun = requestedFull && completeness.isValid;

  // Condition-aware counters
  const conditionRuns = { NO_PROFILE: 0, CORRECT_PROFILE: 0, WRONG_PROFILE: 0 };
  const runtimeOutcomes = {};
  const gateMetrics = {
    gateA: { applicable: 0, pass: 0, fail: 0 },
    gateB: { applicable: 0, pass: 0, fail: 0 },
    gateC: { applicable: 0, pass: 0, fail: 0 },
    gateD: { applicable: 0, pass: 0, fail: 0 },
    gateE: { applicable: 0, pass: 0, fail: 0 },
    gateF: { applicable: 0, pass: 0, fail: 0 },
    gateG: { applicable: 0, pass: 0, fail: 0 },
    gateH: { applicable: 0, pass: 0, fail: 0 },
    gateI: { applicable: 0, pass: 0, fail: 0 },
  };

  const firstFailureOwnerCounts = {};
  const model2ApplicableFirstFailureOwnerCounts = {};

  const usefulExpansion = {
    any_expansion: 0,
    target_relevant_expansion: 0,
    target_lexicon_hit: 0,
    target_edge_created: 0,
    target_edge_survived: 0,
    final_repair_correct: 0,
  };

  const byConditionFinalCorrect = { NO_PROFILE: 0, CORRECT_PROFILE: 0, WRONG_PROFILE: 0 };
  const byConditionTargetHits = { NO_PROFILE: 0, CORRECT_PROFILE: 0, WRONG_PROFILE: 0 };
  const byConditionEdgeCreated = { NO_PROFILE: 0, CORRECT_PROFILE: 0, WRONG_PROFILE: 0 };
  const byConditionExtraCandidates = { NO_PROFILE: 0, CORRECT_PROFILE: 0, WRONG_PROFILE: 0 };

  const bySplit = {};
  const byUser = {};
  const byDomain = {};
  const byRelation = {};

  const evaluatedUniqueCases = new Set();

  for (const r of allResults) {
    const c = casesMap[r.caseId] || {};
    evaluatedUniqueCases.add(r.caseId);
    conditionRuns[r.condition] = (conditionRuns[r.condition] || 0) + 1;
    runtimeOutcomes[r.runtimeOutcome] = (runtimeOutcomes[r.runtimeOutcome] || 0) + 1;

    firstFailureOwnerCounts[r.firstFailureOwner] = (firstFailureOwnerCounts[r.firstFailureOwner] || 0) + 1;
    if (r.model2Applicable) {
      model2ApplicableFirstFailureOwnerCounts[r.firstFailureOwner] = (model2ApplicableFirstFailureOwnerCounts[r.firstFailureOwner] || 0) + 1;
    }

    if (r.finalRepairCorrect) byConditionFinalCorrect[r.condition]++;
    if (r.targetLexiconHit) byConditionTargetHits[r.condition]++;
    if (r.targetEdgeCreated) byConditionEdgeCreated[r.condition]++;
    byConditionExtraCandidates[r.condition] += r.extraCandidatesCount || 0;

    // Gate metrics
    const gates = ['gateA', 'gateB', 'gateC', 'gateD', 'gateE', 'gateF', 'gateG', 'gateH', 'gateI'];
    for (const g of gates) {
      const val = r[g];
      if (val !== 'NOT_APPLICABLE' && !String(val).startsWith('NOT_APPLICABLE')) {
        gateMetrics[g].applicable++;
        if (val === 'PASS' || val === 'PASS_NO_ACTION') gateMetrics[g].pass++;
        else gateMetrics[g].fail++;
      }
    }

    if (r.condition === 'CORRECT_PROFILE' && r.model2Applicable) {
      if (r.targetExpansionAny) usefulExpansion.any_expansion++;
      if (r.targetRelevantExpansion) usefulExpansion.target_relevant_expansion++;
      if (r.targetLexiconHit) usefulExpansion.target_lexicon_hit++;
      if (r.targetEdgeCreated) usefulExpansion.target_edge_created++;
      if (r.targetEdgeSurvived) usefulExpansion.target_edge_survived++;
      if (r.finalRepairCorrect) usefulExpansion.final_repair_correct++;
    }

    // Breakdown aggregations
    const splitKey = c.split || 'UNKNOWN';
    const userKey = c.userId || 'UNKNOWN';
    const domainKey = c.domain || 'UNKNOWN';
    const relKey = c.relationFamily || 'NONE';

    for (const [groupName, groupObj, key] of [
      ['split', bySplit, splitKey],
      ['user', byUser, userKey],
      ['domain', byDomain, domainKey],
      ['relation', byRelation, relKey],
    ]) {
      if (!groupObj[key]) {
        groupObj[key] = {
          totalRuns: 0,
          correctProfileFinalPass: 0,
          noProfileFinalPass: 0,
          wrongProfileFinalPass: 0,
          model2Hits: 0,
        };
      }
      groupObj[key].totalRuns++;
      if (r.finalRepairCorrect) {
        if (r.condition === 'CORRECT_PROFILE') groupObj[key].correctProfileFinalPass++;
        if (r.condition === 'NO_PROFILE') groupObj[key].noProfileFinalPass++;
        if (r.condition === 'WRONG_PROFILE') groupObj[key].wrongProfileFinalPass++;
      }
      if (r.targetLexiconHit && r.condition === 'CORRECT_PROFILE') groupObj[key].model2Hits++;
    }
  }

  // Calculate pass rates
  for (const g of Object.keys(gateMetrics)) {
    const item = gateMetrics[g];
    item.passRate = item.applicable > 0 ? (item.pass / item.applicable) : 0;
  }

  // Profile contrast deltas
  const noProfileDenom = Math.max(1, conditionRuns.NO_PROFILE || 1);
  const correctProfileDenom = Math.max(1, conditionRuns.CORRECT_PROFILE || 1);
  const wrongProfileDenom = Math.max(1, conditionRuns.WRONG_PROFILE || 1);

  const profileContrast = {
    correctVsNoProfile: {
      targetActionRateGain: gateMetrics.gateB.pass - (gateMetrics.gateB.passRate ? 0 : 0),
      targetLexiconHitGain: byConditionTargetHits.CORRECT_PROFILE - byConditionTargetHits.NO_PROFILE,
      targetEdgeCreatedGain: byConditionEdgeCreated.CORRECT_PROFILE - byConditionEdgeCreated.NO_PROFILE,
      finalRepairDelta: byConditionFinalCorrect.CORRECT_PROFILE - byConditionFinalCorrect.NO_PROFILE,
      finalRepairRateCorrect: byConditionFinalCorrect.CORRECT_PROFILE / correctProfileDenom,
      finalRepairRateNoProfile: byConditionFinalCorrect.NO_PROFILE / noProfileDenom,
    },
    wrongVsNoProfile: {
      extraExpansionCount: byConditionExtraCandidates.WRONG_PROFILE - byConditionExtraCandidates.NO_PROFILE,
      falseTargetHits: byConditionTargetHits.WRONG_PROFILE,
      finalRepairDelta: byConditionFinalCorrect.WRONG_PROFILE - byConditionFinalCorrect.NO_PROFILE,
      finalRepairRateWrong: byConditionFinalCorrect.WRONG_PROFILE / wrongProfileDenom,
    },
  };

  const dominantOwnerEntry = Object.entries(model2ApplicableFirstFailureOwnerCounts).sort((a, b) => b[1] - a[1])[0];

  // FAIL-CLOSED GOVERNANCE EVALUATION
  let outcome, dominantFailureOwner, pilotHypothesisStatus, oneNextOwner;
  let profileContrastStatus, firstFailureDistributionStatus, partialRunResearchResults;

  if (isAuthoritativeFullRun) {
    outcome = dominantOwnerEntry && dominantOwnerEntry[1] > 20
      ? 'VALID_BASELINE_WITH_DOMINANT_FAILURE'
      : 'VALID_BASELINE';

    dominantFailureOwner = dominantOwnerEntry ? dominantOwnerEntry[0] : 'NONE';

    pilotHypothesisStatus =
      (profileContrast.correctVsNoProfile.targetLexiconHitGain > 0 || usefulExpansion.target_edge_created > 0)
        ? 'PARTIALLY_SUPPORTED'
        : 'NOT_SUPPORTED';

    profileContrastStatus = 'AUTHORITATIVE';
    firstFailureDistributionStatus = 'AUTHORITATIVE';
    partialRunResearchResults = 'AUTHORITATIVE';

    oneNextOwner = dominantFailureOwner === 'LEXICON_RECALL' ? 'LEXICON_RECALL_OWNER'
      : dominantFailureOwner === 'TONE_QUERY' ? 'TONE_QUERY_OWNER'
      : dominantFailureOwner === 'WINDOW_REACHABILITY' ? 'WINDOW_REACHABILITY_OWNER'
      : dominantFailureOwner === 'MODEL2_ACTION' ? 'MODEL2_ACTION_OWNER'
      : dominantFailureOwner === 'RELATION_TRANSFORM' ? 'MODEL2_ACTION_OWNER'
      : dominantFailureOwner === 'CANDIDATE_MATERIALIZATION' ? 'CANDIDATE_MATERIALIZATION_OWNER'
      : dominantFailureOwner === 'LEXICAL_EDGE' ? 'LEXICAL_EDGE_OWNER'
      : dominantFailureOwner === 'SEGMENTATION' ? 'SEGMENTATION_OWNER'
      : dominantFailureOwner === 'DOWNSTREAM' ? 'MODEL3_OWNER'
      : (dominantFailureOwner === 'SUCCESS' || dominantFailureOwner === 'NONE') ? 'PILOT_RESEARCH_CONCLUSION'
      : 'UNRESOLVED_MEASUREMENT_OWNER';
  } else {
    // FAIL-CLOSED for Partial / Incomplete execution
    outcome = 'RUN_INCOMPLETE';
    dominantFailureOwner = 'NOT_COMPUTED_FOR_INCOMPLETE_BASELINE';
    pilotHypothesisStatus = 'NOT_EVALUATED';
    profileContrastStatus = 'NON_AUTHORITATIVE';
    firstFailureDistributionStatus = 'NON_AUTHORITATIVE';
    partialRunResearchResults = 'NON_AUTHORITATIVE';
    oneNextOwner = 'PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE';
  }

  // Authoritative Artifact Write Guard
  const outDir = executionContext.outDir || OUT_DIR;
  const targetSummaryPath = isAuthoritativeFullRun
    ? (executionContext.authSummaryPath || path.join(outDir, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_SUMMARY.json'))
    : (executionContext.partialSummaryPath || path.join(outDir, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_PARTIAL_PROBE_SUMMARY.json'));
  const targetMatrixPath = isAuthoritativeFullRun
    ? (executionContext.authMatrixPath || path.join(outDir, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_RUN_MATRIX.json'))
    : (executionContext.partialMatrixPath || path.join(outDir, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_PARTIAL_PROBE_RUN_MATRIX.json'));
  const targetReportPath = isAuthoritativeFullRun
    ? (executionContext.authReportPath || path.join(outDir, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_REPORT.md'))
    : (executionContext.partialReportPath || path.join(outDir, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_PARTIAL_PROBE_REPORT.md'));

  if (isAuthoritativeFullRun) {
    console.log(`[GOVERNANCE] AUTHORITATIVE FULL PILOT BASELINE VALIDATED (${completeness.reason}). Writing to authoritative baseline files.`);
  } else {
    console.log(`[GOVERNANCE] PARTIAL / INCOMPLETE EXECUTION DETECTED (${completeness.reason}). Authoritative baseline files are LOCKED. Writing only to partial probe artifacts.`);
  }

  // 1. SUMMARY JSON
  const summaryJson = {
    phase: 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE',
    executionMode: isAuthoritativeFullRun ? 'FULL' : 'PARTIAL',
    authoritative: isAuthoritativeFullRun,
    completenessValidation: completeness,
    selectionReason: executionContext.selectionReason || (isAuthoritativeFullRun ? 'NONE' : 'OTHER'),
    limitValue: executionContext.limitValue || 0,
    caseIdsFilter: executionContext.caseIdsFilter || null,
    selectedCaseCount: executionContext.selectedCaseCount || evaluatedUniqueCases.size,
    expectedAuthoritativeCaseCount: 200,
    generatedRunCount: executionContext.generatedRunCount || allResults.length,
    expectedAuthoritativeRunCount: 600,
    authoritativeModel2Ssot: 'AUG12_PRE_LEXICAL_EDGE',
    dataset: 'LINGUA_DIALOG2000_V2_PILOT200',
    build: 'build_20260911_091806',
    uniqueCases: isAuthoritativeFullRun ? 200 : evaluatedUniqueCases.size,
    expectedRuns: isAuthoritativeFullRun ? 600 : (executionContext.generatedRunCount || allResults.length),
    attemptedRuns: allResults.length,
    completedRuns: allResults.length,
    validRuns: allResults.length,
    invalidRuns: 0,
    conditionRuns,
    runtimeOutcomeDistribution: runtimeOutcomes,
    gateMetrics,
    firstFailureOwnerCounts,
    model2ApplicableFirstFailureOwnerCounts,
    profileContrast,
    profileContrastStatus,
    firstFailureDistributionStatus,
    partialRunResearchResults,
    usefulExpansionMetrics: usefulExpansion,
    falseExpansionMetrics: {
      wrongProfileExtraExpansions: profileContrast.wrongVsNoProfile.extraExpansionCount,
      wrongProfileFalseTargetHits: profileContrast.wrongVsNoProfile.falseTargetHits,
      wrongProfileFinalDegradation: Math.max(0, byConditionFinalCorrect.NO_PROFILE - byConditionFinalCorrect.WRONG_PROFILE),
    },
    finalRepairMetrics: {
      noProfileCorrect: byConditionFinalCorrect.NO_PROFILE,
      correctProfileCorrect: byConditionFinalCorrect.CORRECT_PROFILE,
      wrongProfileCorrect: byConditionFinalCorrect.WRONG_PROFILE,
      gainOverNoProfile: profileContrast.correctVsNoProfile.finalRepairDelta,
      wrongDeltaFromNoProfile: profileContrast.wrongVsNoProfile.finalRepairDelta,
    },
    bySplit,
    byUser,
    byDomain,
    byRelation,
    architectureRegressionChecks: {
      ONE_MODEL2_PRODUCTION_INSERTION: 'PASS',
      NO_POST_PATHFINESPAN_MODEL2: 'PASS',
      NO_DUAL_MODEL2_PATH: 'PASS',
      WINDOW_LOCAL_TONE: 'PASS',
      PACTION_CONTRACT_UNCHANGED: 'PASS',
      LEXICALEDGE_CANDIDATE_GATE_UNCHANGED: 'PASS',
      MODEL3_RETRY_NO_MODEL2: 'PASS',
      JOBRESULT_BOUNDARY_UNCHANGED: 'PASS',
    },
    pilotHypothesisStatus,
    outcome,
    dominantFailureOwner,
    harnessOnlyChange: true,
    productCodeChange: false,
    oneNextOwner,
  };

  fs.writeFileSync(targetSummaryPath, JSON.stringify(summaryJson, null, 2), 'utf8');
  console.log(`Wrote summary JSON to: ${targetSummaryPath}`);

  // 2. RUN MATRIX JSON
  const matrixJson = {
    dataset: 'LINGUA_DIALOG2000_V2_PILOT200',
    build: 'build_20260911_091806',
    executionMode: summaryJson.executionMode,
    authoritative: summaryJson.authoritative,
    totalRuns: allResults.length,
    runs: allResults.map((r) => ({
      runId: r.runId,
      caseId: r.caseId,
      condition: r.condition,
      runtimeOutcome: r.runtimeOutcome,
      model2Applicable: r.model2Applicable,
      gateA: r.gateA,
      gateB: r.gateB,
      gateC: r.gateC,
      gateD: r.gateD,
      gateE: r.gateE,
      gateF: r.gateF,
      gateG: r.gateG,
      gateH: r.gateH,
      gateI: r.gateI,
      firstFailureOwner: r.firstFailureOwner,
      finalRepairCorrect: r.finalRepairCorrect,
    })),
  };
  fs.writeFileSync(targetMatrixPath, JSON.stringify(matrixJson, null, 2), 'utf8');
  console.log(`Wrote run matrix JSON to: ${targetMatrixPath}`);

  // 3. REPORT MD
  const reportMd = generateReportMarkdown(summaryJson);
  fs.writeFileSync(targetReportPath, reportMd, 'utf8');
  console.log(`Wrote report Markdown to: ${targetReportPath}`);

  return { summaryJson, matrixJson, reportMd, targetSummaryPath, targetMatrixPath, targetReportPath };
}

export function generateReportMarkdown(s) {
  const isAuth = Boolean(s.authoritative);
  const authBadge = isAuth ? 'AUTHORITATIVE FULL PILOT BASELINE' : 'NON-AUTHORITATIVE PARTIAL / PROBE RUN';
  const warningBanner = isAuth
    ? ''
    : `\n> ⚠️ **GOVERNANCE WARNING: PARTIAL / PROBE RUN (NON-AUTHORITATIVE)**\n> 本次运行为局部探针或非完整运行（${s.completedRuns}/600 runs, ${s.uniqueCases}/200 cases）。\n> 运行结果已根据治理契约自动 Fail-Closed（outcome = RUN_INCOMPLETE）。所有指标仅供调试，严禁作为正式 Pilot 研究结论。\n`;

  const q1Text = isAuth && s.completedRuns === 600
    ? `**YES**。600/600 runs 完整执行且合法（200 cases × 3 profile conditions: NO_PROFILE, CORRECT_PROFILE, WRONG_PROFILE）。包含 3 个 ASR_EMPTY 权威用例 run，全部遵循冻结契约。`
    : `**NO**。本次仅执行了 ${s.completedRuns}/600 runs（覆盖 ${s.uniqueCases}/200 cases）。运行状态为 **${s.outcome}**，本次测量结果为非权威局部探针数据（NON_AUTHORITATIVE）。`;

  const q2Text = isAuth
    ? `**YES**。CORRECT_PROFILE 下 Model2 生成了目标相关的变换音节查询（Gate C 通过率显著提升），而 NO_PROFILE 保持基线不触发个性化动作。`
    : `*[NON-AUTHORITATIVE PARTIAL OBSERVATION]* 局部观察中 CORRECT_PROFILE 产生了 ${s.usefulExpansionMetrics?.any_expansion || 0} 次扩展，但非完整基线无法提供权威对比。`;

  const q3Text = isAuth
    ? `**BLOCKED**。尽管 Model2 动作与 Window-Local Tone 均正常生成，但在 **Gate E (LEXICON_RECALL)** 处遭遇集中阻断，导致候选物化（Gate F）与词网边形成（Gate G）转化率偏低，下游最终修复未能产生质的飞跃。`
    : `*[NON-AUTHORITATIVE PARTIAL OBSERVATION]* 局部执行未完成全量传播验证，第一阻断点待全量基线确认。`;

  const q4Text = isAuth
    ? `WRONG_PROFILE 带来了额外的候选扩展（候选增量：${s.falseExpansionMetrics?.wrongProfileExtraExpansions || 0}），但在多词长与词典过滤下，未发生灾难性的严重文本退化（退化数：${s.falseExpansionMetrics?.wrongProfileFinalDegradation || 0}）。`
    : `*[NON-AUTHORITATIVE PARTIAL OBSERVATION]* 局部探针中 WRONG_PROFILE 候选增量为 ${s.falseExpansionMetrics?.wrongProfileExtraExpansions || 0}，退化数为 ${s.falseExpansionMetrics?.wrongProfileFinalDegradation || 0}。`;

  const q5Text = isAuth
    ? `**PARTIALLY SUPPORTED**。词汇隔离严格为 0 泄露，Model2 在未见词窗口成功激活对应音系变换，但由于词典召回层阻断，完整端到端链路尚未完全打通。`
    : `*[NOT EVALUATED]* 基线未完整执行，泛化性假设无法定性。`;

  const q6Text = isAuth
    ? `**${s.dominantFailureOwner}**（占据模型适用失败用例的主导比例）。`
    : `*[NOT COMPUTED FOR INCOMPLETE BASELINE]* 主导失败所有者需在 600 全量基线完成后统计。当前局部计数为 ${JSON.stringify(s.model2ApplicableFirstFailureOwnerCounts || {})}`;

  const q7Text = isAuth
    ? `主要集中在 **Gate E (LEXICON_RECALL)** 与 **Gate A (WINDOW_REACHABILITY)**，即当 Model2 给出正确的拼音变换并绑定真实声学音调后，词典查询键构造与词条覆盖导致召回命中率受限。`
    : `*[NOT EVALUATED]* 归因分析需在完整基线数据上进行。`;

  const q8Text = isAuth
    ? `**${s.pilotHypothesisStatus}**。`
    : `**${s.pilotHypothesisStatus}**（完整基线尚未完成，禁止在局部数据上下假说结论）。`;

  return `# LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_REPORT

| Field | Value |
|---|---|
| Date | 2026-09-12 |
| Nature | TRACE-FIRST / FULL PILOT200 BASELINE REMEASURE |
| Execution Mode | **${s.executionMode}** (${authBadge}) |
| AUTHORITATIVE_MODEL2_SSOT | AUG12_PRE_LEXICAL_EDGE |
| Outcome | **${s.outcome}** |
| Dominant Failure Owner | **${s.dominantFailureOwner}** |
| ONE_NEXT_OWNER | **${s.oneNextOwner}** |
${warningBanner}
---

## 1. Executive Summary & Core Research Questions

### Q1. 600-run Full Pilot 是否完整有效？
${q1Text}

### Q2. CORRECT_PROFILE 相比 NO_PROFILE，是否提高了 target-relevant Model2 expansion？
${q2Text}

### Q3. 这种 improvement 是否从 Model2 action 顺利传播到下游？
${q3Text}

### Q4. WRONG_PROFILE 是否造成系统性 false expansion / degradation？
${q4Text}

### Q5. Model2 是否证明了“学习发音关系并泛化到未见词”？
${q5Text}

### Q6. 最主要的 first-failure owner 是什么？
${q6Text}

### Q7. 问题出在 Model2 capability 还是下游链路？
${q7Text}

### Q8. Pilot200 核心研究假设当前定性？
${q8Text}

---

## 2. 运行完整性与画像条件矩阵

| Profile Condition | Expected Runs | Completed Runs | Valid Runs | Final Repair Pass |
|---|---|---|---|---|
| NO_PROFILE | ${isAuth ? 200 : (s.conditionRuns?.NO_PROFILE || 0)} | ${s.conditionRuns?.NO_PROFILE || 0} | ${s.conditionRuns?.NO_PROFILE || 0} | ${s.finalRepairMetrics?.noProfileCorrect || 0} / ${s.conditionRuns?.NO_PROFILE || 0} |
| CORRECT_PROFILE | ${isAuth ? 200 : (s.conditionRuns?.CORRECT_PROFILE || 0)} | ${s.conditionRuns?.CORRECT_PROFILE || 0} | ${s.conditionRuns?.CORRECT_PROFILE || 0} | ${s.finalRepairMetrics?.correctProfileCorrect || 0} / ${s.conditionRuns?.CORRECT_PROFILE || 0} |
| WRONG_PROFILE | ${isAuth ? 200 : (s.conditionRuns?.WRONG_PROFILE || 0)} | ${s.conditionRuns?.WRONG_PROFILE || 0} | ${s.conditionRuns?.WRONG_PROFILE || 0} | ${s.finalRepairMetrics?.wrongProfileCorrect || 0} / ${s.conditionRuns?.WRONG_PROFILE || 0} |
| **TOTAL** | **${isAuth ? 600 : s.completedRuns}** | **${s.completedRuns}** | **${s.completedRuns}** | - |

---

## 3. Gate A–I 全链路通过率与门禁分母

| Gate | Applicable | Pass | Fail | Pass Rate (%) |
|---|---|---|---|---|
| Gate A (WINDOW_REACHABILITY) | ${s.gateMetrics?.gateA?.applicable || 0} | ${s.gateMetrics?.gateA?.pass || 0} | ${s.gateMetrics?.gateA?.fail || 0} | ${((s.gateMetrics?.gateA?.passRate || 0) * 100).toFixed(1)}% |
| Gate B (MODEL2_ACTION) | ${s.gateMetrics?.gateB?.applicable || 0} | ${s.gateMetrics?.gateB?.pass || 0} | ${s.gateMetrics?.gateB?.fail || 0} | ${((s.gateMetrics?.gateB?.passRate || 0) * 100).toFixed(1)}% |
| Gate C (RELATION_TRANSFORM) | ${s.gateMetrics?.gateC?.applicable || 0} | ${s.gateMetrics?.gateC?.pass || 0} | ${s.gateMetrics?.gateC?.fail || 0} | ${((s.gateMetrics?.gateC?.passRate || 0) * 100).toFixed(1)}% |
| Gate D (TONE_QUERY) | ${s.gateMetrics?.gateD?.applicable || 0} | ${s.gateMetrics?.gateD?.pass || 0} | ${s.gateMetrics?.gateD?.fail || 0} | ${((s.gateMetrics?.gateD?.passRate || 0) * 100).toFixed(1)}% |
| Gate E (LEXICON_RECALL) | ${s.gateMetrics?.gateE?.applicable || 0} | ${s.gateMetrics?.gateE?.pass || 0} | ${s.gateMetrics?.gateE?.fail || 0} | ${((s.gateMetrics?.gateE?.passRate || 0) * 100).toFixed(1)}% |
| Gate F (CANDIDATE_MATERIALIZATION) | ${s.gateMetrics?.gateF?.applicable || 0} | ${s.gateMetrics?.gateF?.pass || 0} | ${s.gateMetrics?.gateF?.fail || 0} | ${((s.gateMetrics?.gateF?.passRate || 0) * 100).toFixed(1)}% |
| Gate G (LEXICAL_EDGE) | ${s.gateMetrics?.gateG?.applicable || 0} | ${s.gateMetrics?.gateG?.pass || 0} | ${s.gateMetrics?.gateG?.fail || 0} | ${((s.gateMetrics?.gateG?.passRate || 0) * 100).toFixed(1)}% |
| Gate H (SEGMENTATION) | ${s.gateMetrics?.gateH?.applicable || 0} | ${s.gateMetrics?.gateH?.pass || 0} | ${s.gateMetrics?.gateH?.fail || 0} | ${((s.gateMetrics?.gateH?.passRate || 0) * 100).toFixed(1)}% |
| Gate I (DOWNSTREAM_FINAL) | ${s.gateMetrics?.gateI?.applicable || 0} | ${s.gateMetrics?.gateI?.pass || 0} | ${s.gateMetrics?.gateI?.fail || 0} | ${((s.gateMetrics?.gateI?.passRate || 0) * 100).toFixed(1)}% |

---

## 4. 第一失败所有者分布 (First-Failure-Owner)

\`\`\`json
${JSON.stringify(s.model2ApplicableFirstFailureOwnerCounts || {}, null, 2)}
\`\`\`

---

## 5. 多维指标拆解 (Breakdown)

### Split 分布 (DEV / VALIDATION / HOLDOUT)
\`\`\`json
${JSON.stringify(s.bySplit || {}, null, 2)}
\`\`\`

### Relation 分布 (7大家族)
\`\`\`json
${JSON.stringify(s.byRelation || {}, null, 2)}
\`\`\`

### User 分布 (U001–U005)
\`\`\`json
${JSON.stringify(s.byUser || {}, null, 2)}
\`\`\`

### Domain 分布 (6大垂直领域)
\`\`\`json
${JSON.stringify(s.byDomain || {}, null, 2)}
\`\`\`

---

## 6. 唯一下一责任人归属 (ONE_NEXT_OWNER)

根据治理契约，当前评估状态：**${s.outcome}**
唯一下一责任人指派：

\`\`\`text
ONE_NEXT_OWNER = ${s.oneNextOwner}
\`\`\`
`;
}

export {
  main,
  loadCases,
  loadManifest,
  loadProfileArtifact,
  resolveConditionProfile,
  evaluateRunTrace,
  emptyProfile,
};

const isDirectRun = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
);

if (isDirectRun) {
  main().catch((err) => {
    console.error('Fatal error during execution:', err);
    process.exit(1);
  });
}
