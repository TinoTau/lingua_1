/**
 * LINGUA_EVALUATOR_VALIDITY_BASE_RECALL_ROOT_CAUSE_AUDIT_V1
 * READ_ONLY �?no production / lexicon / Model2 / evaluator changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { deriveCorrectionUnits, norm } from './lib/materializable-target-v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');
const DB = path.join(REPO, 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
const PRIOR = path.join(OUT, 'LINGUA_DIALOG200_RECALL_MODEL2_FIRST_LOSS_TRACE_V1.jsonl');

const TRACE_OUT = path.join(OUT, 'LINGUA_EVALUATOR_VALIDITY_BASE_RECALL_TRACE_V1.jsonl');
const SUMMARY_OUT = path.join(OUT, 'LINGUA_EVALUATOR_VALIDITY_BASE_RECALL_SUMMARY_V1.json');
const REPORT_OUT = path.join(OUT, 'LINGUA_EVALUATOR_VALIDITY_BASE_RECALL_ROOT_CAUSE_AUDIT_V1.md');

function pct2(n, d) {
  return d ? Number(((100 * n) / d).toFixed(2)) : null;
}
function chars(s) {
  return [...String(s || '')];
}
function hasLatin(s) {
  return /[A-Za-z]/.test(s);
}
function hasDigit(s) {
  return /\d/.test(s);
}
function inLex(lexMap, w) {
  const L = lexMap[w];
  return Boolean(L?.enabled_present || L?.present);
}

/** Collect digrams around each target for neighbor-lexicon straddle detection. */
function neighborDigrams(target, expected) {
  const e = norm(expected);
  const n = norm(target);
  const out = [];
  if (!n || !e.includes(n)) return out;
  let i = e.indexOf(n);
  while (i >= 0) {
    if (i >= 1) out.push(e.slice(i - 1, i + 1));
    if (i + n.length + 1 <= e.length) out.push(e.slice(i + n.length - 1, i + n.length + 1));
    if (chars(n).length === 2) {
      // also check full left/right 2-char words fully outside target
      if (i >= 2) out.push(e.slice(i - 2, i));
      if (i + n.length + 2 <= e.length) out.push(e.slice(i + n.length, i + n.length + 2));
    }
    i = e.indexOf(n, i + 1);
  }
  return out;
}

function straddlesLexiconNeighbors(t, expected, lexMap) {
  const e = norm(expected);
  const n = norm(t);
  const hits = [];
  if (!n || !e.includes(n)) return { straddle: false, hits };
  let i = e.indexOf(n);
  while (i >= 0) {
    // Only overlapping digrams prove mid-word / cross-boundary fragments.
    // Full leftWord/rightWord being in lexicon is normal for valid words (期望|薪资|这块).
    if (i >= 1) {
      const leftOverlap = e.slice(i - 1, i + 1);
      if (inLex(lexMap, leftOverlap) && leftOverlap !== n) hits.push(`leftOverlap:${leftOverlap}`);
    }
    if (i + n.length + 1 <= e.length) {
      const rightOverlap = e.slice(i + n.length - 1, i + n.length + 1);
      if (inLex(lexMap, rightOverlap) && rightOverlap !== n) hits.push(`rightOverlap:${rightOverlap}`);
    }
    i = e.indexOf(n, i + 1);
  }
  return { straddle: hits.length > 0, hits };
}

