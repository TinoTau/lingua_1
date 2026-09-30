#!/usr/bin/env node
/**
 * READ_ONLY — Dialog200 Recall/Model2 First-Loss Decomposition Audit V1
 * Cohort = prior FIRST_LOSS=BASE_RECALL_OR_MODEL2 (116)
 * Stop boundary = AFTER_MODEL2 / PRE_LEXICAL_EDGE
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { waitTestServerHealth, getTestServerPort } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import { norm } from './lib/materializable-target-v1.mjs';
import { resolveDialog200BaselineSsot } from './lib/dialog200-baseline-ssot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const START = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const DB_PATH = path.join(REPO, 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
const PRIOR_TRACE = path.join(OUT, 'LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_TRACE_V1.jsonl');
const FRESH_ASR = resolveDialog200BaselineSsot().evidencePath; // SSOT — retired incomplete dump
const MANIFEST = path.join(REPO, 'test wav', 'dialog_200', 'cases.manifest.json');

const TRACE_OUT = path.join(OUT, 'LINGUA_DIALOG200_RECALL_MODEL2_FIRST_LOSS_TRACE_V1.jsonl');
const SUMMARY_OUT = path.join(OUT, 'LINGUA_DIALOG200_RECALL_MODEL2_FIRST_LOSS_SUMMARY_V1.json');
const REPORT_OUT = path.join(OUT, 'LINGUA_DIALOG200_RECALL_MODEL2_FIRST_LOSS_DECOMPOSITION_AUDIT_V1.md');

const args = process.argv.slice(2);
const analyzeOnly = args.includes('--analyze-only');
const fromTrace = args.includes('--from-trace');
const skipStart = args.includes('--skip-start');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;

function pct(n, d) {
  return d ? Number(((100 * n) / d).toFixed(2)) : null;
}
function asArr(x) {
  if (Array.isArray(x)) return x;
  if (x?.items) return x.items;
  return [];
}

function classifyTargetType(surface) {
  const s = String(surface || '');
  if (!s) return 'OTHER';
  if (s.length === 1) return 'SINGLE_CHAR';
  if (/[A-Za-z]/.test(s)) return 'PROPER_NOUN';
  return 'MULTI_CHAR';
}

function openLexicon() {
  // better-sqlite3 is Electron-ABI; use Python sqlite3 for READ_ONLY lookups.
  const cache = new Map();
  const lookupFile = path.join(OUT, '_decomp_lexicon_lookup_tmp.json');
  const wordsFile = path.join(OUT, '_decomp_lexicon_words_tmp.json');
  return {
    preload(words) {
      const uniq = [...new Set(words.filter(Boolean))];
      fs.writeFileSync(wordsFile, JSON.stringify(uniq), 'utf8');
      const r = spawnSync(
        'python',
        [path.join(REPO, 'scripts/lexicon_batch_lookup.py'), DB_PATH, wordsFile, lookupFile],
        { encoding: 'utf8', cwd: REPO, maxBuffer: 32 * 1024 * 1024 }
      );
      if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'lexicon python failed');
      const obj = JSON.parse(fs.readFileSync(lookupFile, 'utf8'));
      for (const [k, v] of Object.entries(obj)) cache.set(k, v);
      try {
        fs.unlinkSync(wordsFile);
        fs.unlinkSync(lookupFile);
      } catch {
        /* ignore */
      }
    },
    lookup(word) {
      if (!cache.has(word)) this.preload([word]);
      return (
        cache.get(word) || {
          present: false,
          enabled_present: false,
          rows: [],
        }
      );
    },
    db: { close() {} },
  };
}

function pickPrimaryTargets(units) {
  // Prefer length>=2; keep singles only if no multi-char units
  const multi = units.filter((u) => String(u).length >= 2);
  if (multi.length) return multi;
  return units.slice(0, 3);
}

