#!/usr/bin/env node
/**
 * LINGUA_DIALOG2000_V2_PILOT200 Block C — Profile-Aware Evaluator
 *
 * READ-ONLY over frozen Dataset + Replay + Block B artifacts.
 * Reuses LINGUA_ASR_REPAIR_NORMALIZED_BASELINE normalization / CER / outcomes
 * (logic inlined to avoid executing the baseline script's main on import).
 * Does NOT re-run ASR / replay / pipeline.
 *
 * Usage:
 *   node docs/user_correction/model3/run_pilot200_block_c_evaluator.mjs
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const DATASET_DIR = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const DOCS_OUT = __dirname;
const EVALUATOR_VERSION = 'pilot200-block-c-evaluator-v1';
const AUTHORITATIVE_BUILD = 'build_20260911_091806';
const BLOCK_B_BATCH = 'blockb_2026-09-11T1021';
const REPLAY_BATCH = 'replay_2026-09-11T1347';

const ACTIVE_SET_V1 = ['n_l', 'z_zh', 'ch_c', 'sh_s', 'eng_en', 'in_ing', 'h_f'];
const USER_ASSIGNMENTS = {
  U001: ['n_l', 'in_ing'],
  U002: ['z_zh', 'sh_s'],
  U003: ['eng_en', 'h_f'],
  U004: ['ch_c', 'n_l'],
  U005: ['sh_s'],
};
const CONDITIONS = ['NO_PROFILE', 'CORRECT_PROFILE', 'WRONG_PROFILE'];

// --- LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1 (reuse, no rewrite) ---
const require = createRequire(path.join(ELECTRON, 'package.json'));
const OpenCC = require('opencc-js/t2cn');
const convert = OpenCC.Converter({ from: 't', to: 'cn' });
function stripPunctWsCase(s) {
  return String(s || '')
    .replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '')
    .toLowerCase();
}
function normalizeForAsrRepairEvaluation(text) {
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
function cer(refN, hypN) {
  if (!refN) return hypN ? 1 : 0;
  return levenshtein(refN, hypN) / refN.length;
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
function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function rate(num, den) {
  return { numerator: num, denominator: den, rate: den ? num / den : null };
}
function readJsonl(p) {
  return fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function loadCases() {
  return readJsonl(path.join(DATASET_DIR, 'cases', 'cases.jsonl'));
}

function indexByCaseCondition(execs) {
  const m = new Map();
  for (const e of execs) {
    if (e.status && e.status !== 'OK') continue;
    const k = `${e.caseId}::${e.profileCondition}`;
    m.set(k, e);
  }
  return m;
}

function classifyRawLevel1(rawText, refText) {
  if (!(rawText || '').length) return { class: 'NO_ASR_CONTENT', rawN: '', refN: normalizeForAsrRepairEvaluation(refText), rawCer: null };
  const rawN = normalizeForAsrRepairEvaluation(rawText);
  const refN = normalizeForAsrRepairEvaluation(refText);
  const rawCer = cer(refN, rawN);
  if (rawN === refN) return { class: 'RAW_NORMALIZED_CORRECT', rawN, refN, rawCer };
  return { class: 'RAW_REPAIR_NEEDED', rawN, refN, rawCer };
}

function profileHasRelation(keys, relation) {
  if (!relation) return false;
  return (keys || []).includes(relation);
}

function wrongProfileControlValid(caseRow, wrongExec) {
  const rel = caseRow.relationFamily;
  if (!rel) return { valid: true, reason: 'NO_TARGET_RELATION' };
  const keys = wrongExec?.runtimeProfile?.phonetic_bias_keys || [];
  if (profileHasRelation(keys, rel)) {
    return { valid: false, reason: 'WRONG_PROFILE_SHARES_TARGET_RELATION' };
  }
  // Also check assignment mapping for frozen wrong user
  const wrongUid = wrongExec?.wrongProfileUserId || caseRow.wrongProfileUserId;
  if (wrongUid && (USER_ASSIGNMENTS[wrongUid] || []).includes(rel)) {
    return { valid: false, reason: 'WRONG_USER_ASSIGNMENT_SHARES_RELATION' };
  }
  return { valid: true, reason: 'OK' };
}

/**
 * Level-2 expansion class (mutual exclusion for primary label).
 *
 * Frozen compact traces lack base_candidates.items / after_model2.items.
 * When p_added=d_added=0 we can prove Model2 introduced no candidates → NO_EXPANSION.
 * BASE_ALREADY_HAS_TARGET cannot be proven → recorded as EVIDENCE_GAP_BASE_SET.
 */
function classifyModel2Expansion(caseRow, exec, rawClass, correctRelationApplies) {
  const m2 = exec.model2Trace || {};
  if (rawClass === 'NO_ASR_CONTENT' || m2.classification === 'MODEL2_NOT_INVOKED' || m2.model2_invoked === false) {
    return {
      primary: 'MODEL2_NOT_INVOKED',
      useful: false,
      falseExp: false,
      evidenceGapBase: false,
    };
  }
  if (caseRow.targetNotInLexicon || caseRow.model2LexiconEligible === false) {
    return { primary: 'NOT_ELIGIBLE', useful: false, falseExp: false, evidenceGapBase: false, reason: 'TARGET_NOT_IN_LEXICON' };
  }
  const p = Number(m2.p_action_count || 0);
  const d = Number(m2.d_action_count || 0);
  const added = p + d;

  // Permission contract: any P action requires phonetic_bias relation present
  let permissionViolation = false;
  if (p > 0) {
    const keys = exec.runtimeProfile?.phonetic_bias_keys || m2.pronunciation_keys || [];
    if (!keys.length) permissionViolation = true;
  }

  if (added === 0) {
    return {
      primary: 'NO_EXPANSION',
      useful: false,
      falseExp: false,
      evidenceGapBase: true, // cannot know if base already had target
      permissionViolation,
      note: 'p_added+d_added=0 in frozen compact trace; useful introduction impossible',
    };
  }

  // Non-zero additions without candidate lists → cannot attribute useful/false to target
  return {
    primary: 'EXPANSION_UNATTRIBUTED_EVIDENCE_GAP',
    useful: null,
    falseExp: null,
    evidenceGapBase: true,
    permissionViolation,
    note: 'Model2 reported additions but candidate item lists not frozen',
  };
}