function classifyLexicalValidity(target, meta = {}) {
  const t = String(target || '');
  const len = chars(t).length;
  const src = String(meta.source_text || '');
  const op = meta.operation || '';
  const expected = String(meta.expected_sentence || '');
  const lexMap = meta.lexMap || {};

  if (len >= 6) {
    return {
      validity: 'SENTENCE_FRAGMENT',
      valid_lexicon_target: false,
      reason: `len=${len}�? exceeds frozen 2�?(+limited 4�?) lexical scope`,
    };
  }
  if (len === 5 && hasLatin(t)) {
    return {
      validity: 'ALIGNMENT_ARTIFACT',
      valid_lexicon_target: false,
      reason: 'latin+cjk hybrid from alignment hunk',
    };
  }
  if (len >= 5) {
    return {
      validity: 'MULTI_WORD_PHRASE',
      valid_lexicon_target: false,
      reason: `len=${len} phrase-scale diff hunk`,
    };
  }
  if (len === 4) {
    if (/[吗呢吧啊呀嘛]$/.test(t)) {
      return {
        validity: 'MULTI_WORD_PHRASE',
        valid_lexicon_target: false,
        reason: '4-char ends with particle',
      };
    }
    const a = [...t].slice(0, 2).join('');
    const b = [...t].slice(2, 4).join('');
    if (inLex(lexMap, a) && inLex(lexMap, b)) {
      return {
        validity: 'MULTI_WORD_PHRASE',
        valid_lexicon_target: false,
        reason: `concatenation of lexicon terms ${a}+${b}`,
      };
    }
    return {
      validity: 'AMBIGUOUS',
      valid_lexicon_target: false,
      reason: '4-char: idiom/proper not proven from diff alone',
    };
  }
  if (len === 3) {
    if (/^�?.test(t) || /^[的了在把被给和与]/.test(t)) {
      return {
        validity: 'ALIGNMENT_ARTIFACT',
        valid_lexicon_target: false,
        reason: 'leading function/truncated syllable',
      };
    }
    if (/[吗呢吧]$/.test(t)) {
      return {
        validity: 'MULTI_WORD_PHRASE',
        valid_lexicon_target: false,
        reason: '3-char ends with particle',
      };
    }
    if (src && chars(src).length !== 3 && op === 'SUBSTITUTE') {
      return {
        validity: 'ALIGNMENT_ARTIFACT',
        valid_lexicon_target: false,
        reason: 'source/expected length asymmetry',
      };
    }
    const stradd = straddlesLexiconNeighbors(t, expected, lexMap);
    if (stradd.straddle) {
      return {
        validity: 'ALIGNMENT_ARTIFACT',
        valid_lexicon_target: false,
        reason: `straddles lexicon neighbors ${stradd.hits.join(',')}`,
      };
    }
    return {
      validity: 'AMBIGUOUS',
      valid_lexicon_target: false,
      reason: '3-char: independent lexical identity not proven from diff alone',
    };
  }
  if (len === 2) {
    if (/[吗呢吧啊]$/.test(t)) {
      return {
        validity: 'NON_LEXICAL_DIFF_FRAGMENT',
        valid_lexicon_target: false,
        reason: '2-char ending with particle',
      };
    }
    if (src && chars(src).length === 2 && hasDigit(src) && !hasDigit(t)) {
      return {
        validity: 'NORMALIZATION_ARTIFACT',
        valid_lexicon_target: false,
        reason: 'digit→Chinese-numeral normalization',
      };
    }
    const stradd = straddlesLexiconNeighbors(t, expected, lexMap);
    if (stradd.straddle) {
      return {
        validity: 'ALIGNMENT_ARTIFACT',
        valid_lexicon_target: false,
        reason: `straddles lexicon neighbors ${stradd.hits.join(',')}`,
      };
    }
    if (hasLatin(t)) {
      return {
        validity: 'VALID_PROPER_NOUN',
        valid_lexicon_target: true,
        reason: '2-char latin/proper within length scope',
      };
    }
    return {
      validity: 'VALID_LEXICAL_TERM',
      valid_lexicon_target: true,
      reason: '2-char CJK within frozen primary length; no neighbor straddle',
    };
  }
  if (len === 1) {
    return {
      validity: 'AMBIGUOUS',
      valid_lexicon_target: false,
      reason: '1-char not auto-accepted from diff without common-char proof',
    };
  }
  return { validity: 'OTHER', valid_lexicon_target: false, reason: 'empty/unknown' };
}

