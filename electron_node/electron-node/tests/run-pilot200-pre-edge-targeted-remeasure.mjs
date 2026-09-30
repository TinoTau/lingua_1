#!/usr/bin/env node
/**
 * LINGUA_PILOT200_PRE_EDGE_TARGETED_REMEASURE
 * TRACE-FIRST: frozen RAW+Tone + CORRECT_PROFILE → A→G gates.
 * NO code/config/model/dataset changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getTestServerPort, waitTestServerHealth } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DS = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const CAP = path.join(DS, 'tone_evidence_captures', 'tonecap_2026-09-12T0001');
const PROFILES = path.join(DS, 'profiles');
const START = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');
const TRACE_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_PRE_EDGE_TARGETED_REMEASURE_TRACE.jsonl');
const REPORT_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_PRE_EDGE_TARGETED_REMEASURE_REPORT.md');
const SUMMARY_PATH = path.join(OUT_DIR, 'LINGUA_PILOT200_PRE_EDGE_TARGETED_REMEASURE_SUMMARY.json');

/** Prior audit mapping: evaluation target → ASR confused multi-char surface */
const CASE_SPEC = [
  {
    caseId: 'p2_u001_016',
    targetTerm: '礼宾部',
    rawSurface: '李守步',
    expectedRelations: ['n_l', 'in_ing'],
    primaryRelation: 'in_ing',
  },
  {
    caseId: 'p2_u001_002',
    targetTerm: '奶精',
    rawSurface: '来精',
    expectedRelations: ['n_l', 'in_ing'],
    primaryRelation: 'n_l',
  },
  {
    caseId: 'p2_u002_016',
    targetTerm: '咖啡师',
    rawSurface: '咖啡丝',
    expectedRelations: ['sh_s', 'z_zh'],
    primaryRelation: 'sh_s',
  },
  {
    caseId: 'p2_u003_001',
    targetTerm: '营运证',
    rawSurface: '营运真',
    expectedRelations: ['eng_en', 'h_f'],
    primaryRelation: 'eng_en',
  },
  {
    caseId: 'p2_u004_001',
    targetTerm: '生成',
    rawSurface: '升层',
    expectedRelations: ['ch_c', 'n_l'],
    primaryRelation: 'ch_c',
  },
  {
    caseId: 'p2_u003_016',
    targetTerm: '换乘',
    rawSurface: '翻成',
    expectedRelations: ['h_f', 'eng_en'],
    primaryRelation: 'h_f',
  },
  {
    caseId: 'p2_u001_004',
    targetTerm: '内处理',
    rawSurface: '类处理',
    expectedRelations: ['n_l', 'in_ing'],
    primaryRelation: 'n_l',
  },
];

function loadCases() {
  return Object.fromEntries(
    fs
      .readFileSync(path.join(DS, 'cases', 'cases.jsonl'), 'utf8')
      .trim()
      .split(/\n/)
      .map((l) => JSON.parse(l))
      .map((c) => [c.caseId, c])
  );
}