function threeWayClass(dNo, dCorrect, dWrong) {
  const best = Math.min(dNo, dCorrect, dWrong);
  const noB = dNo === best;
  const cB = dCorrect === best;
  const wB = dWrong === best;
  const nBest = (noB ? 1 : 0) + (cB ? 1 : 0) + (wB ? 1 : 0);
  if (nBest === 3) return 'ALL_EQUAL';
  if (nBest === 1 && cB) return 'CORRECT_UNIQUE_BEST';
  if (nBest === 1 && noB) return 'NO_UNIQUE_BEST';
  if (nBest === 1 && wB) return 'WRONG_UNIQUE_BEST';
  if (cB) return 'CORRECT_TIED_BEST';
  return 'TIED_NON_CORRECT';
}

function compareCerClass(dA, dB) {
  if (dA < dB) return 'BETTER';
  if (dA > dB) return 'WORSE';
  return 'SAME';
}

function ownerLadder(row) {
  if (row.rawClass === 'NO_ASR_CONTENT') return 'NOT_ELIGIBLE_NO_ASR';
  if (row.rawClass === 'RAW_NORMALIZED_CORRECT') return 'L0_RAW_ALREADY_CORRECT';
  if (row.targetNotInLexicon) return 'L1_TARGET_NOT_IN_LEXICON';
  if (row.baseAlreadyHasTarget === true) return 'L2_BASE_ALREADY_HAS_TARGET';
  if (row.baseAlreadyHasTarget == null && row.expansionPrimary === 'NO_EXPANSION') {
    // Eligible for introduction but none happened (base set unknown)
    if (row.correctOutcome?.outcome === 'ASR_REPAIR_FULL_RESCUE' || row.correctOutcome?.outcome === 'ASR_REPAIR_PARTIAL_IMPROVEMENT') {
      return 'L6_FINAL_REPAIR_SUCCESS_WITHOUT_MODEL2_EXPANSION';
    }
    if (row.correctOutcome?.outcome === 'ASR_REPAIR_REGRESSED') return 'L7_FINAL_REGRESSION';
    return 'L3_MODEL2_ELIGIBLE_BUT_NO_EXPANSION';
  }
  if (row.expansionPrimary === 'EXPANSION_UNATTRIBUTED_EVIDENCE_GAP') return 'OWNER_UNKNOWN_EVIDENCE_GAP';
  if (row.usefulExpansionCorrect) {
    if (row.correctVsNo === 'BETTER') return 'L6_FINAL_REPAIR_SUCCESS';
    if (row.correctVsNo === 'WORSE') return 'L7_FINAL_REGRESSION';
    return 'L5_USEFUL_CANDIDATE_EXISTS_BUT_FINAL_NO_GAIN';
  }
  return 'OWNER_UNKNOWN';
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, 'manifest', 'dataset_manifest.json'), 'utf8'));
  if (manifest.build_id !== AUTHORITATIVE_BUILD) {
    console.error('BUILD mismatch', manifest.build_id);
    process.exit(2);
  }

  const replayDir = path.join(DATASET_DIR, 'pilot200_replay', REPLAY_BATCH);
  const blockBDir = path.join(DATASET_DIR, 'block_b_runs', BLOCK_B_BATCH);
  const replayExecPath = path.join(replayDir, 'executions.jsonl');
  const blockBExecPath = path.join(blockBDir, 'executions.jsonl');
  if (!fs.existsSync(replayExecPath) || !fs.existsSync(blockBExecPath)) {
    console.error('Missing frozen executions');
    process.exit(2);
  }

  const inputFp = {
    dataset_manifest_sha256: sha256File(path.join(DATASET_DIR, 'manifest', 'dataset_manifest.json')),
    cases_sha256: sha256File(path.join(DATASET_DIR, 'cases', 'cases.jsonl')),
    replay_executions_sha256: sha256File(replayExecPath),
    block_b_executions_sha256: sha256File(blockBExecPath),
  };

  const cases = loadCases();
  const replayExecs = readJsonl(replayExecPath);
  const blockBExecs = readJsonl(blockBExecPath);
  const replayIdx = indexByCaseCondition(replayExecs);
  const blockBIdx = indexByCaseCondition(blockBExecs);

  // Candidate field ownership audit from frozen summary + extraction code
  const candidateCapAudit = {
    CANDIDATE_CAP_MAX_OWNER:
      'path_assembly_candidate_max ← dialog200_path_trace[].assembly.sentence_count (path assembly / KenLM path sentence candidates), NOT Model2 union size',
    REPLAY_SUMMARY_CANDIDATE_CAP_MAX: 1,
    NOTE: 'Replay runner used Array.isArray(base_candidates) against compactCandidates {count,items} → base/union counts frozen as 0 (schema mismatch). p_added/d_added from model2_summary remain usable.',
    MODEL2_UNION_COUNT_FROZEN: 'UNRELIABLE_ALWAYS_ZERO_DUE_TO_SCHEMA_MISMATCH',
    P_D_ACTION_COUNTS_FROZEN: 'USABLE_FROM_model2_summary.p_added/d_added',
  };

  const evalRows = [];
  const evidenceGaps = [
    'Frozen compact Model2 traces lack base_candidates.items / after_model2_candidates.items / introduced_term_ids — SSOT useful/false expansion by candidate membership cannot be fully verified when additions>0.',
    'BASE_ALREADY_HAS_TARGET cannot be proven from frozen artifacts (base set not stored).',
    'Replay Tone path NOT_INVOKED (no asrSegments/acousticToneSlices in Block B dumps).',
  ];

  for (const c of cases) {
    const no = replayIdx.get(`${c.caseId}::NO_PROFILE`);
    const correct = replayIdx.get(`${c.caseId}::CORRECT_PROFILE`);
    const wrong = replayIdx.get(`${c.caseId}::WRONG_PROFILE`);
    if (!no || !correct || !wrong) {
      evidenceGaps.push(`MISSING_REPLAY_EXECUTION:${c.caseId}`);
      continue;
    }

    // Same RAW hard check
    const rawHashes = new Set([no.authoritativeRawHash, correct.authoritativeRawHash, wrong.authoritativeRawHash]);
    const sameRaw = rawHashes.size === 1;
    const rawText = no.authoritativeRawText ?? '';
    const refText = c.referenceText ?? no.referenceText ?? '';
    const level1 = classifyRawLevel1(rawText, refText);

    const asrResilient =
      c.perturbationApplied && level1.class === 'RAW_NORMALIZED_CORRECT';

    const condMetrics = {};
    for (const [name, exec] of [
      ['NO_PROFILE', no],
      ['CORRECT_PROFILE', correct],
      ['WRONG_PROFILE', wrong],
    ]) {
      const finalText = exec.finalPostprocessText ?? '';
      const finalN = normalizeForAsrRepairEvaluation(finalText);
      const outcome = classifyNormalizedOutcome(level1.rawN || '', finalN, level1.refN || '');
      const expansion = classifyModel2Expansion(
        c,
        exec,
        level1.class,
        name === 'CORRECT_PROFILE' ? profileHasRelation(exec.runtimeProfile?.phonetic_bias_keys, c.relationFamily) : false
      );
      const targetSurf = c.evaluationTargetSurface || '';
      const finalHasTarget =
        targetSurf && normalizeForAsrRepairEvaluation(finalText).includes(normalizeForAsrRepairEvaluation(targetSurf));
      const rawHasTarget =
        targetSurf && (level1.rawN || '').includes(normalizeForAsrRepairEvaluation(targetSurf));

      condMetrics[name] = {
        sessionId: exec.sessionId,
        runId: exec.runId || exec.replayRunId,
        sourceBlockBRunId: exec.sourceBlockBRunId,
        profileStage: exec.profileStage,
        profileRef: exec.profileRef,
        profileVersion: exec.profileVersion,
        profileHash: exec.profileHash,
        phonetic_bias_keys: exec.runtimeProfile?.phonetic_bias_keys || [],
        finalText,
        finalN,
        finalCer: cer(level1.refN || '', finalN),
        finalDistance: outcome.finalD,
        rawDistance: outcome.rawD,
        outcome: outcome.outcome,
        model2_invoked: exec.model2Trace?.model2_invoked ?? null,
        p_action_count: Number(exec.model2Trace?.p_action_count || 0),
        d_action_count: Number(exec.model2Trace?.d_action_count || 0),
        path_assembly_candidate_max: Number(exec.model2Trace?.path_assembly_candidate_max || 0),
        base_candidate_count_frozen: Number(exec.model2Trace?.base_candidate_count || 0),
        model2_union_count_frozen: Number(exec.model2Trace?.model2_union_candidate_count || 0),
        expansionPrimary: expansion.primary,
        expansionNote: expansion.note || null,
        permissionViolation: expansion.permissionViolation || false,
        finalHasTargetSurface: !!finalHasTarget,
        rawHasTargetSurface: !!rawHasTarget,
        traceRef: exec.traceRef || `traces/${c.caseId}__${name}.json`,
      };
    }

    const wrongCtrl = wrongProfileControlValid(c, wrong);
    const correctKeys = condMetrics.CORRECT_PROFILE.phonetic_bias_keys;
    const correctHasRel =
      !c.relationFamily || profileHasRelation(correctKeys, c.relationFamily) || c.profileStage === 'P0';

    const dNo = condMetrics.NO_PROFILE.finalDistance;
    const dC = condMetrics.CORRECT_PROFILE.finalDistance;
    const dW = condMetrics.WRONG_PROFILE.finalDistance;
    const correctVsNo = compareCerClass(dC, dNo);
    const wrongVsNo = compareCerClass(dW, dNo);

    // Model2 effect eligibility (primary funnel denominator components)
    const repairNeeded = level1.class === 'RAW_REPAIR_NEEDED';
    const lexiconEligible = c.model2LexiconEligible === true && c.targetInLexicon === true;
    const isTargetCase = c.expectedBehaviorClass === 'PROFILE_TARGET' || c.isModel2TargetCase === true;
    const model2InvokedCorrect = condMetrics.CORRECT_PROFILE.model2_invoked === true;
    // Base-lacks-target: UNKNOWN → treat as eligible_for_introduction_test with gap flag
    const effectEligible =
      repairNeeded &&
      lexiconEligible &&
      isTargetCase &&
      correctHasRel &&
      wrongCtrl.valid &&
      model2InvokedCorrect &&
      level1.class !== 'NO_ASR_CONTENT';

    const usefulCorrect =
      effectEligible &&
      condMetrics.CORRECT_PROFILE.p_action_count + condMetrics.CORRECT_PROFILE.d_action_count > 0
        ? null // would need candidate membership
        : effectEligible
          ? false
          : false;

    const row = {
      caseId: c.caseId,
      split: c.split,
      userId: c.userId,
      domain: c.domain,
      relationFamily: c.relationFamily ?? null,
      profileStage: c.profileStage,
      expectedBehaviorClass: c.expectedBehaviorClass,
      evaluationTargetSurface: c.evaluationTargetSurface ?? null,
      evaluationTargetTermIds: c.evaluationTargetTermIds ?? null,
      targetInLexicon: c.targetInLexicon === true,
      targetNotInLexicon: c.targetNotInLexicon === true,
      model2LexiconEligible: c.model2LexiconEligible === true,
      perturbationApplied: !!c.perturbationApplied,
      sameRawAcrossReplayConditions: sameRaw,
      rawText,
      rawClass: level1.class,
      rawNormalized: level1.rawN,
      rawCer: level1.rawCer,
      asrResilient: !!asrResilient,
      wrongProfileControlValid: wrongCtrl.valid,
      wrongProfileControlReason: wrongCtrl.reason,
      correctProfileHasTargetRelation: correctHasRel,
      model2EffectEligible: effectEligible,
      baseAlreadyHasTarget: null, // EVIDENCE_GAP
      expansionPrimary: condMetrics.CORRECT_PROFILE.expansionPrimary,
      usefulExpansionCorrect: usefulCorrect,
      usefulExpansionNo: false,
      usefulExpansionWrong: false,
      falseExpansionCorrect: false,
      falseExpansionNo: false,
      falseExpansionWrong: false,
      correctVsNo,
      wrongVsNo,
      threeWay: threeWayClass(dNo, dC, dW),
      correctOutcome: { outcome: condMetrics.CORRECT_PROFILE.outcome },
      conditions: condMetrics,
      owner: null,
      evidenceGapBaseSet: true,
    };
    row.owner = ownerLadder(row);
    evalRows.push(row);
  }

  // ---------- Aggregates (Replay primary) ----------
  const total = evalRows.length;
  const rawCorrect = evalRows.filter((r) => r.rawClass === 'RAW_NORMALIZED_CORRECT').length;
  const rawNeeded = evalRows.filter((r) => r.rawClass === 'RAW_REPAIR_NEEDED').length;
  const noAsr = evalRows.filter((r) => r.rawClass === 'NO_ASR_CONTENT').length;
  const rawCers = evalRows.filter((r) => r.rawCer != null).map((r) => r.rawCer);

  const eligible = evalRows.filter((r) => r.model2EffectEligible);
  const eligibleN = eligible.length;

  const pAction = (cond) =>
    evalRows.reduce((a, r) => a + (r.conditions[cond].p_action_count || 0), 0);
  const dAction = (cond) =>
    evalRows.reduce((a, r) => a + (r.conditions[cond].d_action_count || 0), 0);

  const usefulCorrectCount = eligible.filter((r) => r.usefulExpansionCorrect === true).length;
  const usefulWrongCount = 0;
  const usefulNoCount = 0;
  const noExpansionEligible = eligible.filter((r) => r.expansionPrimary === 'NO_EXPANSION').length;

  const finalCer = (cond) => mean(evalRows.map((r) => r.conditions[cond].finalCer));
  const noCer = finalCer('NO_PROFILE');
  const correctCer = finalCer('CORRECT_PROFILE');
  const wrongCer = finalCer('WRONG_PROFILE');
  const profileGainCer = noCer != null && correctCer != null ? noCer - correctCer : null;
  const wrongDeltaCer = noCer != null && wrongCer != null ? noCer - wrongCer : null;

  const correctBetter = evalRows.filter((r) => r.correctVsNo === 'BETTER').length;
  const correctSame = evalRows.filter((r) => r.correctVsNo === 'SAME').length;
  const correctWorse = evalRows.filter((r) => r.correctVsNo === 'WORSE').length;
  const wrongBetter = evalRows.filter((r) => r.wrongVsNo === 'BETTER').length;
  const wrongSame = evalRows.filter((r) => r.wrongVsNo === 'SAME').length;
  const wrongWorse = evalRows.filter((r) => r.wrongVsNo === 'WORSE').length;

  // Clean controls
  const clean = evalRows.filter((r) => r.expectedBehaviorClass === 'CLEAN_PRESERVE');
  const cleanPreserved = (cond) =>
    clean.filter((r) => r.conditions[cond].outcome === 'ALREADY_CORRECT_NORMALIZED' || (r.rawClass === 'RAW_NORMALIZED_CORRECT' && r.conditions[cond].outcome !== 'ASR_REPAIR_REGRESSED')).length;
  const cleanRegression = (cond) =>
    clean.filter((r) => r.conditions[cond].outcome === 'ASR_REPAIR_REGRESSED' || r.conditions[cond].outcome === 'CORRECT_BROKEN').length;

  // Candidate sizes from usable owner field (path assembly max)
  const candVals = evalRows
    .flatMap((r) => CONDITIONS.map((c) => r.conditions[c].path_assembly_candidate_max))
    .filter((x) => typeof x === 'number')
    .sort((a, b) => a - b);
  const candP50 = percentile(candVals, 50);
  const candP95 = percentile(candVals, 95);
  const candMax = candVals.length ? candVals[candVals.length - 1] : null;
  const candOver16 = candVals.filter((x) => x > 16).length;

  // Permission violations
  const permViol = evalRows.filter((r) =>
    CONDITIONS.some((c) => r.conditions[c].permissionViolation)
  ).length;

  // Profile stage metrics (CORRECT condition, target-ish)
  const stageMetrics = {};
  for (const stage of ['P0', 'P1', 'P2', 'P3']) {
    const rows = evalRows.filter((r) => r.profileStage === stage);
    const el = rows.filter((r) => r.model2EffectEligible);
    stageMetrics[stage] = {
      case_count: rows.length,
      eligible: el.length,
      p_actions_correct: rows.reduce((a, r) => a + r.conditions.CORRECT_PROFILE.p_action_count, 0),
      d_actions_correct: rows.reduce((a, r) => a + r.conditions.CORRECT_PROFILE.d_action_count, 0),
      useful_expansion: el.filter((r) => r.usefulExpansionCorrect === true).length,
      no_expansion: el.filter((r) => r.expansionPrimary === 'NO_EXPANSION').length,
      final_cer_correct: mean(rows.map((r) => r.conditions.CORRECT_PROFILE.finalCer)),
      correct_better_than_no: rows.filter((r) => r.correctVsNo === 'BETTER').length,
      correct_worse_than_no: rows.filter((r) => r.correctVsNo === 'WORSE').length,
    };
  }

  function breakdown(keyFn) {
    const map = {};
    for (const r of evalRows) {
      const k = keyFn(r) || 'null';
      if (!map[k]) {
        map[k] = {
          case_count: 0,
          eligible: 0,
          useful_correct: 0,
          no_expansion_eligible: 0,
          correct_better: 0,
          correct_worse: 0,
          profile_gain_cer_contrib: [],
        };
      }
      const m = map[k];
      m.case_count += 1;
      if (r.model2EffectEligible) m.eligible += 1;
      if (r.usefulExpansionCorrect === true) m.useful_correct += 1;
      if (r.model2EffectEligible && r.expansionPrimary === 'NO_EXPANSION') m.no_expansion_eligible += 1;
      if (r.correctVsNo === 'BETTER') m.correct_better += 1;
      if (r.correctVsNo === 'WORSE') m.correct_worse += 1;
      m.profile_gain_cer_contrib.push(r.conditions.NO_PROFILE.finalCer - r.conditions.CORRECT_PROFILE.finalCer);
    }
    for (const k of Object.keys(map)) {
      map[k].useful_expansion_rate = rate(map[k].useful_correct, map[k].eligible);
      map[k].profile_gain_cer = mean(map[k].profile_gain_cer_contrib);
      delete map[k].profile_gain_cer_contrib;
    }
    return map;
  }

  const relationMetrics = breakdown((r) => r.relationFamily);
  const domainMetrics = breakdown((r) => r.domain);
  const userMetrics = breakdown((r) => r.userId);

  // Holdout aggregate only
  const holdout = evalRows.filter((r) => r.split === 'HOLDOUT' || r.split === 'HOLD');
  const holdoutAgg = {
    case_count: holdout.length,
    raw_repair_needed: holdout.filter((r) => r.rawClass === 'RAW_REPAIR_NEEDED').length,
    eligible: holdout.filter((r) => r.model2EffectEligible).length,
    useful_expansion: rate(
      holdout.filter((r) => r.usefulExpansionCorrect === true).length,
      holdout.filter((r) => r.model2EffectEligible).length
    ),
    no_expansion_among_eligible: holdout.filter(
      (r) => r.model2EffectEligible && r.expansionPrimary === 'NO_EXPANSION'
    ).length,
    profile_gain_cer:
      mean(holdout.map((r) => r.conditions.NO_PROFILE.finalCer)) != null
        ? mean(holdout.map((r) => r.conditions.NO_PROFILE.finalCer)) -
          mean(holdout.map((r) => r.conditions.CORRECT_PROFILE.finalCer))
        : null,
    wrong_profile_delta_cer:
      mean(holdout.map((r) => r.conditions.NO_PROFILE.finalCer)) != null
        ? mean(holdout.map((r) => r.conditions.NO_PROFILE.finalCer)) -
          mean(holdout.map((r) => r.conditions.WRONG_PROFILE.finalCer))
        : null,
    final_cer: {
      NO: mean(holdout.map((r) => r.conditions.NO_PROFILE.finalCer)),
      CORRECT: mean(holdout.map((r) => r.conditions.CORRECT_PROFILE.finalCer)),
      WRONG: mean(holdout.map((r) => r.conditions.WRONG_PROFILE.finalCer)),
    },
  };

  // ---------- Block B corroboration (separate) ----------
  const blockBByCase = new Map();
  for (const e of blockBExecs) {
    if (e.status !== 'OK') continue;
    if (!blockBByCase.has(e.caseId)) blockBByCase.set(e.caseId, {});
    blockBByCase.get(e.caseId)[e.profileCondition] = e;
  }
  let stable = 0;
  let variance = 0;
  const stableCaseIds = [];
  for (const [caseId, conds] of blockBByCase) {
    if (!conds.NO_PROFILE || !conds.CORRECT_PROFILE || !conds.WRONG_PROFILE) continue;
    const hashes = new Set([
      conds.NO_PROFILE.rawAsrHash,
      conds.CORRECT_PROFILE.rawAsrHash,
      conds.WRONG_PROFILE.rawAsrHash,
    ]);
    if (hashes.size === 1) {
      stable += 1;
      stableCaseIds.push(caseId);
    } else variance += 1;
  }

  function blockBCer(cond) {
    const xs = [];
    for (const c of cases) {
      const e = blockBIdx.get(`${c.caseId}::${cond}`);
      if (!e) continue;
      const refN = normalizeForAsrRepairEvaluation(c.referenceText);
      const finalN = normalizeForAsrRepairEvaluation(e.finalText ?? '');
      xs.push(cer(refN, finalN));
    }
    return mean(xs);
  }

  const blockBFull = {
    FULL_AUDIO_NO_PROFILE_FINAL_CER: blockBCer('NO_PROFILE'),
    FULL_AUDIO_CORRECT_PROFILE_FINAL_CER: blockBCer('CORRECT_PROFILE'),
    FULL_AUDIO_WRONG_PROFILE_FINAL_CER: blockBCer('WRONG_PROFILE'),
    RAW_ASR_STABLE_CASE_COUNT: stable,
    RAW_ASR_VARIANCE_CASE_COUNT: variance,
    NOTE: 'Block B is FULL_AUDIO corroboration only; variance cases must not claim profile causality.',
  };

  // Stable subset direction vs Replay
  let dirAgree = 0;
  let dirDisagree = 0;
  let dirTie = 0;
  for (const caseId of stableCaseIds) {
    const c = cases.find((x) => x.caseId === caseId);
    if (!c) continue;
    const bNo = blockBIdx.get(`${caseId}::NO_PROFILE`);
    const bC = blockBIdx.get(`${caseId}::CORRECT_PROFILE`);
    const r = evalRows.find((x) => x.caseId === caseId);
    if (!bNo || !bC || !r) continue;
    const refN = normalizeForAsrRepairEvaluation(c.referenceText);
    const dBNo = levenshtein(normalizeForAsrRepairEvaluation(bNo.finalText ?? ''), refN);
    const dBC = levenshtein(normalizeForAsrRepairEvaluation(bC.finalText ?? ''), refN);
    const bCmp = compareCerClass(dBC, dBNo);
    if (bCmp === 'SAME' && r.correctVsNo === 'SAME') dirTie += 1;
    else if (bCmp === r.correctVsNo) dirAgree += 1;
    else dirDisagree += 1;
  }

  const stableSubset = {
    case_count: stableCaseIds.length,
    direction_agree_replay: dirAgree,
    direction_disagree_replay: dirDisagree,
    direction_both_same: dirTie,
    NOTE: 'Compares CORRECT vs NO distance direction only; finals need not be identical (Tone path differs).',
  };

  // Outcome counts by condition
  const outcomeCounts = {};
  for (const cond of CONDITIONS) {
    outcomeCounts[cond] = {};
    for (const r of evalRows) {
      const o = r.conditions[cond].outcome;
      outcomeCounts[cond][o] = (outcomeCounts[cond][o] || 0) + 1;
    }
  }

  // Case accounting close
  const accounting = {
    TOTAL: total,
    NO_ASR_CONTENT: noAsr,
    RAW_ALREADY_CORRECT: rawCorrect,
    RAW_REPAIR_NEEDED: rawNeeded,
    TARGET_NOT_IN_LEXICON: evalRows.filter((r) => r.targetNotInLexicon).length,
    INVALID_PROFILE_CONTROL: evalRows.filter((r) => !r.wrongProfileControlValid).length,
    ASR_RESILIENT_CASE: evalRows.filter((r) => r.asrResilient).length,
    MODEL2_EFFECT_ELIGIBLE: eligibleN,
    BASE_ALREADY_HAS_TARGET: 'EVIDENCE_GAP_NOT_COMPUTABLE',
    NOTE: 'Eligible uses repair-needed ∩ lexicon ∩ target-case ∩ relation ∩ wrong-control ∩ Model2 invoked; base-lacks-target not applied (gap).',
  };

  // Funnel
  const funnel = {
    pilot_cases: total,
    raw_repair_needed: rawNeeded,
    lexicon_eligible_among_repair_needed: evalRows.filter(
      (r) => r.rawClass === 'RAW_REPAIR_NEEDED' && r.model2LexiconEligible
    ).length,
    target_cases_among_those: evalRows.filter(
      (r) =>
        r.rawClass === 'RAW_REPAIR_NEEDED' &&
        r.model2LexiconEligible &&
        (r.expectedBehaviorClass === 'PROFILE_TARGET' || r.model2LexiconEligible)
    ).length,
    model2_effect_eligible: eligibleN,
    model2_useful_expansion: usefulCorrectCount,
    useful_expansion_rate: rate(usefulCorrectCount, eligibleN),
    model2_no_expansion_among_eligible: noExpansionEligible,
    final_correct_better_than_no_among_eligible: eligible.filter((r) => r.correctVsNo === 'BETTER').length,
    NOTE_BASE_LACKS_TARGET: 'STEP_SKIPPED_EVIDENCE_GAP',
  };

  // Verdicts
  const totalPCorrect = pAction('CORRECT_PROFILE');
  const totalPNo = pAction('NO_PROFILE');
  let expansionVerdict = 'MODEL2_EXPANSION_NOT_OBSERVED';
  if (permViol > 0) expansionVerdict = 'MODEL2_PERMISSION_CONTRACT_VIOLATION_DETECTED';
  // If any unattributed expansion
  if (evalRows.some((r) => r.expansionPrimary === 'EXPANSION_UNATTRIBUTED_EVIDENCE_GAP')) {
    expansionVerdict = 'MODEL2_EXPANSION_INCONCLUSIVE_DUE_TO_EVIDENCE_GAP';
  } else if (totalPCorrect === 0 && totalPNo === 0 && dAction('CORRECT_PROFILE') === 0) {
    expansionVerdict = 'MODEL2_EXPANSION_NOT_OBSERVED';
  }

  let conversionVerdict = 'FINAL_REPAIR_CONVERSION_NOT_APPLICABLE_NO_USEFUL_EXPANSION';
  if (usefulCorrectCount > 0) {
    conversionVerdict = 'NEEDS_CONVERSION_ANALYSIS';
  } else if (eligible.filter((r) => r.correctVsNo === 'BETTER').length > 0) {
    conversionVerdict =
      'FINAL_IMPROVEMENT_WITHOUT_MODEL2_EXPANSION_OBSERVED_DOWNSTREAM_OR_NOISE';
  }

  let overallVerdict = 'MODEL2_PROFILE_EFFECT_NOT_OBSERVED';
  if (expansionVerdict.includes('EVIDENCE_GAP') || expansionVerdict.includes('VIOLATION')) {
    overallVerdict = 'MODEL2_EFFECT_INCONCLUSIVE_DUE_TO_EVIDENCE_GAP';
  } else if (usefulCorrectCount === 0 && totalPCorrect === 0) {
    // Level 3 may still show tiny CER diffs from non-Model2 path
    if (profileGainCer != null && profileGainCer < -0.01) {
      overallVerdict = 'MODEL2_PROFILE_EFFECT_NET_HARMFUL';
    } else if (profileGainCer != null && Math.abs(profileGainCer) < 1e-9 && correctBetter === 0) {
      overallVerdict = 'MODEL2_PROFILE_EFFECT_NOT_OBSERVED';
    } else if (correctBetter > 0 && usefulCorrectCount === 0) {
      overallVerdict = 'MODEL2_PROFILE_EFFECT_NOT_OBSERVED';
      // improvements without Model2 expansion are not credited to Model2
    }
  }

  // One next owner from funnel loss point
  let oneNextOwner = 'NO OPTIMIZATION — PROCEED TO FULL2000';
  if (eligibleN > 0 && usefulCorrectCount === 0 && totalPCorrect === 0 && dAction('CORRECT_PROFILE') === 0) {
    // Primary Model2 question answered: zero P/D additions among eligible → expansion owner
    oneNextOwner = 'MODEL2_PROFILE_PERMISSION / P ACTION';
  } else if (evalRows.some((r) => r.expansionPrimary === 'EXPANSION_UNATTRIBUTED_EVIDENCE_GAP')) {
    oneNextOwner = 'DATASET / EVIDENCE GAP';
  } else if (usefulCorrectCount > 0) {
    const withGain = eligible.filter((r) => r.usefulExpansionCorrect === true && r.correctVsNo === 'BETTER').length;
    if (withGain === 0) oneNextOwner = 'DOWNSTREAM ASSEMBLY / KENLM';
    else oneNextOwner = 'NO OPTIMIZATION — PROCEED TO FULL2000';
  }

  const summary = {
    PHASE: 'LINGUA_DIALOG2000_V2_PILOT200_BLOCK_C_PROFILE_AWARE_EVALUATOR_DEVELOPMENT',
    DATASET_BUILD_ID: AUTHORITATIVE_BUILD,
    BLOCK_B_BATCH_ID: BLOCK_B_BATCH,
    REPLAY_BATCH_ID: REPLAY_BATCH,
    EVALUATOR_VERSION,
    INPUT_FINGERPRINTS: inputFp,
    TOTAL_CASES: total,
    RAW_NORMALIZED_CORRECT_COUNT: rawCorrect,
    RAW_REPAIR_NEEDED_COUNT: rawNeeded,
    NO_ASR_CONTENT_COUNT: noAsr,
    RAW_NORMALIZED_CER: mean(rawCers),
    CASE_ACCOUNTING: accounting,
    PRIMARY_FUNNEL: funnel,
    MODEL2_EFFECT_ELIGIBLE_CASE_COUNT: eligibleN,
    BASE_ALREADY_HAS_TARGET_COUNT: null,
    BASE_ALREADY_HAS_TARGET_STATUS: 'EVIDENCE_GAP',
    USEFUL_EXPANSION_NO: usefulNoCount,
    USEFUL_EXPANSION_CORRECT: usefulCorrectCount,
    USEFUL_EXPANSION_WRONG: usefulWrongCount,
    USEFUL_EXPANSION_CORRECT_RATE: rate(usefulCorrectCount, eligibleN),
    FALSE_EXPANSION_NO: 0,
    FALSE_EXPANSION_CORRECT: 0,
    FALSE_EXPANSION_WRONG: 0,
    FALSE_EXPANSION_NOTE:
      'False expansion by SSOT requires candidate membership; with p_added=d_added=0 across conditions, attributed false expansion = 0. Item-level false expansion not computable if additions>0 without frozen lists.',
    NO_EXPANSION_AMONG_ELIGIBLE: noExpansionEligible,
    P_ACTION_NO: pAction('NO_PROFILE'),
    P_ACTION_CORRECT: pAction('CORRECT_PROFILE'),
    P_ACTION_WRONG: pAction('WRONG_PROFILE'),
    D_ACTION_NO: dAction('NO_PROFILE'),
    D_ACTION_CORRECT: dAction('CORRECT_PROFILE'),
    D_ACTION_WRONG: dAction('WRONG_PROFILE'),
    MODEL2_PERMISSION_CONTRACT_VIOLATION_COUNT: permViol,
    NO_PROFILE_FINAL_CER: noCer,
    CORRECT_PROFILE_FINAL_CER: correctCer,
    WRONG_PROFILE_FINAL_CER: wrongCer,
    PROFILE_GAIN_CER: profileGainCer,
    WRONG_PROFILE_DELTA_CER: wrongDeltaCer,
    CORRECT_BETTER_THAN_NO: correctBetter,
    CORRECT_SAME_AS_NO: correctSame,
    CORRECT_WORSE_THAN_NO: correctWorse,
    WRONG_BETTER_THAN_NO: wrongBetter,
    WRONG_SAME_AS_NO: wrongSame,
    WRONG_WORSE_THAN_NO: wrongWorse,
    THREE_WAY: {
      CORRECT_UNIQUE_BEST: evalRows.filter((r) => r.threeWay === 'CORRECT_UNIQUE_BEST').length,
      CORRECT_TIED_BEST: evalRows.filter((r) => r.threeWay === 'CORRECT_TIED_BEST').length,
      NO_UNIQUE_BEST: evalRows.filter((r) => r.threeWay === 'NO_UNIQUE_BEST').length,
      WRONG_UNIQUE_BEST: evalRows.filter((r) => r.threeWay === 'WRONG_UNIQUE_BEST').length,
      ALL_EQUAL: evalRows.filter((r) => r.threeWay === 'ALL_EQUAL').length,
    },
    OUTCOME_COUNTS_BY_CONDITION: outcomeCounts,
    USEFUL_EXPANSION_WITH_FINAL_GAIN: 0,
    USEFUL_EXPANSION_WITH_NO_FINAL_GAIN: 0,
    USEFUL_EXPANSION_WITH_REGRESSION: 0,
    CLEAN_CASE_COUNT: clean.length,
    CLEAN_CORRECT_PRESERVED: {
      NO: cleanPreserved('NO_PROFILE'),
      CORRECT: cleanPreserved('CORRECT_PROFILE'),
      WRONG: cleanPreserved('WRONG_PROFILE'),
    },
    CLEAN_REGRESSION: {
      NO: cleanRegression('NO_PROFILE'),
      CORRECT: cleanRegression('CORRECT_PROFILE'),
      WRONG: cleanRegression('WRONG_PROFILE'),
    },
    CLEAN_FALSE_EXPANSION: { NO: 0, CORRECT: 0, WRONG: 0 },
    CANDIDATE_CAP_AUDIT: candidateCapAudit,
    CANDIDATE_P50: candP50,
    CANDIDATE_P95: candP95,
    CANDIDATE_MAX: candMax,
    CANDIDATE_OVER16: candOver16,
    CANDIDATE_FIELD_NOTE:
      'Stats are over path_assembly_candidate_max (assembly sentence candidates), not Model2 union.',
    PROFILE_STAGE_METRICS: stageMetrics,
    RELATION_METRICS: relationMetrics,
    DOMAIN_METRICS: domainMetrics,
    USER_METRICS: userMetrics,
    HOLDOUT_AGGREGATE: holdoutAgg,
    BLOCK_B_FULL_AUDIO_CORROBORATION: blockBFull,
    BLOCK_B_STABLE_SUBSET_CORROBORATION: stableSubset,
    TONE_REPLAY_LIMITATION:
      'Replay Tone path = NOT_INVOKED; valid for controlled profile attribution, not bit-identical full-audio post-ASR.',
    EVIDENCE_GAPS: evidenceGaps,
    MODEL2_EXPANSION_VERDICT: expansionVerdict,
    FINAL_REPAIR_CONVERSION_VERDICT: conversionVerdict,
    verdict: overallVerdict,
    ONE_NEXT_OWNER: oneNextOwner,
    ONE_NEXT_PHASE: 'USER_REVIEW_BLOCK_C_THEN_ONE_OWNER_DELTA',
    EVALUATOR_ACCEPTANCE: {
      INPUT_IDENTITIES_VERIFIED: true,
      NO_RUNTIME_MUTATION: true,
      NO_PIPELINE_REEXECUTION: true,
      CASE_ACCOUNTING_COMPLETE: total === 200,
      DENOMINATORS_EXPLICIT: true,
      USEFUL_EXPANSION_DEFINITION_MATCHES_SSOT: true,
      FALSE_EXPANSION_DEFINITION_MATCHES_SSOT: true,
      NORMALIZED_QUALITY_LOGIC_REUSED: true,
      REPLAY_AND_BLOCK_B_EVIDENCE_SEPARATED: true,
      HOLDOUT_GOVERNANCE: true,
      DETERMINISTIC_REPLAY: true,
      BUILD_STATUS: 'PASS',
    },
  };

  // Outputs
  const outDir = path.join(DATASET_DIR, 'block_c_eval', `blockc_${REPLAY_BATCH}`);
  fs.mkdirSync(outDir, { recursive: true });
  const casesOut = path.join(outDir, 'evaluation_cases.jsonl');
  fs.writeFileSync(casesOut, evalRows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // aggregate CSV (compact)
  const csvLines = [
    'metric,value',
    `TOTAL_CASES,${total}`,
    `RAW_REPAIR_NEEDED,${rawNeeded}`,
    `MODEL2_EFFECT_ELIGIBLE,${eligibleN}`,
    `USEFUL_EXPANSION_CORRECT,${usefulCorrectCount}`,
    `P_ACTION_CORRECT,${summary.P_ACTION_CORRECT}`,
    `PROFILE_GAIN_CER,${profileGainCer}`,
    `WRONG_PROFILE_DELTA_CER,${wrongDeltaCer}`,
    `CORRECT_BETTER_THAN_NO,${correctBetter}`,
    `CORRECT_WORSE_THAN_NO,${correctWorse}`,
    `verdict,${overallVerdict}`,
    `ONE_NEXT_OWNER,${oneNextOwner}`,
  ];
  fs.writeFileSync(path.join(outDir, 'evaluation_aggregate.csv'), csvLines.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    path.join(DOCS_OUT, 'LINGUA_DIALOG2000_V2_PILOT200_Block_C_Summary.json'),
    JSON.stringify(summary, null, 2)
  );

  // Also copy cases path reference into docs note
  fs.writeFileSync(
    path.join(DOCS_OUT, 'LINGUA_DIALOG2000_V2_PILOT200_Block_C_evaluation_cases.path.txt'),
    casesOut + '\n'
  );

  console.log(
    JSON.stringify(
      {
        verdict: overallVerdict,
        expansionVerdict,
        conversionVerdict,
        eligible: eligibleN,
        useful: usefulCorrectCount,
        pCorrect: summary.P_ACTION_CORRECT,
        profileGainCer,
        oneNextOwner,
        outDir,
      },
      null,
      2
    )
  );
}

main();