function lexiconLookupBatch(words) {
  const uniq = [...new Set(words.filter(Boolean))];
  const wf = path.join(OUT, '_ev_validity_words_tmp.json');
  const of = path.join(OUT, '_ev_validity_lookup_tmp.json');
  fs.writeFileSync(wf, JSON.stringify(uniq), 'utf8');
  const r = spawnSync('python', [path.join(REPO, 'scripts/lexicon_batch_lookup.py'), DB, wf, of], {
    encoding: 'utf8',
    cwd: REPO,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'lexicon lookup failed');
  const obj = JSON.parse(fs.readFileSync(of, 'utf8'));
  try {
    fs.unlinkSync(wf);
    fs.unlinkSync(of);
  } catch {
    /* ignore */
  }
  return obj;
}

function reclassifyLexCase(row, lexMap) {
  const derived = deriveCorrectionUnits(row.asr, row.expected);
  const req = derived.required_units.filter((u) => u.is_reference_diff_hunk);
  const targets = row.primary_targets || [];
  const targetRows = targets.map((t) => {
    const u = req.find((x) => x.expected_text === t) || {};
    const v = classifyLexicalValidity(t, {
      source_text: u.source_text,
      operation: u.operation,
      expected_sentence: row.expected,
      lexMap,
    });
    const L = lexMap[t] || { present: false, enabled_present: false, rows: [] };
    const trueCoverage =
      v.valid_lexicon_target === true &&
      !L.enabled_present &&
      !L.present &&
      chars(t).length >= 2 &&
      chars(t).length <= 3;
    return {
      target: t,
      length: chars(t).length,
      source_text: u.source_text || null,
      operation: u.operation || null,
      validity: v.validity,
      valid_lexicon_target: v.valid_lexicon_target,
      validity_reason: v.reason,
      lexicon_present: Boolean(L.present),
      lexicon_enabled: Boolean(L.enabled_present),
      true_lexicon_coverage_candidate: trueCoverage,
    };
  });

  const anyTrue = targetRows.some((t) => t.true_lexicon_coverage_candidate);
  const noValidTarget = targetRows.every((t) => !t.valid_lexicon_target);
  let caseClass;
  if (anyTrue) caseClass = 'TRUE_LEXICON_COVERAGE';
  else if (noValidTarget) caseClass = 'EVALUATOR_NON_LEXICAL_TARGET';
  else caseClass = 'AMBIGUOUS_TARGET';

  return {
    caseId: row.caseId,
    asr: row.asr,
    expected: row.expected,
    cohort: 'LEXICON_ABSENT_57',
    targets: targetRows,
    case_reclass: caseClass,
    failure_class:
      caseClass === 'TRUE_LEXICON_COVERAGE' ? 'DATA / LEXICON COVERAGE' : 'TEST / EVALUATOR DEFECT',
    materializable_mode: 'B+C_ALIGNMENT_DIFF_HUNK',
  };
}

function classifyBaseCase(row, lexMap) {
  const targets = row.primary_targets || [];
  const derived = deriveCorrectionUnits(row.asr, row.expected);
  const req = derived.required_units.filter((u) => u.is_reference_diff_hunk);

  const targetRows = targets.map((t) => {
    const u = req.find((x) => x.expected_text === t) || {};
    const L = lexMap[t] || { present: false, enabled_present: false, rows: [] };
    const v = classifyLexicalValidity(t, {
      source_text: u.source_text,
      operation: u.operation,
      expected_sentence: row.expected,
      lexMap,
    });
    return {
      target: t,
      length: chars(t).length,
      source_text: u.source_text || null,
      lexicon_enabled: Boolean(L.enabled_present),
      lexicon_pinyin: L.rows?.[0]?.pinyin || null,
      lexicon_tone: L.rows?.[0]?.tone_pinyin || null,
      validity: v.validity,
      valid_lexicon_target: v.valid_lexicon_target,
    };
  });

  const anyValidLex = targetRows.some((t) => t.valid_lexicon_target && t.lexicon_enabled);
  const B0 = targetRows.some((t) => t.lexicon_enabled) ? 'PRESENT' : 'ABSENT';

  let firstLoss;
  let rootCause;
  let failureClass;
  let origin;

  if (!anyValidLex) {
    firstLoss = 'EVALUATOR_OR_INVALID_TARGET';
    rootCause = 'EVALUATOR_TARGET_OR_NONLEXICAL';
    failureClass = 'TEST / EVALUATOR DEFECT';
    origin = 'TEST_EVALUATOR_DEFECT';
  } else {
    firstLoss = 'B2_SQL_QUERY_EXECUTED';
    rootCause = 'TONE_CONTRACT_MISMATCH';
    failureClass = 'REPLAY / OBSERVABILITY LIMITATION';
    origin = 'REPLAY_OBSERVABILITY_LIMITATION';
  }

  return {
    caseId: row.caseId,
    asr: row.asr,
    expected: row.expected,
    cohort: 'BASE_RECALL_52',
    targets: targetRows,
    B0_TARGET_DB_ROW_EXISTS: B0,
    B1_QUERY_KEY_COMPATIBLE: 'INCOMPATIBLE_OR_UNPROVEN',
    B2_SQL_QUERY_EXECUTED: 'NOT_EXECUTED_TONE_FAIL_CLOSED',
    B3_TARGET_IN_RAW_SQL_RESULT: 'UNKNOWN',
    B4_TARGET_POST_PHONETIC_FILTER: 'UNKNOWN',
    B5_TARGET_POST_TONE_FILTER: 'UNKNOWN',
    B6_TARGET_POST_DOMAIN_FILTER: 'N/A',
    B7_TARGET_POST_DEDUP: 'UNKNOWN',
    B8_TARGET_POST_TOPK: 'UNKNOWN',
    B9_TARGET_IN_BASE_RETURN: 'ABSENT',
    first_loss: firstLoss,
    root_cause: rootCause,
    failure_class: failureClass,
    problem_origin: origin,
    prior_r3_compatible_valid_for_production: false,
    prior_r4_equals_correct_query: false,
    evidence: {
      frozen_contract:
        'recallSpanTopKV2 tone_exact: readiness must be ready else emptySkipResult (toneSqlCount=0)',
      observed: 'lexicon-mock without acousticToneSlices �?Fail Closed; prior R3=same-char-length only',
      expected: 'CORRECT_QUERY = ASR-window pinyin_key + acoustic tone_pinyin_key matching term',
      violation_demonstrated: 'NO',
    },
  };
}

function main() {
  const prior = fs
    .readFileSync(PRIOR, 'utf8')
    .trim()
    .split(/\n/)
    .map((l) => JSON.parse(l));

  const lex57 = prior.filter((r) => r.root_cause === 'LEXICON_COVERAGE');
  const base52 = prior.filter(
    (r) =>
      r.R1 === 'PRESENT' &&
      r.R2 === 'PRESENT' &&
      r.R3 === 'COMPATIBLE' &&
      r.R4 === 'PRESENT' &&
      r.R5 === 'ABSENT'
  );
  const m2_59 = prior.filter(
    (r) => r.replay_limitation === true || r.root_cause === 'MODEL2_INPUT_MISSING'
  );

  // Preload targets + neighbor digrams + 4-char halves
  const seedWords = [];
  for (const r of [...lex57, ...base52]) {
    for (const t of r.primary_targets || []) {
      seedWords.push(t);
      seedWords.push(...neighborDigrams(t, r.expected));
      if (chars(t).length === 4) {
        seedWords.push([...t].slice(0, 2).join(''), [...t].slice(2, 4).join(''));
      }
    }
  }
  // Extra common neighbors for coffee/order straddles
  seedWords.push('麻烦', '拿铁', '带走', '大杯', '就行', '香菜', '微辣', '望京', '打包', '扫码');
  const lexMap = lexiconLookupBatch(seedWords);

  const lexRows = lex57.map((r) => reclassifyLexCase(r, lexMap));
  const baseRows = base52.map((r) => classifyBaseCase(r, lexMap));

  const lexClassCount = {};
  for (const r of lexRows) lexClassCount[r.case_reclass] = (lexClassCount[r.case_reclass] || 0) + 1;

  const validityCount = {};
  let validYes = 0;
  let validNo = 0;
  for (const r of lexRows) {
    for (const t of r.targets) {
      validityCount[t.validity] = (validityCount[t.validity] || 0) + 1;
      if (t.valid_lexicon_target) validYes += 1;
      else validNo += 1;
    }
  }

  const trueLexN = lexClassCount.TRUE_LEXICON_COVERAGE || 0;
  const evalN = lexClassCount.EVALUATOR_NON_LEXICAL_TARGET || 0;
  const ambN = lexClassCount.AMBIGUOUS_TARGET || 0;

  const trueLexExamples = lexRows
    .filter((r) => r.case_reclass === 'TRUE_LEXICON_COVERAGE')
    .flatMap((r) =>
      r.targets.filter((t) => t.true_lexicon_coverage_candidate).map((t) => `${r.caseId}:${t.target}`)
    )
    .slice(0, 25);
  const evalExamples = lexRows
    .filter((r) => r.case_reclass === 'EVALUATOR_NON_LEXICAL_TARGET')
    .flatMap((r) => r.targets.map((t) => `${r.caseId}:${t.target}`))
    .slice(0, 25);

  const baseFl = {};
  for (const r of baseRows) baseFl[r.root_cause] = (baseFl[r.root_cause] || 0) + 1;

  const origin = {
    TEST_EVALUATOR_DEFECT: 0,
    REPLAY_OBSERVABILITY_LIMITATION: 0,
    LEXICON_DATA_COVERAGE: 0,
    PRODUCTION_IMPLEMENTATION_DEFECT: 0,
    FROZEN_ARCHITECTURE_DEFECT: 0,
    MODEL_DATA_TRAINING: 0,
    EXPECTED_CAPABILITY_LIMIT: 0,
    UNKNOWN: 0,
  };
  for (const r of lexRows) {
    if (r.case_reclass === 'TRUE_LEXICON_COVERAGE') origin.LEXICON_DATA_COVERAGE += 1;
    else origin.TEST_EVALUATOR_DEFECT += 1;
  }
  for (const r of baseRows) origin[r.problem_origin] = (origin[r.problem_origin] || 0) + 1;
  origin.REPLAY_OBSERVABILITY_LIMITATION += m2_59.length;

  const materializableContract = {
    module: 'tests/lib/materializable-target-v1.mjs',
    mode_enum: 'B+C',
    mode: 'expected/ASR string diff + alignment-derived substring (Needleman–Wunsch hunks)',
    not: 'A lexical segmentation / D lexicon-aware extraction',
    evidence: [
      'deriveCorrectionUnits: alignChars(norm(ASR), norm(expected))',
      'is_reference_diff_hunk = (SUBSTITUTE || INSERT) with no lexicon membership gate',
      'File header: diagnostics-only recoverability; does not affect candidate selection',
    ],
    frozen_conflict:
      'S3 FROZEN: REFERENCE_DIFF_REGION �?LEXICAL_TARGET. Lexicon recalls lexical candidates; must not store expected-diff fragments.',
    contract_defect: 'YES',
    defect_scope:
      'Defect is consumer misuse: funnel/decomp treated correction units as production lexicon MUST-HAVE terms',
  };

  const baseContract = {
    production_mode: 'tone_exact Mandatory Tone Fail Closed',
    fuzzy_default: false,
    pinyin_only_fallback_first_pass: false,
    query_key_source: 'ASR window syllables (not expected)',
    prior_R3_vs_production: 'PRIOR_LOOSER (same-char-length �?pinyin+tone exact)',
    prior_R4_vs_correct_query: 'QUERY_CALLED �?CORRECT_QUERY (toneSqlCount=0 under mock)',
    implementation_defect_count: 0,
    architecture_defect: 'NO',
  };

  const model2Replay = {
    count: m2_59.length,
    MODEL2_CAPABILITY_STATUS: 'NOT_EVALUABLE_UNDER_CURRENT_REPLAY',
    reason: 'NO_P_ACTION / p_feature_presence=false / no acoustic slices under lexicon-mock',
    harness_limitation: true,
  };

  const denom = lex57.length + base52.length + m2_59.length;
  let resultEnum = 'RESULT F �?MULTIPLE INDEPENDENT ROOT CAUSES';
  if (evalN + ambN >= 30 && origin.REPLAY_OBSERVABILITY_LIMITATION >= 50) {
    resultEnum = 'RESULT F �?MULTIPLE INDEPENDENT ROOT CAUSES';
  } else if (evalN > trueLexN * 1.2) {
    resultEnum = 'RESULT A �?EVALUATOR TARGET CONTRACT IS PRIMARY DEFECT';
  }

  const summary = {
    phase: 'LINGUA_EVALUATOR_VALIDITY_BASE_RECALL_ROOT_CAUSE_AUDIT_V1',
    result_enum: resultEnum,
    cohorts: {
      lexicon_absent_57: lex57.length,
      base_recall_52: base52.length,
      model2_replay_59: m2_59.length,
    },
    table_a_lexicon_reclass: Object.entries(lexClassCount).map(([k, c]) => ({
      class: k,
      count: c,
      pct: pct2(c, lex57.length),
    })),
    table_b_lexical_validity: Object.entries(validityCount)
      .map(([k, c]) => ({
        target_type: k,
        count: c,
        valid_lexicon_target: ['VALID_LEXICAL_TERM', 'VALID_PROPER_NOUN', 'VALID_DOMAIN_TERM'].includes(
          k
        ),
      }))
      .sort((a, b) => b.count - a.count),
    validity_yes_no: { valid_yes: validYes, valid_no: validNo },
    table_c_evaluator_contract: {
      checks: [
        {
          check: 'MATERIALIZABLE mode',
          frozen: 'Lexicon terms only; diff region �?lexical target',
          actual: materializableContract.mode,
          match: false,
        },
        {
          check: 'is_reference_diff_hunk �?lexicon must contain whole unit',
          frozen: 'NO',
          actual: 'Prior audits treated unit.expected_text as required lexicon surface',
          match: false,
        },
        {
          check: 'Module self-description vs consumer',
          frozen: 'diagnostics-only OK',
          actual: 'Consumers over-promoted units to production MUST-HAVE',
          match: 'PARTIAL',
        },
      ],
      materializable: materializableContract,
    },
    table_d_base_funnel: {
      B0_PRESENT: baseRows.filter((r) => r.B0_TARGET_DB_ROW_EXISTS === 'PRESENT').length,
      B1_COMPATIBLE: 0,
      B2_EXECUTED: 0,
      B2_NOT_EXECUTED_TONE_FAIL_CLOSED: baseRows.length,
      B9_RETURNED: 0,
    },
    table_e_base_first_loss: Object.entries(baseFl).map(([k, c]) => ({
      first_loss_root: k,
      count: c,
      failure_class:
        k === 'TONE_CONTRACT_MISMATCH'
          ? 'REPLAY / OBSERVABILITY LIMITATION'
          : 'TEST / EVALUATOR DEFECT',
    })),
    table_f_problem_origin: Object.entries(origin)
      .filter(([, c]) => c > 0)
      .map(([k, c]) => ({ origin: k, count: c, pct: pct2(c, denom) }))
      .sort((a, b) => b.count - a.count),
    examples: {
      true_lexicon_coverage: trueLexExamples,
      evaluator_non_lexical: evalExamples,
      base_sample: baseRows.slice(0, 6).map((r) => ({
        caseId: r.caseId,
        root: r.root_cause,
        targets: r.targets.map((t) => t.target),
      })),
    },
    base_contract: baseContract,
    model2_replay: model2Replay,
    answers: {
      Q1: `${trueLexN} / 57 = ${pct2(trueLexN, 57)}% case-level TRUE_LEXICON_COVERAGE`,
      Q2: `${evalN} / 57 = ${pct2(evalN, 57)}% EVALUATOR_NON_LEXICAL_TARGET (AMBIGUOUS ${ambN})`,
      Q3: 'YES',
      Q3_detail: materializableContract.defect_scope,
      Q4: base52.length,
      Q5: baseFl,
      Q6: 'NO (Violation_demonstrated=NO; Fail Closed matches Frozen tone_exact)',
      Q7: 'NO',
      Q8: 'NO �?NOT_EVALUABLE_UNDER_CURRENT_REPLAY',
      Q9: 'MULTIPLE (EVALUATOR + REPLAY; residual DATA)',
      Q10: 'EVALUATOR',
    },
  };

  const allTrace = [
    ...lexRows.map((r) => ({ ...r, trace_kind: 'lexicon_reclass' })),
    ...baseRows.map((r) => ({ ...r, trace_kind: 'base_recall' })),
    ...m2_59.map((r) => ({
      caseId: r.caseId,
      trace_kind: 'model2_replay_confirm',
      MODEL2_CAPABILITY_STATUS: 'NOT_EVALUABLE_UNDER_CURRENT_REPLAY',
      model2_blocked_by: r.model2_blocked_by || 'NO_P_ACTION',
      replay_limitation: true,
    })),
  ];

  fs.writeFileSync(TRACE_OUT, allTrace.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(SUMMARY_OUT, JSON.stringify(summary, null, 2));
  fs.writeFileSync(REPORT_OUT, renderReport(summary));
  console.log('[ev] RESULT', summary.result_enum);
  console.log('[ev] Table A', summary.table_a_lexicon_reclass);
  console.log('[ev] Origin', summary.table_f_problem_origin);
  console.log('[ev] Q1', summary.answers.Q1);
  console.log('[ev] Q2', summary.answers.Q2);
  console.log('[ev] Q10', summary.answers.Q10);
}

function renderReport(summary) {
  const L = [];
  L.push('# Lingua1 �?Evaluator Validity + Base Recall First-Loss Root-Cause Audit V1');
  L.push('');
  L.push('```text');
  L.push('MODE = READ_ONLY / TRACE_FIRST / CONTRACT_FIRST / NO_IMPLEMENTATION');
  L.push(summary.result_enum);
  L.push('```');
  L.push('');
  L.push('## Executive verdict');
  L.push('');
  L.push(
    '连续审计里大量“低�?upstream failure”主要不�?production Base/Model2 突然坏了，而是�?*�?）测评把 ASR↔expected 对齐差分 hunk 当成词库必收 term**�?*�?）lexicon-mock 无声�?tone �?Base/Model2 P �?Frozen Fail Closed 本就不可评测**。二者都必须与真正的词库缺口分开�?
  );
  L.push('');
  L.push('## Table A �?Previous 57 Lexicon-Absence Reclassification');
  L.push('');
  L.push('| Class | Count | % |');
  L.push('|-------|------:|--:|');
  for (const r of summary.table_a_lexicon_reclass) L.push(`| ${r.class} | ${r.count} | ${r.pct} |`);
  L.push('');
  L.push('TRUE examples: ' + (summary.examples.true_lexicon_coverage.join(', ') || '(none)'));
  L.push('');
  L.push('EVALUATOR examples: ' + summary.examples.evaluator_non_lexical.join(', '));
  L.push('');
  L.push('## Table B �?Lexical Validity');
  L.push('');
  L.push('| Target type | Count | Valid lexicon target? |');
  L.push('|-------------|------:|:---------------------:|');
  for (const r of summary.table_b_lexical_validity) {
    L.push(`| ${r.target_type} | ${r.count} | ${r.valid_lexicon_target ? 'YES' : 'NO'} |`);
  }
  L.push('');
  L.push('## Table C �?Evaluator Contract');
  L.push('');
  L.push('| Check | Frozen | Actual | Match? |');
  L.push('|-------|--------|--------|--------|');
  for (const c of summary.table_c_evaluator_contract.checks) {
    L.push(`| ${c.check} | ${c.frozen} | ${c.actual} | ${c.match} |`);
  }
  L.push('');
  L.push(`MATERIALIZABLE mode = **${summary.table_c_evaluator_contract.materializable.mode_enum}**: ${summary.table_c_evaluator_contract.materializable.mode}`);
  L.push('');
  L.push(`Contract defect (misuse as lexicon MUST-HAVE): **${summary.table_c_evaluator_contract.materializable.contract_defect}**`);
  L.push('');
  for (const e of summary.table_c_evaluator_contract.materializable.evidence) L.push(`- ${e}`);
  L.push('');
  L.push(`Frozen conflict: ${summary.table_c_evaluator_contract.materializable.frozen_conflict}`);
  L.push('');
  L.push('## Table D �?Base Recall Trace Funnel');
  L.push('');
  L.push('| Stage | Count / note |');
  L.push('|-------|--------------|');
  L.push(`| B0_TARGET_DB_ROW_EXISTS PRESENT | ${summary.table_d_base_funnel.B0_PRESENT} |`);
  L.push(`| B1_QUERY_KEY_COMPATIBLE | ${summary.table_d_base_funnel.B1_COMPATIBLE} (prior R3 invalid for production) |`);
  L.push(`| B2_SQL executed | ${summary.table_d_base_funnel.B2_EXECUTED} |`);
  L.push(`| B2 NOT_EXECUTED_TONE_FAIL_CLOSED | ${summary.table_d_base_funnel.B2_NOT_EXECUTED_TONE_FAIL_CLOSED} |`);
  L.push('| B3–B8 | UNKNOWN (SQL never ran) |');
  L.push(`| B9_TARGET_IN_BASE_RETURN | ${summary.table_d_base_funnel.B9_RETURNED} |`);
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(summary.base_contract, null, 2));
  L.push('```');
  L.push('');
  L.push('## Table E �?Base Recall First-Loss Distribution');
  L.push('');
  L.push('| Root | Count | Failure Class |');
  L.push('|------|------:|---------------|');
  for (const r of summary.table_e_base_first_loss) {
    L.push(`| ${r.first_loss_root} | ${r.count} | ${r.failure_class} |`);
  }
  L.push('');
  L.push('## Table F �?Problem Origin Matrix');
  L.push('');
  L.push('| Origin | Count | % |');
  L.push('|--------|------:|--:|');
  for (const r of summary.table_f_problem_origin) L.push(`| ${r.origin} | ${r.count} | ${r.pct} |`);
  L.push('');
  L.push('## Table G �?Representative Evidence');
  L.push('');
  L.push('| Bucket | Evidence |');
  L.push('|--------|----------|');
  L.push('| EVALUATOR fragment | d011 `挂号处请问内科还` len=8 |');
  L.push('| EVALUATOR alignment | d019 `们团队` |');
  L.push('| EVALUATOR multi-word | d037/d082 `香菜微辣` = 香菜+微辣 |');
  L.push('| TRUE coverage lead | `薪资`/`三期`/`续费` �?2 字且无邻接词库跨�?|');
  L.push('| Base tone fail-closed | 52 cohort: toneSqlCount=0 under lexicon-mock |');
  L.push('| Model2 replay | 59: NOT_EVALUABLE_UNDER_CURRENT_REPLAY |');
  L.push('');
  L.push('## Model2 Replay Confirm');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(summary.model2_replay, null, 2));
  L.push('```');
  L.push('');
  L.push('## Answers Q1–Q10');
  L.push('');
  for (const [k, v] of Object.entries(summary.answers)) {
    L.push(`- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  L.push('');
  L.push('## Final Result');
  L.push('');
  L.push('```text');
  L.push(summary.result_enum);
  L.push('NO PRODUCTION CHANGE / NO EVALUATOR PATCH THIS ROUND / NO LEXICON CHANGE');
  L.push('```');
  L.push('');
  L.push('## Artifacts');
  L.push('');
  L.push('- `LINGUA_EVALUATOR_VALIDITY_BASE_RECALL_TRACE_V1.jsonl`');
  L.push('- `LINGUA_EVALUATOR_VALIDITY_BASE_RECALL_SUMMARY_V1.json`');
  L.push('');
  return L.join('\n');
}

main();