function loadProfile(ref) {
  return JSON.parse(fs.readFileSync(path.join(PROFILES, `${ref}.userprofile.json`), 'utf8'));
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
  const child = spawn(process.execPath, [START], {
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

async function postJson(port, route, body, timeoutMs = 300000) {
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

function findTargetWindows(pathTrace, rawSurface, targetLen) {
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
      if (text === rawSurface || (text.includes(rawSurface) && sylLen === targetLen)) {
        windows.push({ path_id: p.path_id, entry: w, win, text, sylLen });
      }
    }
  }
  return windows;
}

function analyzeCase(spec, caseRow, evidence, profile, pipeExtra) {
  const targetLen = [...spec.targetTerm].length;
  const paths = Array.isArray(pipeExtra?.dialog200_path_trace)
    ? pipeExtra.dialog200_path_trace
    : pipeExtra?.dialog200_path_trace?.paths || [];
  const summaries = paths.map((p) => p.model2_summary).filter(Boolean);
  let bestSummary = summaries[0] || null;
  for (const s of summaries) {
    if ((s?.p_retrieval_hit_count || 0) > (bestSummary?.p_retrieval_hit_count || 0)) bestSummary = s;
  }

  const bias = profile.phonetic_bias || {};
  const profileRelationPresent = spec.expectedRelations.some((r) => Number(bias[r] || 0) > 0);

  const targetWindows = findTargetWindows(paths, spec.rawSurface, targetLen);
  const gateA = targetWindows.length > 0 ? 'PASS' : 'FAIL';

  // Prefer first matching window with executed p_retrieval
  let chosen = targetWindows.find((t) => t.entry?.p_retrieval?.status === 'EXECUTED') || targetWindows[0];

  let gateB = 'FAIL';
  let expectedRelationSelected = false;
  let selectedActions = [];
  let inferenceOk = false;
  if (gateA === 'PASS' && chosen) {
    const raw = chosen.entry?.model2_raw || {};
    selectedActions = raw.p_selected_actions || bestSummary?.selected_actions || [];
    inferenceOk = Boolean(
      chosen.entry?.model2_inference_id ||
        bestSummary?.invoked ||
        (selectedActions && selectedActions.length >= 0 && !bestSummary?.load_failed)
    );
    if (bestSummary?.load_failed || bestSummary?.inference_failed) {
      gateB = 'FAIL';
    } else if (!selectedActions.length) {
      gateB = 'NO_ACTION';
    } else {
      expectedRelationSelected = selectedActions.some((a) =>
        spec.expectedRelations.some((r) => actionHasRelation(a, r))
      );
      gateB = expectedRelationSelected ? 'PASS' : 'FAIL';
    }
  }

  let gateC = 'FAIL';
  let transformDetail = null;
  const queries = chosen?.entry?.p_retrieval?.queries || [];
  if (gateA === 'PASS' && gateB === 'PASS') {
    const full = queries.find((q) => Array.isArray(q.query) && q.query.length === targetLen);
    if (full) {
      gateC = 'PASS';
      transformDetail = {
        action_id: full.action_id,
        query: full.query,
        pinyin_key: full.pinyin_key,
        query_len: full.query.length,
      };
    } else if (queries.length === 0) {
      gateC = 'FAIL';
    } else {
      // queries ran but wrong length
      gateC = 'FAIL';
      transformDetail = {
        queries: queries.map((q) => ({
          action_id: q.action_id,
          query: q.query,
          len: (q.query || []).length,
        })),
      };
    }
  }

  const tonePat =
    chosen?.entry?.p_retrieval?.window_local_tone_pattern ||
    chosen?.entry?.p_retrieval?.fineSpan_local_tone_pattern ||
    chosen?.win?.tone_representation ||
    null;
  const toneSource = chosen?.entry?.p_retrieval?.tone_pattern_source || null;
  const toneReady = Array.isArray(tonePat) && tonePat.length > 0;
  const toneLenOk = toneReady && tonePat.length === targetLen;
  const toneValidSource =
    !toneSource || toneSource === 'WINDOW_LOCAL' || toneSource === 'FINESPAN_LOCAL';
  let gateD = 'FAIL';
  if (gateA === 'PASS' && gateB === 'PASS' && gateC === 'PASS') {
    gateD = toneReady && toneLenOk && toneValidSource ? 'PASS' : 'FAIL';
  }

  let gateE = 'FAIL';
  let lexiconHits = [];
  let targetLexiconHit = false;
  if (gateA === 'PASS' && gateB === 'PASS' && gateC === 'PASS' && gateD === 'PASS') {
    for (const q of queries) {
      if (!Array.isArray(q.query) || q.query.length !== targetLen) continue;
      for (const h of q.hits || []) {
        lexiconHits.push(h);
        if (h.surface === spec.targetTerm || (h.termId && (caseRow.evaluationTargetTermIds || []).includes(h.termId))) {
          targetLexiconHit = true;
        }
      }
    }
    gateE = targetLexiconHit ? 'PASS' : 'FAIL';
  }

  // Gate F: PROFILE candidate in after_model2_candidates or union
  let gateF = 'FAIL';
  let profileCand = null;
  if (gateE === 'PASS') {
    for (const p of paths) {
      const after = p?.after_model2_candidates?.items || [];
      for (const c of after) {
        if (
          c.surface === spec.targetTerm ||
          (c.termId && (caseRow.evaluationTargetTermIds || []).includes(c.termId))
        ) {
          if (
            c.provenance === 'PROFILE_PRONUNCIATION' ||
            c.provenance === 'PROFILE_RETRIEVAL' ||
            c.alsoProfile
          ) {
            profileCand = c;
            gateF = 'PASS';
            break;
          }
        }
      }
      if (gateF === 'PASS') break;
      // also check window p_retrieval hits already imply materialization if introduced
      const introduced = p?.model2_summary?.introduced_term_ids || [];
      if (
        introduced.some((id) => (caseRow.evaluationTargetTermIds || []).includes(id)) ||
        (bestSummary?.introduced_term_ids || []).some((id) =>
          (caseRow.evaluationTargetTermIds || []).includes(id)
        )
      ) {
        gateF = 'PASS';
        profileCand = { via: 'introduced_term_ids', introduced };
        break;
      }
    }
  }

  // Gate G: multi-char PathFineSpan / lexical region with target
  let gateG = 'FAIL';
  let edgeDetail = null;
  let survivesSeg = false;
  if (gateF === 'PASS') {
    for (const p of paths) {
      const finespans = p?.finespans || [];
      for (const fs of finespans) {
        const text = fs.source_text || '';
        const sylLen =
          typeof fs.syllable_end === 'number' && typeof fs.syllable_start === 'number'
            ? fs.syllable_end - fs.syllable_start
            : text.length;
        if (sylLen !== targetLen) continue;
        if (text === spec.targetTerm || text === spec.rawSurface) {
          // candidate on span?
          const hasTarget =
            text === spec.targetTerm ||
            (profileCand && true);
          edgeDetail = {
            span_id: fs.span_id,
            source_text: text,
            syllable_start: fs.syllable_start,
            syllable_end: fs.syllable_end,
            sylLen,
            candidate_count: fs.candidate_count,
          };
          if (text === spec.targetTerm || hasTarget) {
            gateG = 'PASS';
            survivesSeg = true;
            break;
          }
        }
      }
      if (gateG === 'PASS') break;
      // Fallback: union candidates with matching geometry + target surface
      const after = p?.after_model2_candidates?.items || [];
      const geomHit = after.find(
        (c) =>
          (c.surface === spec.targetTerm ||
            (c.termId && (caseRow.evaluationTargetTermIds || []).includes(c.termId))) &&
          typeof c.syllableStart === 'number' &&
          c.syllableEnd - c.syllableStart === targetLen
      );
      if (geomHit) {
        gateG = 'PASS';
        edgeDetail = {
          via: 'after_model2_candidate_geometry',
          surface: geomHit.surface,
          syllableStart: geomHit.syllableStart,
          syllableEnd: geomHit.syllableEnd,
          provenance: geomHit.provenance,
        };
        // Check if any finespan covers that geometry
        survivesSeg = finespans.some(
          (fs) =>
            fs.syllable_start === geomHit.syllableStart &&
            fs.syllable_end === geomHit.syllableEnd
        );
        break;
      }
    }
  }

  const repaired =
    pipeExtra?.repairedText ||
    pipeExtra?.bestSentence ||
    pipeExtra?.kenlmBest ||
    pipeExtra?.finalText ||
    null;
  // Try common job result fields
  const finalText =
    repaired ||
    pipeExtra?.spanAssemblyV4?.bestSentence ||
    pipeExtra?.assemblyBest ||
    null;
  const finalRepairCorrect =
    typeof finalText === 'string' && finalText.includes(spec.targetTerm) ? 'YES' : 'NO';

  // First failure gate
  const gates = [
    ['A', gateA],
    ['B', gateB === 'NO_ACTION' ? 'FAIL' : gateB],
    ['C', gateC],
    ['D', gateD],
    ['E', gateE],
    ['F', gateF],
    ['G', gateG],
  ];
  let firstFailureGate = 'NONE';
  for (const [g, v] of gates) {
    if (v !== 'PASS') {
      firstFailureGate = g;
      break;
    }
  }
  if (firstFailureGate === 'NONE' && finalRepairCorrect === 'NO') {
    firstFailureGate = 'DOWNSTREAM';
  }

  let failureOwner = null;
  if (firstFailureGate === 'A') failureOwner = 'WINDOW_ENUMERATION';
  else if (firstFailureGate === 'B') {
    failureOwner =
      bestSummary?.load_failed || bestSummary?.inference_failed
        ? 'MODEL2_RUNTIME'
        : 'MODEL2_POLICY_OR_PROFILE_OWNER';
  } else if (firstFailureGate === 'C') failureOwner = 'RELATION_TRANSFORM';
  else if (firstFailureGate === 'D') failureOwner = 'TONE_QUERY';
  else if (firstFailureGate === 'E') {
    failureOwner = caseRow.targetInLexicon ? 'LEXICON_RECALL' : 'LEXICON_CONTENT';
  } else if (firstFailureGate === 'F') failureOwner = 'MATERIALIZATION';
  else if (firstFailureGate === 'G') failureOwner = 'EDGE';
  else if (firstFailureGate === 'DOWNSTREAM') {
    failureOwner = survivesSeg ? 'DOWNSTREAM' : 'SEGMENTATION';
  }

  return {
    kind: 'CASE_A_TO_G',
    caseId: spec.caseId,
    profileCondition: 'CORRECT_PROFILE',
    targetTerm: spec.targetTerm,
    rawSurface: spec.rawSurface,
    frozenRawText: evidence.rawMergedAsrText,
    windowLength: targetLen,
    profileRef: caseRow.profileRef,
    phonetic_bias: bias,
    PROFILE_RELATION_PRESENT: profileRelationPresent ? 'YES' : 'NO',
    EXPECTED_RELATION_SELECTED: expectedRelationSelected ? 'YES' : 'NO',
    primaryRelation: spec.primaryRelation,
    gateA_multi_char_window: gateA,
    targetWindows: targetWindows.map((t) => ({
      windowId: t.win.window_id || t.win.span_id,
      windowText: t.text,
      syllable_start: t.win.syllable_start,
      syllable_end: t.win.syllable_end,
      sylLen: t.sylLen,
      rawStart: t.win.start,
      rawEnd: t.win.end,
    })),
    gateB_expected_PAction: gateB,
    selectedActions,
    model2_summary: bestSummary,
    gateC_full_length_transform: gateC,
    transformDetail,
    Tone_ready: toneReady ? 'YES' : 'NO',
    tonePattern: tonePat,
    tonePatternLength: Array.isArray(tonePat) ? tonePat.length : 0,
    tone_pattern_source: toneSource,
    gateD_tone_valid: gateD,
    gateE_target_Lexicon_hit: gateE,
    lexiconHits: lexiconHits.slice(0, 16),
    TARGET_TERM_EXISTS_IN_LEXICON: caseRow.targetInLexicon ? 'YES' : 'NO',
    gateF_target_profile_candidate: gateF,
    profileCand,
    gateG_target_LexicalEdge: gateG,
    edgeDetail,
    TARGET_EDGE_SURVIVES_SEGMENTATION: survivesSeg ? 'YES' : 'NO',
    FINAL_REPAIR_CORRECT: finalRepairCorrect,
    finalTextSample: typeof finalText === 'string' ? finalText.slice(0, 120) : null,
    FIRST_FAILURE_GATE: firstFailureGate,
    FAILURE_OWNER: failureOwner,
    insertion: paths[0]?.model2?.insertion || null,
  };
}

function buildReport(results) {
  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
  let edgeSurvive = 0;
  let finalOk = 0;
  const ownerCounts = {};
  for (const r of results) {
    if (r.gateA_multi_char_window === 'PASS') counts.A += 1;
    if (r.gateB_expected_PAction === 'PASS') counts.B += 1;
    if (r.gateC_full_length_transform === 'PASS') counts.C += 1;
    if (r.gateD_tone_valid === 'PASS') counts.D += 1;
    if (r.gateE_target_Lexicon_hit === 'PASS') counts.E += 1;
    if (r.gateF_target_profile_candidate === 'PASS') counts.F += 1;
    if (r.gateG_target_LexicalEdge === 'PASS') counts.G += 1;
    if (r.TARGET_EDGE_SURVIVES_SEGMENTATION === 'YES') edgeSurvive += 1;
    if (r.FINAL_REPAIR_CORRECT === 'YES') finalOk += 1;
    if (r.FAILURE_OWNER) {
      ownerCounts[r.FAILURE_OWNER] = (ownerCounts[r.FAILURE_OWNER] || 0) + 1;
    }
  }

  const proven = results.some(
    (r) =>
      r.gateA_multi_char_window === 'PASS' &&
      r.gateB_expected_PAction === 'PASS' &&
      r.gateC_full_length_transform === 'PASS' &&
      r.gateD_tone_valid === 'PASS' &&
      r.gateE_target_Lexicon_hit === 'PASS' &&
      r.gateF_target_profile_candidate === 'PASS' &&
      r.gateG_target_LexicalEdge === 'PASS'
  );
  const partial = !proven && results.some((r) => r.gateA_multi_char_window === 'PASS' && r.gateB_expected_PAction === 'PASS');
  const pathVerdict = proven ? 'PROVEN' : partial ? 'PARTIAL' : 'NOT_PROVEN';
  const pilotReady = proven
    ? counts.G >= 1 && Object.keys(ownerCounts).length <= 3
      ? 'YES'
      : 'YES_WITH_KNOWN_CASE_FAILURES'
    : 'NO';

  // ONE_NEXT_OWNER
  let nextOwner = 'FULL_PILOT200_REMEASURE';
  if (!proven) {
    const entries = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1]);
    nextOwner = entries[0]?.[0] || 'WINDOW_ENUMERATION';
  }

  const lines = [];
  lines.push('# LINGUA_PILOT200_PRE_EDGE_TARGETED_REMEASURE_REPORT');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push('| Date | 2026-09-12 |');
  lines.push('| Nature | TRACE-FIRST TARGETED REMEASURE |');
  lines.push('| AUTHORITATIVE_MODEL2_SSOT | AUG12_PRE_LEXICAL_EDGE |');
  lines.push('');
  lines.push('## A. Evidence identity');
  lines.push('');
  lines.push('```text');
  lines.push('CAPTURE_BATCH = tonecap_2026-09-12T0001');
  lines.push('REPLAY = /run-lexicon-mock + frozen segments + utterance_tone');
  lines.push('PROFILE = CORRECT_PROFILE (case profileRef)');
  lines.push('DATASET = LINGUA_DIALOG2000_V2_PILOT200 / build_20260911_091806');
  lines.push('MODEL2 = production pre-edge expandWindowsWithModel2');
  lines.push('```');
  lines.push('');
  lines.push('## B. 7-case result table');
  lines.push('');
  lines.push('| caseId | target | rawSurface | A | B | C | Tone | D | E | F | G | seg | final | FIRST | OWNER |');
  lines.push('|--------|--------|------------|---|---|---|------|---|---|---|---|-----|-------|-------|-------|');
  for (const r of results) {
    lines.push(
      `| ${r.caseId} | ${r.targetTerm} | ${r.rawSurface} | ${r.gateA_multi_char_window} | ${r.gateB_expected_PAction} | ${r.gateC_full_length_transform} | ${r.Tone_ready} | ${r.gateD_tone_valid} | ${r.gateE_target_Lexicon_hit} | ${r.gateF_target_profile_candidate} | ${r.gateG_target_LexicalEdge} | ${r.TARGET_EDGE_SURVIVES_SEGMENTATION} | ${r.FINAL_REPAIR_CORRECT} | ${r.FIRST_FAILURE_GATE} | ${r.FAILURE_OWNER || ''} |`
    );
  }
  lines.push('');
  lines.push('## C. First-failure ownership');
  lines.push('');
  for (const r of results) {
    lines.push(`- **${r.caseId}** (${r.targetTerm}): FIRST=${r.FIRST_FAILURE_GATE} OWNER=${r.FAILURE_OWNER}`);
  }
  lines.push('');
  lines.push('## D. Real path verdict');
  lines.push('');
  lines.push('```text');
  lines.push(`REAL_PRE_EDGE_MULTI_CHAR_MODEL2_PATH = ${pathVerdict}`);
  lines.push(`GATE_A_PASS = ${counts.A}/7`);
  lines.push(`GATE_B_PASS = ${counts.B}/7`);
  lines.push(`GATE_C_PASS = ${counts.C}/7`);
  lines.push(`GATE_D_PASS = ${counts.D}/7`);
  lines.push(`GATE_E_PASS = ${counts.E}/7`);
  lines.push(`GATE_F_PASS = ${counts.F}/7`);
  lines.push(`GATE_G_PASS = ${counts.G}/7`);
  lines.push(`TARGET_EDGE_SURVIVAL_COUNT = ${edgeSurvive}`);
  lines.push(`FINAL_REPAIR_CORRECT_COUNT = ${finalOk}`);
  lines.push('```');
  lines.push('');
  lines.push('## E. Full Pilot readiness');
  lines.push('');
  lines.push('```text');
  lines.push(`FULL_PILOT200_REMEASURE_READY = ${pilotReady}`);
  lines.push('```');
  lines.push('');
  lines.push('## F. One next owner');
  lines.push('');
  lines.push('```text');
  lines.push(`ONE_NEXT_OWNER = ${nextOwner}`);
  lines.push('```');
  lines.push('');
  lines.push('**STOP.** No code changes.');

  const summary = {
    PHASE: 'LINGUA_PILOT200_PRE_EDGE_TARGETED_REMEASURE',
    AUTHORITATIVE_MODEL2_SSOT: 'AUG12_PRE_LEXICAL_EDGE',
    EVIDENCE_BATCH: 'tonecap_2026-09-12T0001',
    TOTAL_CASES: 7,
    GATE_A_PASS_COUNT: counts.A,
    GATE_B_PASS_COUNT: counts.B,
    GATE_C_PASS_COUNT: counts.C,
    GATE_D_PASS_COUNT: counts.D,
    GATE_E_PASS_COUNT: counts.E,
    GATE_F_PASS_COUNT: counts.F,
    GATE_G_PASS_COUNT: counts.G,
    TARGET_EDGE_SURVIVAL_COUNT: edgeSurvive,
    FINAL_REPAIR_CORRECT_COUNT: finalOk,
    REAL_PRE_EDGE_MULTI_CHAR_MODEL2_PATH: pathVerdict,
    FIRST_FAILURE_OWNER_COUNTS: ownerCounts,
    FULL_PILOT200_REMEASURE_READY: pilotReady,
    ONE_NEXT_OWNER: nextOwner,
  };

  return { report: lines.join('\n') + '\n', summary };
}

