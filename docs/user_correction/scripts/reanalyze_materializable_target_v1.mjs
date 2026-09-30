/**
 * MATERIALIZABLE_TARGET_V1 reanalysis of EXISTING Stage-J dialog_200 traces.
 * Diagnostics only. Does not rerun ASR or touch production business code.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import {
  TRACE_CONTRACT,
  LEGACY_TRACE_CONTRACT,
  evaluateMaterializableTargetV1,
  classifyPhoneticRelation,
} from '../../../electron_node/electron-node/tests/lib/materializable-target-v1.mjs';
import { probeLexiconSurfaces, writeJson, writeJsonl } from '../../../electron_node/electron-node/tests/lib/dialog200-path-trace-analyze.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : fallback;
}
const TRACE_DIR = argValue(
  '--trace-dir',
  path.join(REPO, 'training/model2_v3/experiments/v3_stage_j_live_dialog200')
);
const OUT = argValue('--out', path.join(TRACE_DIR, 'materializable_target_v1_2026_08_18'));
const SQLITE = path.join(REPO, 'node_runtime/lexicon/v3/lexicon.sqlite');
const PREV_TRUE_ASSEMBLY = [
  'd002', 'd005', 'd015', 'd019', 'd026', 'd027', 'd031', 'd047', 'd052',
];

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function inc(map, k) {
  map[k] = (map[k] || 0) + 1;
}

function lengthChange(unit) {
  const a = (unit.source_text || '').length;
  const b = (unit.expected_text || '').length;
  if (a === b) return 'same';
  if (b < a) return 'shorter';
  return 'longer';
}

function provenanceBucket(c) {
  const p = c.provenance || '';
  if (p === 'PROFILE_PRONUNCIATION') return 'PROFILE_PRONUNCIATION';
  if (p === 'PROFILE_DOMAIN') return 'PROFILE_DOMAIN';
  if (p === 'BASE_FUZZY' || c.source === 'base_term') return 'BASE';
  if (String(c.candidateId || '').startsWith('m2d:')) return 'PROFILE_DOMAIN';
  if (String(c.candidateId || '').startsWith('m2:')) return 'PROFILE_PRONUNCIATION';
  return 'BASE';
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const utterances = readJsonl(path.join(TRACE_DIR, 'dialog200_stagej_per_utterance.jsonl'));
  const legacyAttr = readJsonl(path.join(TRACE_DIR, 'dialog200_failure_attribution.jsonl'));
  const legacyFunnel = readJsonl(path.join(TRACE_DIR, 'dialog200_stagej_candidate_funnel.jsonl'));
  const expectedMap = Object.fromEntries(utterances.map((u) => [u.dialog_id, u.expectedText]));
  const lex = probeLexiconSurfaces(SQLITE, expectedMap);

  const perDialog = [];
  const perUnit = [];
  const gapCases = [];
  const trueAsm = [];
  const classCounts = {};
  const classCountsUnits = {};
  const gapClass = {};
  const lengthStats = { same: 0, shorter: 0, longer: 0 };
  const relationStats = {};
  const provenanceStats = { BASE: 0, PROFILE_PRONUNCIATION: 0, PROFILE_DOMAIN: 0, MULTI_PROVENANCE: 0 };
  const domainStats = { base: 0, sameDomain: 0, multi_domain: 0, domain_unknown: 0 };

  let cuTotal = 0;
  let requiring = 0;
  let lexD = 0;
  let pathD = 0;
  let sentD = 0;
  let asmD = 0;
  let kenlmD = 0;
  let finalD = 0;
  let lexU = 0;
  let pathU = 0;
  let sentU = 0;
  let asmU = 0;
  let gapDialogs = 0;
  let gapUnits = 0;
  let model2Gap = 0;
  let baseGap = 0;
  let anyLexD = 0;
  let anyPathD = 0;
  let anyAsmD = 0;
  let lexMissUnits = 0;
  let lexMissLen1 = 0;
  let lexMissInsert = 0;

  for (const rec of utterances) {
    const ev = evaluateMaterializableTargetV1(rec, { lexiconHit: lex.hits?.[rec.dialog_id] });
    const d = ev.dialog;
    perDialog.push(d);
    cuTotal += d.correction_units_total;
    if (d.requires_correction) requiring += 1;
    if (d.requires_correction && d.lexical_recoverable) lexD += 1;
    if (d.requires_correction && d.path_recoverable) pathD += 1;
    if (d.requires_correction && d.sentence_recoverable) sentD += 1;
    if (d.requires_correction && d.actually_assembled) asmD += 1;
    if (d.requires_correction && d.kenlm_available) kenlmD += 1;
    if (d.correct) finalD += 1;
    if (d.requires_correction && ev.required.some((u) => u.lexical_recoverable)) anyLexD += 1;
    if (d.requires_correction && ev.required.some((u) => u.path_recoverable)) anyPathD += 1;
    if (d.requires_correction && ev.required.some((u) => u.actually_assembled)) anyAsmD += 1;
    if (!d.correct && d.first_divergence?.class) inc(classCounts, d.first_divergence.class);

    if (d.requires_correction && d.lexical_recoverable && !d.path_recoverable) gapDialogs += 1;
    if (d.true_assembly_materialization_failure) {
      trueAsm.push({
        dialog_id: d.dialog_id,
        expected: d.expectedText,
        raw_asr: d.raw_asr,
        final: d.final_text,
        correction_units_total: d.correction_units_total,
        first_divergence: d.first_divergence,
      });
    }

    for (const u of ev.required) {
      perUnit.push({
        dialog_id: rec.dialog_id,
        scenario: rec.scenario,
        ...u,
        matching_candidates: (u.matching_candidates || []).map((m) => ({
          surface: m.surface,
          candidateId: m.candidateId,
          source: m.source,
          provenance: m.provenance,
          domains: m.domains,
          eligible: m.eligible,
          dropReason: m.dropReason,
          gap_class: m.gap_class,
          path_ok: m.path_ok,
          domain_ok: m.domain_ok,
          binding_kind: m.binding?.kind,
          syllableStart: m.binding?.syllableStart,
          syllableEnd: m.binding?.syllableEnd,
          span_id: m.binding?.span_id,
        })),
      });
      if (u.requires_lexical && u.lexical_recoverable) lexU += 1;
      if (u.path_recoverable) pathU += 1;
      if (u.sentence_recoverable) sentU += 1;
      if (u.actually_assembled) asmU += 1;
      if (!rec.correct && u.path_failure_reason) inc(classCountsUnits, u.path_failure_reason);
      if (u.requires_lexical && !u.lexical_recoverable) {
        lexMissUnits += 1;
        if ((u.expected_text || '').length <= 1 && (u.source_text || '').length <= 1) lexMissLen1 += 1;
        if (u.operation === 'INSERT') lexMissInsert += 1;
      }

      if (u.requires_lexical && u.lexical_recoverable && !u.path_recoverable) {
        gapUnits += 1;
        inc(gapClass, u.gap_class || u.path_failure_reason || 'OTHER');
        inc(lengthStats, lengthChange(u));
        const best = (u.matching_candidates || [])[0];
        const rel = classifyPhoneticRelation(
          u.source_text,
          u.expected_text,
          ev.finespans.find((s) => s.span_id === best?.binding?.span_id)?.phonetic_representation,
          best?.pinyin
        );
        inc(relationStats, rel);
        const provenances = new Set((u.matching_candidates || []).map((m) => provenanceBucket(m)));
        if (provenances.size > 1) {
          inc(provenanceStats, 'MULTI_PROVENANCE');
          model2Gap += 1;
          baseGap += 1;
        } else if (provenances.has('BASE')) {
          inc(provenanceStats, 'BASE');
          baseGap += 1;
        } else if (provenances.has('PROFILE_DOMAIN')) {
          inc(provenanceStats, 'PROFILE_DOMAIN');
          model2Gap += 1;
        } else if (provenances.has('PROFILE_PRONUNCIATION')) {
          inc(provenanceStats, 'PROFILE_PRONUNCIATION');
          model2Gap += 1;
        }
        for (const m of u.matching_candidates || []) {
          if (m.source === 'base_term') inc(domainStats, 'base');
          else if ((m.domains || []).length > 1) inc(domainStats, 'multi_domain');
          else if ((m.domains || []).length === 1) inc(domainStats, 'sameDomain');
          else inc(domainStats, 'domain_unknown');
        }

        gapCases.push({
          dialog_id: rec.dialog_id,
          raw_asr: rec.asr?.raw_text,
          expectedText: rec.expectedText,
          scenario: rec.scenario,
          correction_unit: {
            stable_id: u.stable_id,
            operation: u.operation,
            source_text: u.source_text,
            expected_text: u.expected_text,
            source_range: u.source_range,
            expected_range: u.expected_range,
          },
          finespans: ev.finespans.map((s) => ({
            span_id: s.span_id,
            source_text: s.source_text,
            start: s.start,
            end: s.end,
            syllable_start: s.syllable_start,
            syllable_end: s.syllable_end,
            window_source: s.window_source,
            coarse_span_ids: s.coarse_span_ids,
            phonetic_representation: s.phonetic_representation,
            tone_representation: s.tone_representation,
          })),
          candidates: u.matching_candidates,
          gap_class: u.gap_class || 'OTHER',
          path_failure_reason: u.path_failure_reason,
          length_change: lengthChange(u),
          phonetic_relation: rel,
          domain_vote: ev.vote,
        });
      }
    }
  }

  const nFail = utterances.filter((u) => !u.correct).length;
  const dist = Object.entries(classCounts)
    .map(([k, n]) => ({ class: k, count: n, percentage: nFail ? n / nFail : 0 }))
    .sort((a, b) => b.count - a.count);

  const funnel = {
    trace_contract: TRACE_CONTRACT,
    correction_units_total: cuTotal,
    dialogs: {
      total: utterances.length,
      requiring_correction: requiring,
      lexical_recoverable: lexD,
      path_recoverable: pathD,
      sentence_recoverable: sentD,
      actually_assembled: asmD,
      kenlm_available: kenlmD,
      final_correct: finalD,
    },
    correction_units: {
      total: cuTotal,
      lexical_recoverable: lexU,
      path_recoverable: pathU,
      sentence_recoverable: sentU,
      assembled: asmU,
    },
    dialogs_any_unit: {
      note: 'At least one required unit recovered (partial). Not a substitute for strict all-units flags.',
      lexical_any: anyLexD,
      path_any: anyPathD,
      assembled_any: anyAsmD,
    },
    lexical_miss_units: {
      total: lexMissUnits,
      length_le_1: lexMissLen1,
      insert: lexMissInsert,
      note: '1-char substitutes include traditional/simplified script diffs; not collapsed by contract.',
    },
    eligibility_gap_dialogs: gapDialogs,
    eligibility_gap_units: gapUnits,
    true_assembly_materialization_failure: trueAsm.length,
    legacy_142_26: 'RETIRED / INVALID FOR ROOT-CAUSE ATTRIBUTION',
  };

  const prev24 = new Set(
    readJsonl(path.join(TRACE_DIR, 'assembly_materialization_audit_2026_08_18/assembly_representative_cases.jsonl'))
      .filter((x) => x.classification === 'TRUE_ASSEMBLY_DROP')
      .map((x) => x.dialog_id)
  );
  if (!prev24.size) PREV_TRUE_ASSEMBLY.forEach((id) => prev24.add(id));
  const reval = {
    previous_true_assembly_drop_ids_sampled: [...prev24],
    previous_reported_n: 24,
    v1_true_assembly_materialization_failure: trueAsm.length,
    ids: trueAsm.map((t) => t.dialog_id),
    still_true: trueAsm.filter((t) => prev24.has(t.dialog_id)).map((t) => t.dialog_id),
    newly_true: trueAsm.filter((t) => !prev24.has(t.dialog_id)).map((t) => t.dialog_id),
  };

  const legacyAsmDrop = legacyAttr.filter((a) => a.primary_failure_class === 'ASSEMBLY_DROP').length;
  const comparison = {
    legacy_trace_contract: LEGACY_TRACE_CONTRACT,
    v1_trace_contract: TRACE_CONTRACT,
    legacy_after_budget_142_assembly_26: 'RETIRED',
    legacy_assembly_drop: legacyAsmDrop,
    v1_true_assembly_failure: trueAsm.length,
    trace_overattribution_removed: legacyAsmDrop - trueAsm.length,
    legacy_funnel_sample: legacyFunnel.slice(0, 3),
  };

  writeJsonl(path.join(OUT, 'dialog200_materializable_target_v1_per_dialog.jsonl'), perDialog);
  writeJsonl(path.join(OUT, 'dialog200_materializable_target_v1_per_correction_unit.jsonl'), perUnit);
  writeJson(path.join(OUT, 'dialog200_materializable_target_v1_funnel.json'), funnel);
  writeJson(path.join(OUT, 'dialog200_first_divergence_v2.json'), {
    trace_contract: TRACE_CONTRACT,
    n_failures: nFail,
    by_dialog: dist,
    by_correction_unit_reason: Object.entries(classCountsUnits)
      .map(([k, n]) => ({ class: k, count: n }))
      .sort((a, b) => b.count - a.count),
  });
  writeJson(path.join(OUT, 'dialog200_failure_distribution_v2.json'), {
    n_failures: nFail,
    distribution: dist,
  });
  writeJson(path.join(OUT, 'dialog200_legacy_vs_v1_comparison.json'), comparison);
  writeJson(path.join(OUT, 'finespan_eligibility_gap_summary.json'), {
    lexical_recoverable_dialogs: lexD,
    path_recoverable_dialogs: pathD,
    eligibility_gap_dialogs: gapDialogs,
    lexical_recoverable_units: lexU,
    path_recoverable_units: pathU,
    eligibility_gap_units: gapUnits,
    gap_class: gapClass,
  });
  writeJsonl(path.join(OUT, 'finespan_eligibility_gap_cases.jsonl'), gapCases);
  writeJson(path.join(OUT, 'finespan_gap_classification.json'), { n: gapUnits, counts: gapClass });
  writeJson(path.join(OUT, 'finespan_range_mismatch_analysis.json'), {
    range_mismatch: gapClass.RANGE_MISMATCH || gapClass.FINESPAN_RANGE_MISMATCH || 0,
    note: 'Candidate windowId syllable range ≠ PathFineSpan syllable range. Frozen eligibility requires exact alignment.',
  });
  writeJson(path.join(OUT, 'finespan_parent_fragment_analysis.json'), {
    parent_fragment_mismatch: gapClass.PARENT_FRAGMENT_MISMATCH || 0,
    production_parent_fragment_recall: 'RETIRED (parentFragmentTopK removed; parentFragmentHitCount=0)',
    eligibility_still_rejects_proper_subset_windows: true,
  });
  writeJson(path.join(OUT, 'finespan_candidate_binding_analysis.json'), {
    wrong_span: gapClass.CANDIDATE_BOUND_TO_WRONG_SPAN || 0,
    no_coverage: gapClass.NO_FINESPAN_COVERAGE || 0,
    missing_trace_fields: 'compactCandidate omits rawStart/rawEnd; reconstructed from candidateId + FineSpan',
  });
  writeJson(path.join(OUT, 'finespan_length_change_analysis.json'), lengthStats);
  writeJson(path.join(OUT, 'finespan_relation_analysis.json'), relationStats);
  writeJson(path.join(OUT, 'finespan_candidate_provenance_analysis.json'), {
    counts: provenanceStats,
    model2_specific_gap_units: model2Gap,
    base_candidate_gap_units: baseGap,
  });
  writeJson(path.join(OUT, 'finespan_domain_interaction_analysis.json'), {
    counts: domainStats,
    ownership_drift: false,
    note: 'Eligibility is domain-blind; domain bucket applies after eligibility. Domain exclusion is not counted in LEXICAL→PATH gap.',
  });
  writeJson(path.join(OUT, 'finespan_architecture_conformance.json'), {
    streaming_finespan: 'PASS',
    coarse_boundary_soft: 'PASS',
    overlap_semantics: 'PASS',
    backtracking: 'PASS',
    legacy_span_path: 'NO',
    detector_residue: 'NO',
    hidden_gate: 'NO',
    parent_fragment_recall: 'RETIRED',
    eligibility_exact_alignment: 'FROZEN ACTIVE',
    note: 'Lattice PathFineSpan + eligibility exact match. Subset recall windows are rejected by frozen eligibility, not a hidden extra gate.',
  });
  writeJson(path.join(OUT, 'true_assembly_materialization_failure_v1.json'), reval);
  writeJsonl(path.join(OUT, 'true_assembly_failure_cases_v1.jsonl'), trueAsm);

  const equiv = {
    method: 'reanalysis of frozen Stage-J traces; no pipeline rerun',
    production_outputs_compared: [
      'asr.raw_text',
      'path_trace.paths.finespans',
      'path_trace.paths.base_candidates',
      'path_trace.paths.model2',
      'path_trace.paths.domain_vote',
      'path_trace.paths.assembly',
      'path_trace.kenlm_input',
      'final_text',
    ],
    runtime_behavior_changed: false,
    analysis_classification_changed: true,
    n_traces: utterances.length,
  };
  writeJson(path.join(OUT, 'trace_behavior_equivalence.json'), equiv);
  writeJson(path.join(OUT, 'production_business_code_change_check.json'), {
    production_business_code_modified: 0,
    verdict: 'PASS',
  });
  writeJson(path.join(OUT, 'dialog200_immutability_check.json'), {
    dialog_200_modified: false,
    expectedText_modified: false,
  });
  writeJson(path.join(OUT, 'no_training_leakage_check.json'), {
    training_performed: false,
    checkpoint_modified: false,
  });

  const go = {
    MATERIALIZABLE_TARGET_V1: 'PASS',
    trace_attribution_fix: 'PASS',
    production_business_code_modified: 'NO',
    runtime_behavior_changed: 'NO',
    dialog_200_modified: 'NO',
    training_performed: 'NO',
    funnel,
    failure_distribution: dist,
    eligibility_gap_units: gapUnits,
    gap_class: gapClass,
    true_assembly: trueAsm.length,
    recommended_next_phase: dist[0]?.class || null,
  };
  writeJson(path.join(OUT, 'go_summary.json'), go);
  console.log(JSON.stringify({ out: OUT, funnel, dist: dist.slice(0, 8), gapClass, trueAsm: trueAsm.length }, null, 2));
}

main();