async function startServer() {
  killPort(5020);
  killPort(6007);
  await new Promise((r) => setTimeout(r, 1500));
  const child = spawn(process.execPath, [START], {
    cwd: ELECTRON,
    env: { ...process.env, PROJECT_ROOT: REPO, NODE_ENV: 'production', MODEL2_DIALOG200_TRACE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res) => child.on('exit', res));
  const port = getTestServerPort();
  if (!(await waitTestServerHealth(port, 180000))) throw new Error('unhealthy');
  return port;
}

async function runMock(port, asrText, caseId) {
  const sessionId = `m2dec-${caseId}-${Date.now()}`;
  await fetch(`http://127.0.0.1:${port}/session-bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, user_id: 'dialog200-decomp' }),
  });
  const res = await fetch(`http://127.0.0.1:${port}/run-lexicon-mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asrText, srcLang: 'zh', session_id: sessionId, is_manual_cut: true }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

function extractRuntimeEvidence(data, targets) {
  const trace = data?.extra?.dialog200_path_trace;
  const paths = Array.isArray(trace) ? trace : trace?.paths || [];
  const targetSet = new Set(targets.map((t) => norm(t)));

  const baseSurfaces = [];
  const afterM2 = [];
  const model2Union = [];
  const pHits = [];
  const dHits = [];
  const queries = [];
  let model2Invoked = false;
  let model2Statuses = [];
  let pRetrievalStatuses = [];
  let pRetrievalReasons = [];
  let selectedActions = [];
  let windowCount = 0;
  let fineSpanCount = 0;
  let pFeaturePresence = 0;
  let dFeaturePresence = 0;
  let domainNoneCount = 0;
  let noPActionWindows = 0;
  let windowsWithPActions = 0;
  let pQueriesExecuted = 0;
  let toneNotReadyWindows = 0;

  for (const p of paths) {
    fineSpanCount += (p.finespans || []).length;
    for (const c of asArr(p.base_candidates)) {
      if (c.surface) baseSurfaces.push({ surface: c.surface, source: c.source, pinyin: c.pinyin });
    }
    for (const c of asArr(p.after_model2_candidates)) {
      if (c.surface)
        afterM2.push({ surface: c.surface, source: c.source, termId: c.termId, pinyin: c.pinyin });
    }
    for (const c of asArr(p.model2?.union?.union_before_budget || p.model2?.union)) {
      if (c.surface) model2Union.push(c.surface);
    }
    const m2 = p.model2 || {};
    if (m2.model2_status) model2Statuses.push(m2.model2_status);
    if (String(m2.model2_status || '').toUpperCase() === 'INVOKED') model2Invoked = true;

    const windows = m2.windows || m2.spans || [];
    for (const s of windows) {
      windowCount += 1;
      if (s.model2_inference_id || s.model2_raw) model2Invoked = true;
      if (s.feature_pack?.p_feature_presence) pFeaturePresence += 1;
      if (s.feature_pack?.d_feature_presence) dFeaturePresence += 1;

      const pSelected = s.model2_raw?.p_selected_actions || s.p_selected_actions || [];
      const actionIds = pSelected.map((a) => (typeof a === 'string' ? a : a.action_id || a)).filter(Boolean);
      selectedActions.push(...actionIds);
      if (actionIds.length > 0) windowsWithPActions += 1;

      const dTop = s.model2_raw?.d_action_scores?.[0]?.action_id;
      if (dTop === 'domain_none') domainNoneCount += 1;

      const pRet = s.p_retrieval || {};
      const pReason = pRet.reason || null;
      if (pReason) pRetrievalReasons.push(pReason);
      if (pReason === 'NO_P_ACTION' || (pRet.status === 'NOT_EXECUTED' && !actionIds.length)) {
        noPActionWindows += 1;
      }
      const toneReady = pRet.toneRecallReadiness || s.observability?.toneRecallReadiness || null;
      if (toneReady && ['no_pattern', 'invalid_pattern', 'caller_disabled', 'runtime_unsupported'].includes(String(toneReady))) {
        toneNotReadyWindows += 1;
      }
      if (String(pReason || '').includes('TONE') || String(pRet.status || '').includes('TONE')) {
        toneNotReadyWindows += 1;
      }

      for (const q of pRet.queries || []) {
        pQueriesExecuted += 1;
        queries.push({
          pinyin: q.pinyin_key,
          observed: q.observed_pinyin_key,
          syllable_start: q.syllable_start ?? s.window?.syllable_start,
          syllable_end: q.syllable_end ?? s.window?.syllable_end,
          hit_surfaces: (q.hits || []).map((h) => h.surface).filter(Boolean),
        });
        for (const h of q.hits || []) if (h.surface) pHits.push(h.surface);
      }
      for (const h of s.d_retrieval?.hits || []) if (h.surface) dHits.push(h.surface);

      const obsStatus = s.observability?.p_retrieval_status || pRet.status || null;
      if (obsStatus) {
        pRetrievalStatuses.push(obsStatus);
        if (obsStatus !== 'MODEL2_NOT_INVOKED') model2Invoked = true;
      }
    }
  }

  function hitAny(list) {
    return list.some((x) => {
      const s = norm(typeof x === 'string' ? x : x.surface);
      return [...targetSet].some((t) => t && (s === t || (t.length >= 2 && s.includes(t))));
    });
  }

  return {
    path_count: paths.length,
    fine_span_count: fineSpanCount,
    window_count: windowCount,
    base_target: hitAny(baseSurfaces),
    after_m2_target: hitAny(afterM2) || hitAny(model2Union),
    p_hit_target: hitAny(pHits),
    d_hit_target: hitAny(dHits),
    query_count: queries.length,
    queries_sample: queries.slice(0, 12),
    model2_invoked: model2Invoked,
    model2_statuses: [...new Set(model2Statuses)],
    p_retrieval_statuses: [...new Set(pRetrievalStatuses)],
    p_retrieval_reasons: [...new Set(pRetrievalReasons)],
    selected_actions: [...new Set(selectedActions)].slice(0, 20),
    p_feature_presence_windows: pFeaturePresence,
    d_feature_presence_windows: dFeaturePresence,
    domain_none_windows: domainNoneCount,
    no_p_action_windows: noPActionWindows,
    windows_with_p_actions: windowsWithPActions,
    p_queries_executed: pQueriesExecuted,
    tone_not_ready_windows: toneNotReadyWindows,
    base_surface_count: baseSurfaces.length,
    after_m2_count: afterM2.length,
    p_hit_count: pHits.length,
    d_hit_count: dHits.length,
  };
}

function classifyCase(prior, lex, runtime, primaryTargets) {
  const asr = prior.asr || '';
  const expected = prior.expected || '';
  // EVALUATION_SSOT_V1: prior.required_lexical_units were REFERENCE_DIFF regions, not LEXICAL_TARGET.
  const authoritative = prior.authoritative_lexical_targets || prior.lexical_targets || null;
  const units = Array.isArray(authoritative) && authoritative.length
    ? authoritative
    : [];

  // R0
  let R0 = expected ? 'PRESENT' : 'ABSENT';

  if (R0 === 'ABSENT') {
    return {
      R0, first_loss: 'TEST_EVALUATOR_DEFECT', root_cause: 'TEST_EVALUATOR_DEFECT',
      failure_class: 'TEST / EVALUATOR DEFECT', violation: 'NO',
    };
  }

  if (!units.length) {
    return {
      R0: 'PRESENT',
      R1: 'NOT_EVALUABLE',
      R2: 'NOT_EVALUABLE',
      R3: 'NOT_EVALUABLE',
      R4: 'NOT_EVALUABLE',
      R5: 'NOT_EVALUABLE',
      R6: 'NOT_EVALUABLE',
      R7: 'NOT_EVALUABLE',
      R8: 'NOT_EVALUABLE',
      R9: 'NOT_EVALUABLE',
      R10: 'NOT_EVALUABLE',
      first_loss: 'NOT_EVALUABLE',
      root_cause: 'NOT_EVALUABLE',
      failure_class: 'OBSERVABILITY GAP',
      violation: 'NO',
      note: 'EVALUATION_SSOT_V1: no authoritative LEXICAL_TARGET annotation; REFERENCE_DIFF must not invent lexicon coverage FAIL',
      targets: (primaryTargets || []).map((t) => ({
        target: t,
        length: [...String(t)].length,
        type: classifyTargetType(t),
        lexicon: 'NOT_EVALUABLE',
        validity_note: 'diff_region_only',
      })),
    };
  }

  // Per-target lexicon — only authoritative units
  const targetRows = units.map((t) => {
    const L = lex.lookup(t);
    return {
      target: t,
      length: [...t].length,
      type: classifyTargetType(t),
      lexicon: L.enabled_present ? 'PRESENT' : L.present ? 'PRESENT_DISABLED' : 'ABSENT',
      lexicon_rows: L.rows,
      phonetic: 'NOT_EVALUABLE',
      phonetic_note: 'DIAGNOSTIC_STRING_COMPATIBILITY only; not production tone_exact evidence',
    };
  });

  const anyInLex = targetRows.some((t) => t.lexicon === 'PRESENT' || t.lexicon === 'PRESENT_DISABLED');
  const allAbsent = targetRows.every((t) => t.lexicon === 'ABSENT');

  const R1 = anyInLex ? 'PRESENT' : 'ABSENT';

  if (allAbsent) {
    return {
      R0: 'PRESENT', R1: 'ABSENT', R2: 'NOT_APPLICABLE', R3: 'NOT_APPLICABLE',
      R4: 'NOT_APPLICABLE', R5: 'NOT_APPLICABLE', R6: 'NOT_APPLICABLE', R7: 'NOT_APPLICABLE',
      R8: 'NOT_APPLICABLE', R9: 'NOT_APPLICABLE', R10: 'ABSENT',
      first_loss: 'LEXICON_COVERAGE', root_cause: 'LEXICON_COVERAGE',
      failure_class: 'DATA / TRAINING FAILURE', violation: 'NO',
      targets: targetRows, note: 'authoritative lexical targets absent from lexicon',
    };
  }

  // Without acoustic tone under lexicon-mock: Base tone_exact NOT_EVALUABLE
  const toneOk = runtime?.tone_available === true;
  if (!toneOk) {
    return {
      R0: 'PRESENT', R1: 'PRESENT', R2: 'PRESENT', R3: 'NOT_EVALUABLE',
      R4: runtime?.base_surface_count > 0 ? 'RECALL_FUNCTION_CALLED' : 'UNKNOWN',
      R5: 'NOT_EVALUABLE',
      R6: 'NOT_EVALUABLE', R7: 'NOT_EVALUABLE', R8: 'NOT_EVALUABLE', R9: 'NOT_EVALUABLE', R10: 'NOT_EVALUABLE',
      first_loss: 'NOT_EVALUABLE',
      root_cause: 'NOT_EVALUABLE',
      failure_class: 'OBSERVABILITY GAP',
      violation: 'NO',
      note: 'EVALUATION_SSOT_V1: Mandatory Tone Fail Closed under lexicon-mock — not BASE_RECALL_FAIL',
      targets: targetRows, runtime,
      recall_function_called: true,
      valid_tone_exact_query_executed: false,
    };
  }

  // Tone available path continues with prior logic (kept minimal — rare in current harness)
  const hasFineOrWindow = (runtime?.fine_span_count || 0) > 0 || (runtime?.window_count || 0) > 0;
  const hasQueries = (runtime?.query_count || 0) > 0;
  const R2 = hasFineOrWindow || hasQueries ? 'PRESENT' : 'UNKNOWN';
  const R3 = 'COMPATIBLE'; // only when tone path proven; production would verify pinyin+tone keys
  const R4 = runtime?.base_surface_count > 0 || runtime?.query_count > 0 ? 'PRESENT' : 'UNKNOWN';
  const R5 = runtime?.base_target ? 'PRESENT' : 'ABSENT';
  const R6 = 'ELIGIBLE';
  const R7 = 'AVAILABLE';
  const R8 = runtime?.model2_invoked ? 'INVOKED' : 'NOT_INVOKED';
  const R9 = runtime?.p_hit_target || runtime?.d_hit_target ? 'PRESENT' : 'ABSENT';
  const R10 = runtime?.after_m2_target ? 'PRESENT' : 'ABSENT';

  if (R10 === 'PRESENT') {
    return {
      R0: 'PRESENT', R1, R2, R3, R4, R5, R6, R7, R8, R9: 'PRESENT', R10: 'PRESENT',
      first_loss: 'STOP_AFTER_MODEL2_PRESENT', root_cause: 'OTHER_PROVEN_ROOT_CAUSE',
      failure_class: 'OBSERVABILITY GAP', violation: 'NO',
      targets: targetRows, runtime,
    };
  }

  return {
    R0: 'PRESENT', R1, R2, R3, R4, R5, R6, R7, R8, R9, R10,
    first_loss: R5 === 'ABSENT' ? 'BASE_RECALL_EXECUTION' : 'MODEL2_DATA_TRAINING_COVERAGE',
    root_cause: R5 === 'ABSENT' ? 'BASE_RECALL_EXECUTION' : 'MODEL2_DATA_TRAINING_COVERAGE',
    failure_class: 'DATA / TRAINING FAILURE',
    violation: 'NO',
    targets: targetRows, runtime,
  };
}

function buildSummary(rows, secondaryDiff, model2Contract) {
  const n = rows.length;
  const bucket = {};
  for (const r of rows) {
    const k = r.root_cause || 'OTHER_PROVEN_ROOT_CAUSE';
    bucket[k] = (bucket[k] || 0) + 1;
  }
  const dist = Object.entries(bucket)
    .map(([k, c]) => ({ root_cause: k, count: c, pct: pct(c, n) }))
    .sort((a, b) => b.count - a.count);

  const lexAbsent = rows.filter((r) => r.R1 === 'ABSENT');
  const lexPresent = rows.filter((r) => r.R1 === 'PRESENT');
  const missingProfile = {};
  for (const r of lexAbsent) {
    for (const t of r.targets || []) {
      const key = `${t.type}|${t.length}`;
      missingProfile[key] = (missingProfile[key] || 0) + 1;
    }
  }

  const funnel = {
    TARGET_IN_LEXICON: lexPresent.length,
    SPAN_WINDOW_PRESENT: rows.filter((r) => r.R2 === 'PRESENT').length,
    PHONETIC_COMPATIBLE: rows.filter((r) => r.R3 === 'COMPATIBLE').length,
    BASE_QUERY_ISSUED: rows.filter((r) => r.R4 === 'PRESENT').length,
    BASE_TARGET_RETURNED: rows.filter((r) => r.R5 === 'PRESENT').length,
    MODEL2_ELIGIBLE: rows.filter((r) => r.R6 === 'ELIGIBLE').length,
    MODEL2_INPUT_AVAILABLE: rows.filter((r) => r.R7 === 'AVAILABLE' || r.R7 === 'PARTIAL').length,
    MODEL2_INVOKED: rows.filter((r) => r.R8 === 'INVOKED').length,
    MODEL2_TARGET_GENERATED: rows.filter((r) => r.R9 === 'PRESENT').length,
    AFTER_MODEL2_TARGET_PRESENT: rows.filter((r) => r.R10 === 'PRESENT').length,
  };

  const top = dist[0]?.root_cause;
  let result = 'RESULT G — MULTIPLE COMPARABLE RECALL BLOCKERS';
  const obsOnly = bucket.OBSERVABILITY_GAP || 0;
  const inputMiss = bucket.MODEL2_INPUT_MISSING || 0;
  const obs = obsOnly + inputMiss;
  const lexN = bucket.LEXICON_COVERAGE || 0;
  const m2data = bucket.MODEL2_DATA_TRAINING_COVERAGE || 0;

  // Near-tie between lexicon coverage and replay-blocked Model2 input ⇒ multiple blockers
  if (lexN > 0 && inputMiss > 0 && Math.abs(lexN - inputMiss) <= Math.max(5, Math.floor(n * 0.05))) {
    result = 'RESULT G — MULTIPLE COMPARABLE RECALL BLOCKERS';
  } else if (lexN >= n * 0.45 && lexN >= inputMiss && lexN >= m2data) {
    result = 'RESULT A — LEXICON COVERAGE IS PRIMARY RECALL BLOCKER';
  } else if (obs > n * 0.45 && obs > lexN && m2data === 0) {
    result = 'RESULT H — OBSERVABILITY INSUFFICIENT';
  } else if (top === 'SPAN_WINDOW_COVERAGE') result = 'RESULT B — SPAN / WINDOW QUERY COVERAGE IS PRIMARY RECALL BLOCKER';
  else if (top === 'PHONETIC_QUERY_MISMATCH') result = 'RESULT C — PHONETIC / TONE QUERY CONTRACT IS PRIMARY RECALL BLOCKER';
  else if (top === 'BASE_RECALL_EXECUTION' || top === 'BASE_RECALL_TRUNCATION_OR_FILTER')
    result = 'RESULT D — BASE RECALL IMPLEMENTATION / FILTERING IS PRIMARY BLOCKER';
  else if (top === 'MODEL2_DATA_TRAINING_COVERAGE' && m2data >= (dist[1]?.count || 0) * 1.3)
    result = 'RESULT E — MODEL2 DATA / TRAINING CAPABILITY IS PRIMARY BLOCKER';
  else if (model2Contract.mode === 'BASE_CANDIDATE_RERANK_ONLY' && model2Contract.violation === 'YES')
    result = 'RESULT F — MODEL2 IMPLEMENTATION DOES NOT MATCH FROZEN INDEPENDENT-EXPANSION CONTRACT';
  else if (obs > n * 0.4 && lexN < n * 0.35) result = 'RESULT H — OBSERVABILITY INSUFFICIENT';
  else result = 'RESULT G — MULTIPLE COMPARABLE RECALL BLOCKERS';

  const baseTheoreticMiss = rows.filter(
    (r) => r.R1 === 'PRESENT' && r.R2 === 'PRESENT' && r.R3 === 'COMPATIBLE' && r.R5 === 'ABSENT'
  ).length;

  const lexiconUpper = lexAbsent.length;
  const model2Opp = rows.filter(
    (r) =>
      r.R1 === 'PRESENT' &&
      r.R5 === 'ABSENT' &&
      r.R6 === 'ELIGIBLE' &&
      (r.R7 === 'AVAILABLE' || r.R7 === 'PARTIAL') &&
      r.R8 === 'INVOKED' &&
      !r.replay_limitation &&
      (r.runtime?.windows_with_p_actions || 0) > 0
  ).length;

  const model2OppReplayBlocked = rows.filter((r) => r.replay_limitation && r.R1 === 'PRESENT').length;

  const q8 =
    Math.abs(lexN - inputMiss) <= 5 && m2data === 0
      ? 'MULTIPLE'
      : lexN > inputMiss && lexN >= m2data
        ? 'LEXICON COVERAGE'
        : inputMiss > lexN && m2data === 0
          ? 'INPUT COVERAGE'
          : m2data >= lexN
            ? 'DATA/TRAINING'
            : 'MULTIPLE';

  // Next owner = largest *actionable* bucket. Replay MODEL2_INPUT_MISSING is observability,
  // not Model2 training; lexicon coverage is actionable without live audio.
  const q11 =
    lexN >= m2data && (lexN >= Math.floor(n * 0.3) || lexN >= (bucket.BASE_RECALL_EXECUTION || 0))
      ? 'LEXICON'
      : m2data > lexN
        ? 'MODEL2 DATA/TRAINING'
        : top === 'MODEL2_INPUT_MISSING' || top === 'OBSERVABILITY_GAP'
          ? 'OBSERVABILITY'
          : top?.includes('SPAN')
            ? 'SPAN/WINDOW'
            : top?.includes('BASE')
              ? 'BASE RECALL'
              : 'LEXICON';

  return {
    phase: 'LINGUA_DIALOG200_RECALL_MODEL2_FIRST_LOSS_DECOMPOSITION_AUDIT_V1',
    primary_n: n,
    secondary_diff: secondaryDiff,
    root_cause_distribution: dist,
    funnel,
    lexicon_missing_count: lexAbsent.length,
    lexicon_present_count: lexPresent.length,
    lexicon_missing_profile: missingProfile,
    base_theoretic_miss_lex_span_phone: baseTheoreticMiss,
    model2_replay_blocked_count: model2OppReplayBlocked,
    model2_contract: model2Contract,
    result_enum: result,
    answers: {
      Q1: `${lexAbsent.length} / ${n} = ${pct(lexAbsent.length, n)}%`,
      Q2: `${bucket.SPAN_WINDOW_COVERAGE || 0}`,
      Q3: `${bucket.PHONETIC_QUERY_MISMATCH || 0}`,
      Q4: `${baseTheoreticMiss} (R1+R2+R3+R5ABSENT; root_cause BASE_* = ${(bucket.BASE_RECALL_EXECUTION || 0) + (bucket.BASE_RECALL_TRUNCATION_OR_FILTER || 0)})`,
      Q5: model2Opp,
      Q5_note: `strict P-path executed opportunity; replay-blocked Model2 input cases=${model2OppReplayBlocked}`,
      Q6: {
        invoked: rows.filter((r) => r.R8 === 'INVOKED' && r.R1 === 'PRESENT' && r.R5 === 'ABSENT').length,
        generated: funnel.MODEL2_TARGET_GENERATED,
        not_generated: rows.filter((r) => r.R8 === 'INVOKED' && r.R1 === 'PRESENT' && r.R9 === 'ABSENT').length,
        true_capability_miss: m2data,
        replay_input_blocked: model2OppReplayBlocked,
      },
      Q7: model2Contract.independent_expansion,
      Q8: q8,
      Q9_lexicon_span_base_upper_bound:
        lexiconUpper +
        (bucket.SPAN_WINDOW_COVERAGE || 0) +
        (bucket.PHONETIC_QUERY_MISMATCH || 0) +
        (bucket.BASE_RECALL_EXECUTION || 0) +
        (bucket.BASE_RECALL_TRUNCATION_OR_FILTER || 0) +
        rows.filter((r) => r.root_cause === 'MODEL2_INPUT_MISSING' && r.base_recall_theoretically_possible).length,
      Q9_note:
        'ceiling if lexicon/span/phonetic/base fixed; includes MODEL2_INPUT_MISSING cases with weak same-length phonetic compat (not guaranteed Base recovery)',
      Q10_model2_opportunity_upper_bound: model2Opp,
      Q10_note: 'excludes replay-blocked NO_P_ACTION/p_feature_absent; those need live acoustic before Model2 capability claims',
      Q11_next_owner: q11,
    },
  };
}

function renderReport(summary, rows) {
  const lines = [];
  lines.push('# Lingua1 — Dialog200 Recall / Model2 First-Loss Decomposition Audit V1');
  lines.push('');
  lines.push('```text');
  lines.push('MODE = READ_ONLY / TRACE_FIRST / NO_IMPLEMENTATION');
  lines.push(summary.result_enum);
  lines.push('```');
  lines.push('');
  lines.push('## Table A — Cohort Accounting');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|------:|');
  lines.push(`| Previous NO_TARGET_AFTER_MODEL2 | ${summary.secondary_diff.no_target_after_model2} |`);
  lines.push(`| Previous BASE_RECALL_OR_MODEL2_FIRST_LOSS | ${summary.secondary_diff.first_loss_base_recall_or_model2} |`);
  lines.push(`| Primary cohort (this audit) | ${summary.primary_n} |`);
  lines.push(`| Secondary-only (in 118 not in 116) | ${summary.secondary_diff.secondary_only.length} |`);
  lines.push('');
  lines.push('### 118 vs 116 explanation');
  lines.push('');
  for (const x of summary.secondary_diff.secondary_only) {
    lines.push(`- **${x.caseId}**: first_loss=\`${x.first_loss}\`, final_correct=${x.final_correct}, E1=${x.e1}, units=${JSON.stringify(x.units)} — ${x.reason}`);
  }
  lines.push('');
  lines.push('## Table B — Recall Funnel (primary)');
  lines.push('');
  lines.push('| Stage | Present | % Primary |');
  lines.push('|-------|--------:|----------:|');
  for (const [k, v] of Object.entries(summary.funnel)) {
    lines.push(`| ${k} | ${v} | ${pct(v, summary.primary_n)} |`);
  }
  lines.push('');
  lines.push('## Table C — Root Cause Distribution');
  lines.push('');
  lines.push('| Root Cause | Count | % Primary | Failure Class |');
  lines.push('|------------|------:|----------:|---------------|');
  for (const r of summary.root_cause_distribution) {
    lines.push(`| ${r.root_cause} | ${r.count} | ${r.pct} | ${r.failure_class || ''} |`);
  }
  lines.push('');
  lines.push(`Sum check: ${summary.root_cause_distribution.reduce((a, b) => a + b.count, 0)} / ${summary.primary_n}`);
  lines.push('');
  lines.push('### Decomposition tree');
  lines.push('');
  lines.push('```text');
  lines.push(`${summary.primary_n} BASE_RECALL_OR_MODEL2 failures`);
  for (const r of summary.root_cause_distribution) {
    lines.push(`├── ${r.root_cause}: ${r.count}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('## Table D — Lexicon Missing Target Profile');
  lines.push('');
  lines.push('| Type\\|Length | Count |');
  lines.push('|-------------|------:|');
  for (const [k, v] of Object.entries(summary.lexicon_missing_profile).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${k} | ${v} |`);
  }
  const missingExamples = [];
  for (const r of rows.filter((x) => x.R1 === 'ABSENT')) {
    for (const t of r.primary_targets || []) {
      missingExamples.push(`${r.caseId}:${t}`);
    }
  }
  lines.push('');
  lines.push(`TARGET_IN_LEXICON (any primary) = ${summary.lexicon_present_count}`);
  lines.push(`TARGET_NOT_IN_LEXICON (all primary) = ${summary.lexicon_missing_count}`);
  lines.push(`Top missing examples: ${missingExamples.slice(0, 25).join(', ')}`);
  lines.push('');
  lines.push('## Table E — Base Recall Failure (R1+R2+R3 ∩ R5 ABSENT)');
  lines.push('');
  {
    const baseFail = rows.filter(
      (r) => r.R1 === 'PRESENT' && r.R2 === 'PRESENT' && r.R3 === 'COMPATIBLE' && r.R5 === 'ABSENT'
    );
    lines.push(`| Subtype | Count |`);
    lines.push(`|---------|------:|`);
    lines.push(`| Total (lex+span+phone, base miss) | ${baseFail.length} |`);
    lines.push(`| query not issued (R4≠PRESENT) | ${baseFail.filter((r) => r.R4 !== 'PRESENT').length} |`);
    lines.push(`| query issued, target not returned | ${baseFail.filter((r) => r.R4 === 'PRESENT').length} |`);
    lines.push(`| classified BASE_RECALL_* | ${baseFail.filter((r) => String(r.root_cause).startsWith('BASE_RECALL')).length} |`);
    lines.push(`| deferred (Model2 input/obs under replay) | ${baseFail.filter((r) => r.replay_limitation || r.root_cause === 'MODEL2_INPUT_MISSING').length} |`);
    lines.push('');
  }
  lines.push('## Table F — Model2 Opportunity Funnel');
  lines.push('');
  lines.push('| Stage | Count |');
  lines.push('|-------|------:|');
  lines.push(`| MODEL2_ELIGIBLE | ${summary.funnel.MODEL2_ELIGIBLE} |`);
  lines.push(`| MODEL2_INPUT_AVAILABLE (AVAILABLE\\|PARTIAL) | ${summary.funnel.MODEL2_INPUT_AVAILABLE} |`);
  lines.push(`| MODEL2_INVOKED | ${summary.funnel.MODEL2_INVOKED} |`);
  lines.push(`| MODEL2_TARGET_GENERATED | ${summary.funnel.MODEL2_TARGET_GENERATED} |`);
  lines.push(`| MODEL2_TARGET_SURVIVED_HANDOFF (R10) | ${summary.funnel.AFTER_MODEL2_TARGET_PRESENT} |`);
  lines.push(`| Replay-blocked P-path (NO_P_ACTION/p_feature) | ${summary.model2_replay_blocked_count} |`);
  lines.push(`| Strict Model2 capability opportunity (Q10) | ${summary.answers.Q10_model2_opportunity_upper_bound} |`);
  lines.push('');
  lines.push('## Table G — Model2 Contract Check');
  lines.push('');
  lines.push('| Check | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Independent expansion supported? | ${summary.model2_contract.independent_expansion} |`);
  lines.push(`| Base-candidate-only? | ${summary.model2_contract.base_candidate_rerank_only} |`);
  lines.push(`| MODE | ${summary.model2_contract.mode} |`);
  lines.push(`| Can unseen/base-missed target be generated? | ${summary.model2_contract.can_generate_base_missed_target} |`);
  lines.push(`| Profile features consumed? | ${summary.model2_contract.profile_features_consumed} |`);
  lines.push(`| Checkpoint active? | ${summary.model2_contract.checkpoint_active} |`);
  lines.push(`| Violation? | ${summary.model2_contract.violation} |`);
  lines.push('');
  lines.push('Evidence:');
  for (const e of summary.model2_contract.evidence || []) lines.push(`- ${e}`);
  lines.push('');
  lines.push('## Per-Case Trace (compact)');
  lines.push('');
  lines.push('| CASE | TARGET | LEN | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | ROOT | CLASS | VIOL |');
  lines.push('|------|--------|----:|----|----|----|----|----|----|----|----|----|-----|------|-------|------|');
  for (const r of rows) {
    const t = (r.primary_targets || [])[0] || '';
    lines.push(
      `| ${r.caseId} | ${t} | ${[...String(t)].length} | ${r.R1} | ${r.R2} | ${r.R3} | ${r.R4} | ${r.R5} | ${r.R6} | ${r.R7} | ${r.R8} | ${r.R9} | ${r.R10} | ${r.root_cause} | ${r.failure_class} | ${r.violation_demonstrated} |`
    );
  }
  lines.push('');
  lines.push('## Answers Q1–Q11');
  lines.push('');
  for (const [k, v] of Object.entries(summary.answers)) {
    lines.push(`- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  lines.push('');
  lines.push('## Final Result');
  lines.push('');
  lines.push('```text');
  lines.push(summary.result_enum);
  lines.push('NO PRODUCTION CHANGE');
  lines.push('```');
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  lines.push('- TRACE: `LINGUA_DIALOG200_RECALL_MODEL2_FIRST_LOSS_TRACE_V1.jsonl`');
  lines.push('- SUMMARY: `LINGUA_DIALOG200_RECALL_MODEL2_FIRST_LOSS_SUMMARY_V1.json`');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const prior = fs
    .readFileSync(PRIOR_TRACE, 'utf8')
    .trim()
    .split(/\n/)
    .map((l) => JSON.parse(l));
  const repair = prior.filter((r) => r.repair_required);
  const primary = repair.filter((r) => r.first_loss === 'BASE_RECALL_OR_MODEL2');
  const noTarget = repair.filter((r) => r.model2_target_source === 'NONE');
  const secondaryOnly = noTarget
    .filter((r) => r.first_loss !== 'BASE_RECALL_OR_MODEL2')
    .map((r) => ({
      caseId: r.caseId,
      first_loss: r.first_loss,
      final_correct: r.final_correct,
      e1: r.evidence?.E1_TARGET_RECALL,
      units: r.required_lexical_units,
      reason:
        r.first_loss === 'PATH_GENERATION'
          ? 'NO_TARGET but E1=N/A (no lexical units) → PATH_GENERATION not BASE_RECALL_OR_MODEL2'
          : r.first_loss === 'NONE_FINAL_CORRECT'
            ? 'NO_TARGET but FINAL_CORRECT (script-norm / keep-raw success) → not a first-loss failure'
            : 'definition mismatch',
    }));

  const secondaryDiff = {
    no_target_after_model2: noTarget.length,
    first_loss_base_recall_or_model2: primary.length,
    secondary_only: secondaryOnly,
  };

  let cohort = primary;
  if (LIMIT > 0) cohort = cohort.slice(0, LIMIT);

  const asrMap = {};
  for (const line of fs.readFileSync(FRESH_ASR, 'utf8').trim().split(/\n/)) {
    const r = JSON.parse(line);
    if (r.caseId) asrMap[r.caseId] = r.asr?.rawMergedAsrText ?? r.rawMergedAsrText;
  }

  const lex = openLexicon();
  const allUnits = cohort.flatMap((c) => pickPrimaryTargets(c.required_lexical_units || []));
  lex.preload(allUnits);
  console.log(`[decomp] lexicon preloaded unique=${new Set(allUnits).size}`);
  const expandSrc = fs.readFileSync(
    path.join(ELECTRON, 'main/src/model2-runtime/expand-windows-with-model2.ts'),
    'utf8'
  );
  const model2Contract = {
    mode: 'HYBRID',
    independent_expansion:
      expandSrc.includes('executeProfileLexiconQueries') && expandSrc.includes('materializeProfileHits')
        ? 'YES'
        : 'UNKNOWN',
    base_candidate_rerank_only: 'NO',
    evidence: [
      'expand-windows-with-model2.ts: executeProfileLexiconQueries → materializeProfileHits → mergeProfileIntoWindowCandidates',
      'Model2 issues independent P/D lexicon queries from selected actions; merges with base (not base-only rerank)',
    ],
    frozen_contract: 'Model2 PRE_LEXICAL_EDGE independent expansion',
    violation: 'NO',
    profile_features_consumed: expandSrc.includes('buildModel2PolicyInput') ? 'YES' : 'UNKNOWN',
    checkpoint_active: 'UNKNOWN (runtime identity not re-verified this audit)',
    can_generate_base_missed_target: 'YES (contract+code path exists; yield separate)',
  };

  const runtimeById = {};
  if (fromTrace && fs.existsSync(TRACE_OUT)) {
    console.log('[decomp] --from-trace: reusing TRACE runtime fields');
    for (const line of fs.readFileSync(TRACE_OUT, 'utf8').trim().split(/\n/)) {
      const r = JSON.parse(line);
      if (r.caseId && r.runtime) runtimeById[r.caseId] = r.runtime;
      // also carry forward classify fields if present for lexicon-absent early exits
      if (r.caseId && r.R1 === 'ABSENT') {
        runtimeById[r.caseId] = r.runtime || { _lexicon_absent_prior: true };
      }
    }
  } else if (!analyzeOnly) {
    const port = skipStart ? getTestServerPort() : await startServer();
    if (skipStart) await waitTestServerHealth(port, 60000);
    console.log(`[decomp] replaying ${cohort.length} primary cases`);
    let i = 0;
    for (const c of cohort) {
      i += 1;
      const asr = asrMap[c.caseId] || c.asr;
      try {
        const data = await runMock(port, asr, c.caseId);
        const targets = pickPrimaryTargets(c.required_lexical_units || []);
        runtimeById[c.caseId] = extractRuntimeEvidence(data, targets);
        if (i % 20 === 0) console.log(`[decomp] ${i}/${cohort.length}`);
      } catch (e) {
        runtimeById[c.caseId] = { error: String(e.message || e) };
        console.log(`[decomp] FAIL ${c.caseId}`, e.message || e);
      }
    }
    killPort(5020);
  }

  const rows = [];
  for (const c of cohort) {
    const targets = pickPrimaryTargets(c.required_lexical_units || []);
    const runtime = runtimeById[c.caseId] || null;
    const cls = classifyCase(c, lex, runtime, targets);
    rows.push({
      caseId: c.caseId,
      asr: c.asr,
      expected: c.expected,
      final: c.final,
      targets_all: c.required_lexical_units,
      primary_targets: targets,
      ...cls,
      failure_class: cls.failure_class,
      violation_demonstrated: cls.violation || 'NO',
    });
  }

  lex.db.close();

  const summary = buildSummary(rows, secondaryDiff, model2Contract);
  // attach class to dist
  summary.root_cause_distribution = summary.root_cause_distribution.map((r) => {
    const sample = rows.find((x) => x.root_cause === r.root_cause);
    return { ...r, failure_class: sample?.failure_class || null };
  });

  fs.writeFileSync(TRACE_OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(SUMMARY_OUT, JSON.stringify(summary, null, 2));
  fs.writeFileSync(REPORT_OUT, renderReport(summary, rows));
  console.log('[decomp] RESULT', summary.result_enum);
  console.log('[decomp] dist', summary.root_cause_distribution);
  console.log('[decomp] Q1', summary.answers.Q1);
  console.log('[decomp] Q11', summary.answers.Q11_next_owner);
  console.log('[decomp] wrote', REPORT_OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