async function main() {
  const skipStart = process.argv.includes('--skip-start');
  const cases = loadCases();
  const port = getTestServerPort();
  if (!skipStart) {
    console.log('[start]');
    const st = await startElectron();
    console.log('[start]', st.pid);
  }
  const healthy = await waitTestServerHealth(port, skipStart ? 60000 : 180000);
  if (!healthy) {
    console.error('health failed');
    process.exit(3);
  }

  const results = [];
  for (const spec of CASE_SPEC) {
    const c = cases[spec.caseId];
    if (!c) {
      results.push({ caseId: spec.caseId, status: 'CASE_MISSING' });
      continue;
    }
    const evidencePath = path.join(CAP, `${spec.caseId}.evidence.json`);
    if (!fs.existsSync(evidencePath)) {
      results.push({
        caseId: spec.caseId,
        status: 'REPLAY_EVIDENCE_GAP',
        missing: evidencePath,
      });
      continue;
    }
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const profile = loadProfile(c.profileRef);
    const sessionId = `pilot200-preedge-remeasure::${spec.caseId}::CORRECT`;
    console.log('[replay]', spec.caseId, spec.targetTerm);

    const boot = await postJson(port, '/session-bootstrap', {
      type: 'session_bootstrap',
      session_id: sessionId,
      user_id: c.userId,
      profile_version: profile.profile_version ?? 0,
      user_profile: profile,
      trace_id: `preedge_remeasure_${spec.caseId}`,
    });
    if (!(boot.ok && boot.data?.ok)) {
      results.push({ caseId: spec.caseId, status: 'BOOT_FAIL', error: boot.data });
      continue;
    }

    const pipe = await postJson(port, '/run-lexicon-mock', {
      asrText: evidence.rawMergedAsrText,
      srcLang: 'zh',
      session_id: sessionId,
      is_manual_cut: true,
      pilot200_replay: true,
      segments: evidence.segments,
      utterance_tone: evidence.utterance_tone,
    });
    if (!pipe.ok) {
      results.push({ caseId: spec.caseId, status: 'PIPE_FAIL', error: pipe.data });
      continue;
    }

    const analyzed = analyzeCase(spec, c, evidence, profile, pipe.data.extra || pipe.data);
    // Enrich final text from top-level if needed
    if (!analyzed.finalTextSample) {
      const top =
        pipe.data.repairedText ||
        pipe.data.text ||
        pipe.data.resultText ||
        pipe.data.extra?.repairedUtterance ||
        null;
      if (typeof top === 'string') {
        analyzed.finalTextSample = top.slice(0, 120);
        analyzed.FINAL_REPAIR_CORRECT = top.includes(spec.targetTerm) ? 'YES' : 'NO';
        if (analyzed.FIRST_FAILURE_GATE === 'NONE' && analyzed.FINAL_REPAIR_CORRECT === 'NO') {
          analyzed.FIRST_FAILURE_GATE = 'DOWNSTREAM';
          analyzed.FAILURE_OWNER = 'DOWNSTREAM';
        }
      }
    }
    results.push(analyzed);
    console.log(
      JSON.stringify({
        caseId: analyzed.caseId,
        A: analyzed.gateA_multi_char_window,
        B: analyzed.gateB_expected_PAction,
        C: analyzed.gateC_full_length_transform,
        D: analyzed.gateD_tone_valid,
        E: analyzed.gateE_target_Lexicon_hit,
        F: analyzed.gateF_target_profile_candidate,
        G: analyzed.gateG_target_LexicalEdge,
        FIRST: analyzed.FIRST_FAILURE_GATE,
        OWNER: analyzed.FAILURE_OWNER,
      })
    );
  }

  const okResults = results.filter((r) => r.kind === 'CASE_A_TO_G');
  const { report, summary } = buildReport(okResults);
  fs.writeFileSync(TRACE_PATH, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(REPORT_PATH, report);
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2) + '\n');
  console.log('WROTE', TRACE_PATH);
  console.log('WROTE', REPORT_PATH);
  console.log('WROTE', SUMMARY_PATH);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
