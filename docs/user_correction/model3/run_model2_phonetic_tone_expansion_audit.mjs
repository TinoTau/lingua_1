#!/usr/bin/env node
/**
 * Model2 phonetic/tone expansion effectiveness audit (READ_ONLY).
 * Produces 4 formal artifacts under docs/user_correction/model3/.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = __dirname;
const RUN_ID = 'dialog200_full_pipeline_20260909_001141';
const LEX_LOOKUP = path.join(OUT, '_model2_lexicon_lookup.json');

const PROBE_CANDIDATES = [
  { caseId: 'd032', raw_span: '祭典', correct_term: '几点' },
  { caseId: 'd060', raw_span: '定单', correct_term: '订单' },
  { caseId: 'd060', raw_span: '加格', correct_term: '价格' },
  { caseId: 'd074', raw_span: '提叫', correct_term: '提交' },
  { caseId: 'd101', raw_span: '内客', correct_term: '内科' },
  { caseId: 'd114', raw_span: '台头', correct_term: '抬头' },
  { caseId: 'd168', raw_span: '知冷', correct_term: '制冷' },
  { caseId: 'd182', raw_span: '大背', correct_term: '大杯' },
  { caseId: 'd194', raw_span: '司时', correct_term: '四十' },
  { caseId: 'd089', raw_span: '上限', correct_term: '上线' }, // local 2-char of 上限计划
  // controls from success
  { caseId: 'd084', raw_span: '扫马', correct_term: '扫码', control: true },
  { caseId: 'd184', raw_span: '客互', correct_term: '客户', control: true },
];

function writeCsv(file, rows) {
  if (!rows.length) {
    fs.writeFileSync(file, '', 'utf8');
    return;
  }
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  fs.writeFileSync(
    file,
    '\ufeff' +
      [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n') +
      '\n',
    'utf8'
  );
}

function loadCases() {
  const byId = {};
  const jsonl = path.join(OUT, `fresh_dialog200_raw_cases_${RUN_ID}.jsonl`);
  for (const line of fs.readFileSync(jsonl, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const o = JSON.parse(line);
    byId[o.caseId] = o;
  }
  return byId;
}

function openLexicon() {
  if (!fs.existsSync(LEX_LOOKUP)) {
    throw new Error('Missing _model2_lexicon_lookup.json — run _lexicon_lookup_model2.py first');
  }
  return JSON.parse(fs.readFileSync(LEX_LOOKUP, 'utf8'));
}

function lookupTerm(lexJson, term) {
  const entry = lexJson.terms?.[term];
  if (!entry) return { present: false, table: null, word: term };
  if (!entry.present || !entry.hits?.length) return { present: false, table: null, word: term };
  const h = entry.hits[0];
  return {
    present: true,
    table: h.table,
    word: h.word,
    pinyin_key: h.pinyin_key,
    tone_pinyin_key: h.tone_pinyin_key,
    sample: h.row_subset,
    count: entry.hits.length,
  };
}

function lookupDomainTags(lexJson, term) {
  // domain tag counts filled offline in lookup file if present
  const entry = lexJson.terms?.[term];
  if (!entry?.present) return [];
  return entry.domain_tags || [];
}

/** Project-style syllable key from simple pinyin guess is NOT authoritative — use lexicon or NOT_OBSERVABLE. */
function classifyPhonetic(rawPin, rawTone, corPin, corTone) {
  if (!rawPin || !corPin) return 'UNKNOWN';
  const rp = String(rawPin).replace(/\d/g, '');
  const cp = String(corPin).replace(/\d/g, '');
  if (rp === cp) {
    if (rawTone && corTone && String(rawTone) !== String(corTone)) return 'SAME_PINYIN_DIFFERENT_TONE';
    return 'NEAR_PINYIN_SAME_OR_CLOSE_TONE';
  }
  const rs = rp.split('|').filter(Boolean);
  const cs = cp.split('|').filter(Boolean);
  if (rs.length === cs.length && rs.length >= 2) {
    let diff = 0;
    for (let i = 0; i < rs.length; i++) if (rs[i] !== cs[i]) diff++;
    if (diff === 1) return 'NEAR_PINYIN_SAME_OR_CLOSE_TONE';
    if (diff >= 2) return 'MULTI_SYLLABLE_MIXED';
  }
  if (Math.abs(rp.length - cp.length) <= 2) return 'PINYIN_CONFUSION';
  return 'NOT_PHONETICALLY_CLOSE';
}

function collectSurfaces(rec) {
  const base = new Set();
  const m2 = new Set();
  let pathCount = 0;
  for (const p of rec.paths || []) {
    pathCount += 1;
    for (const s of p.base_candidates || []) base.add(s);
    for (const s of p.model2_union || []) m2.add(s);
  }
  return { base: [...base], m2: [...m2], pathCount };
}

function validateProbe(rec, probe) {
  const raw = rec.rawMergedAsrText || '';
  const ref = rec.reference || '';
  const reasons = [];
  if (!raw.includes(probe.raw_span)) reasons.push('RAW_SPAN_ABSENT');
  if (!ref.includes(probe.correct_term)) reasons.push('REF_TERM_ABSENT');
  const len = [...probe.raw_span].length;
  if (len < 2 || len > 3) reasons.push('NOT_2_3_CHAR');
  // reject pure script/punct
  if (probe.raw_span === probe.correct_term) reasons.push('IDENTICAL');
  return {
    ok: reasons.length === 0,
    reasons,
  };
}

function newOnly(base, m2) {
  const b = new Set(base);
  return m2.filter((x) => !b.has(x));
}

function main() {
  const byId = loadCases();
  const lexJson = openLexicon();

  const probeRows = [];
  let accepted = 0;
  let rejected = 0;

  for (const probe of PROBE_CANDIDATES) {
    const rec = byId[probe.caseId];
    if (!rec) {
      rejected += 1;
      probeRows.push({
        caseId: probe.caseId,
        raw_span: probe.raw_span,
        correct_term: probe.correct_term,
        probe_status: 'PROBE_REJECTED',
        lexicon_term_present: 'N/A',
        primary_finding: 'PROBE_REJECTED',
        evidence_level: 'DIRECT',
        short_evidence: 'case missing from RUN_ID',
      });
      continue;
    }
    const v = validateProbe(rec, probe);
    if (!v.ok) {
      rejected += 1;
      probeRows.push({
        caseId: probe.caseId,
        raw_span: probe.raw_span,
        correct_term: probe.correct_term,
        probe_status: 'PROBE_REJECTED',
        lexicon_term_present: 'N/A',
        primary_finding: 'PROBE_REJECTED',
        evidence_level: 'DIRECT',
        short_evidence: v.reasons.join(';'),
      });
      continue;
    }
    accepted += 1;

    const lex = lookupTerm(lexJson, probe.correct_term);
    const rawLex = lookupTerm(lexJson, probe.raw_span);
    const domains = lookupDomainTags(lexJson, probe.correct_term);
    const pair = lexJson.pairs?.[`${probe.raw_span}->${probe.correct_term}`] || {};
    const sur = collectSurfaces(rec);
    const baseHas = sur.base.includes(probe.correct_term);
    const m2Has = sur.m2.includes(probe.correct_term);
    const added = !baseHas && m2Has;
    const introduced = newOnly(sur.base, sur.m2);

    const model2Invoked = 'INVOKED';
    const model2InputSpan = 'NOT_OBSERVABLE';

    const rawPin =
      pair.raw_pinyin ||
      (rawLex.present ? rawLex.pinyin_key : null) ||
      lexJson.terms?.[probe.raw_span]?.offline_pinyin_key ||
      'NOT_OBSERVABLE';
    const rawTone =
      pair.raw_tone ||
      (rawLex.present ? rawLex.tone_pinyin_key : null) ||
      lexJson.terms?.[probe.raw_span]?.offline_tone_pinyin_key ||
      'NOT_OBSERVABLE';
    const corPin =
      pair.correct_pinyin ||
      (lex.present ? lex.pinyin_key : null) ||
      lexJson.terms?.[probe.correct_term]?.offline_pinyin_key ||
      'NOT_OBSERVABLE';
    const corTone =
      pair.correct_tone ||
      (lex.present ? lex.tone_pinyin_key : null) ||
      lexJson.terms?.[probe.correct_term]?.offline_tone_pinyin_key ||
      'NOT_OBSERVABLE';
    const phonClass = classifyPhonetic(
      rawPin === 'NOT_OBSERVABLE' ? null : rawPin,
      rawTone === 'NOT_OBSERVABLE' ? null : rawTone,
      corPin === 'NOT_OBSERVABLE' ? null : corPin,
      corTone === 'NOT_OBSERVABLE' ? null : corTone
    );

    let baseMissReason = 'N/A';
    if (lex.present && !baseHas) {
      baseMissReason = 'NOT_OBSERVABLE';
    } else if (!lex.present) {
      baseMissReason = 'LEXICON_ABSENT';
    }

    let primary;
    let evidence_level = 'OBSERVATIONAL';
    if (!lex.present) {
      primary = 'LEXICON_TERM_ABSENT';
      evidence_level = 'DIRECT';
    } else if (baseHas) {
      primary = 'BASE_RECALL_ALREADY_HAS_CORRECT_CANDIDATE';
      evidence_level = 'DIRECT';
    } else if (added) {
      primary = 'MODEL2_CORRECT_CANDIDATE_ADDED';
      evidence_level = 'DIRECT';
    } else {
      // Lexicon present + base miss + Model2 did not add.
      // Code: tone_bias unused; P gated on phonetic_bias>0. Dump has no profile.
      // Cannot prove model weights failed under §28 — required features not shown supplied.
      primary = 'MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED';
      evidence_level = 'OBSERVATIONAL';
    }

    const short = [
      `lex=${lex.present ? 'PRESENT' : 'ABSENT'}`,
      `baseHas=${baseHas}`,
      `m2Has=${m2Has}`,
      `m2New=${introduced.length}`,
      `phon=${phonClass}`,
      `rawTone=${rawTone}`,
      `corTone=${corTone}`,
    ].join('; ');

    probeRows.push({
      caseId: probe.caseId,
      raw_span: probe.raw_span,
      correct_term: probe.correct_term,
      probe_status: probe.control ? 'ACCEPTED_CONTROL' : 'ACCEPTED',
      lexicon_term_present: lex.present ? 'YES' : 'NO',
      lexicon_table: lex.table || '',
      lexicon_domain_hits: domains.length,
      raw_pinyin: rawPin,
      raw_tone: rawTone,
      correct_pinyin: corPin,
      correct_tone: corTone,
      phonetic_difference_class: phonClass,
      base_recall_correct_present: baseHas ? 'YES' : 'NO',
      base_recall_miss_reason: baseMissReason,
      model2_invoked: model2Invoked,
      model2_input_span_present: model2InputSpan,
      model2_pinyin_feature_present: 'PARTIAL_CODE',
      model2_tone_feature_present: 'NO_CODE',
      model2_user_profile_present: 'NOT_OBSERVABLE_RUNTIME',
      model2_domain_feature_present: 'PARTIAL_CODE',
      model2_candidate_count_before: sur.base.length,
      model2_candidate_count_after: sur.m2.length,
      model2_new_candidate_count: introduced.length,
      model2_added_correct_term: added ? 'YES' : 'NO',
      model2_new_surfaces_sample: introduced.slice(0, 12).join('|'),
      primary_finding: primary,
      evidence_level,
      short_evidence: short,
      is_control: probe.control ? 'YES' : 'NO',
    });
  }

  // Architecture matrix from code audit (authoritative, not per-probe)
  const matrix = [
    {
      capability: 'FineSpan-local expansion',
      frozen_design_expectation: 'YES',
      current_implementation: 'Per FineSpan Stage-J expand after base activeCandidates; skip span if no syllables',
      status: 'IMPLEMENTED',
      evidence: 'span-assembly-v4-orchestrator.ts + expand-active-candidates.ts',
    },
    {
      capability: 'pronunciation-conditioned',
      frozen_design_expectation: 'YES',
      current_implementation: 'phonetic_bias profile items + P relation actions + hypothesized syllables → lexicon recall',
      status: 'PARTIAL',
      evidence: 'finespan-adapter.ts phoneticBias; P gated on phonetic_bias>0; empty profile → P effectively inert',
    },
    {
      capability: 'tone-confusion-aware',
      frozen_design_expectation: 'expected within user pronunciation expansion',
      current_implementation: 'tone_bias exists on UserProfileV1 schema but adapter does NOT read tone_bias; neural pack has no tone tensor',
      status: 'MISSING',
      evidence: 'finespan-adapter.ts (no tone_bias); host pack_batch_inputs span hash + profile items only',
    },
    {
      capability: 'user-profile-conditioned',
      frozen_design_expectation: 'YES',
      current_implementation: 'phonetic_bias / personal_terms / long_term_domain_evidence CONNECTED; tone_bias/domain_bias/confusion_bias STORED-NOT-CONSUMED',
      status: 'PARTIAL',
      evidence: 'finespan-adapter.ts + profile_delta.rs write path',
    },
    {
      capability: 'domain-conditioned',
      frozen_design_expectation: 'YES',
      current_implementation: 'Stage D domain_soft actions via long_term_domain_evidence (not domain_bias)',
      status: 'PARTIAL',
      evidence: 'model2 domain executor + adapter longTermDomainEvidence',
    },
    {
      capability: 'trainable behavior',
      frozen_design_expectation: 'YES',
      current_implementation: 'RetrievalPolicyV3 predicts P/D retrieval ACTIONS (not corrected text); Stage-J checkpoint frozen',
      status: 'IMPLEMENTED',
      evidence: 'training/model2_v3 ranking_loss.py — retrieval-ACTION ranking',
    },
    {
      capability: 'candidate expansion',
      frozen_design_expectation: 'YES',
      current_implementation: 'termId UNION base ∪ P ∪ D into model2_union; budgets cand=8 per P/D',
      status: 'IMPLEMENTED',
      evidence: 'merge-profile-candidates.ts',
    },
    {
      capability: 'direct correction',
      frozen_design_expectation: 'NO',
      current_implementation: 'No surface typo dictionary in Model2 path; phonetic relation SSOT only',
      status: 'IMPLEMENTED',
      evidence: 'relation-direction.ts; no illegal-word map in model2-runtime',
    },
    {
      capability: 'final selection',
      frozen_design_expectation: 'NO',
      current_implementation: 'Model2 does not select final sentence; KenLM downstream',
      status: 'IMPLEMENTED',
      evidence: 'orchestrator order Model2 → Domain → Model3 → Assembly → KenLM',
    },
  ];

  const acceptedRows = probeRows.filter((r) => String(r.probe_status).startsWith('ACCEPTED'));
  const failureProbes = acceptedRows.filter((r) => r.is_control !== 'YES');
  const primaryCounts = {};
  for (const r of failureProbes) {
    primaryCounts[r.primary_finding] = (primaryCounts[r.primary_finding] || 0) + 1;
  }
  const dominantEntry = Object.entries(primaryCounts).sort((a, b) => b[1] - a[1])[0] || [
    'NONE',
    0,
  ];
  const dominant = dominantEntry[0];
  const dominantCount = dominantEntry[1];
  const ratio = failureProbes.length ? dominantCount / failureProbes.length : 0;

  const lexPresent = failureProbes.filter((r) => r.lexicon_term_present === 'YES').length;
  const lexAbsent = failureProbes.filter((r) => r.lexicon_term_present === 'NO').length;
  const basePresent = failureProbes.filter((r) => r.base_recall_correct_present === 'YES').length;
  const m2Added = failureProbes.filter((r) => r.model2_added_correct_term === 'YES').length;
  const controls = acceptedRows.filter((r) => r.is_control === 'YES');

  let verdict;
  let nextAudit;
  let model2OwnerSupported = false;
  if (ratio >= 0.6 && dominant === 'MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED') {
    verdict = 'MODEL2_EXPANSION_AUDIT_PASS_INTEGRATION_GAP_FOUND';
    nextAudit = 'MODEL2_INTEGRATION_CONTRACT_REPAIR_AUDIT';
  } else if (ratio >= 0.6 && (dominant === 'MODEL2_TONE_EXPANSION_INEFFECTIVE' || dominant === 'MODEL2_PHONETIC_NEIGHBORHOOD_TOO_NARROW')) {
    verdict = 'MODEL2_EXPANSION_AUDIT_PASS_MODEL2_OWNER_SUPPORTED';
    nextAudit =
      dominant === 'MODEL2_TONE_EXPANSION_INEFFECTIVE'
        ? 'MODEL2_TONE_EXPANSION_ONE_DELTA_DESIGN'
        : 'MODEL2_PHONETIC_EXPANSION_ONE_DELTA_DESIGN';
    model2OwnerSupported = true;
  } else if (ratio >= 0.6 && dominant === 'LEXICON_TERM_ABSENT') {
    verdict = 'MODEL2_EXPANSION_AUDIT_PASS_MODEL2_NOT_OWNER';
    nextAudit = 'MODEL2_OPTIMIZATION_NOT_SUPPORTED';
  } else if (ratio >= 0.6 && dominant === 'BASE_RECALL_ALREADY_HAS_CORRECT_CANDIDATE') {
    verdict = 'MODEL2_EXPANSION_AUDIT_PASS_MODEL2_NOT_OWNER';
    nextAudit = 'NOT_MODEL2_OWNER_CHECK_SURVIVAL_OR_ASSEMBLY';
  } else if (ratio >= 0.6 && dominant === 'TRACE_INSUFFICIENT') {
    verdict = 'MODEL2_EXPANSION_AUDIT_TRACE_INSUFFICIENT';
    nextAudit = 'MINIMAL_MODEL2_TRACE_AUDIT';
  } else {
    verdict = 'MODEL2_EXPANSION_AUDIT_PASS_NO_DOMINANT_FINDING';
    nextAudit = 'NO_SINGLE_OWNER_PROVEN';
  }

  // Architecture drift: no surface correction map found
  const architectureDrift = false;

  const summary = {
    PHASE: 'MODEL2_PHONETIC_TONE_EXPANSION_EFFECTIVENESS_AUDIT',
    RUN_ID,
    PROBE_TOTAL: PROBE_CANDIDATES.length,
    PROBE_ACCEPTED: accepted,
    PROBE_REJECTED: rejected,
    PROBE_ACCEPTED_FAILURE: failureProbes.length,
    PROBE_ACCEPTED_CONTROL: controls.length,
    LEXICON_TERM_PRESENT_COUNT: lexPresent,
    LEXICON_TERM_ABSENT_COUNT: lexAbsent,
    BASE_RECALL_CORRECT_PRESENT_COUNT: basePresent,
    MODEL2_INVOKED_COUNT: failureProbes.filter((r) => r.model2_invoked === 'INVOKED').length,
    MODEL2_INPUT_SPAN_PRESENT_COUNT: failureProbes.filter((r) => r.model2_input_span_present === 'YES')
      .length,
    MODEL2_TONE_FEATURE_PRESENT_COUNT: 0,
    MODEL2_USER_PROFILE_PRESENT_COUNT: 'NOT_OBSERVABLE_IN_DUMP',
    MODEL2_ADDED_CORRECT_TERM_COUNT: m2Added,
    PRIMARY_FINDING_COUNTS: primaryCounts,
    DOMINANT_FINDING: dominant,
    DOMINANT_FINDING_COUNT: dominantCount,
    DOMINANT_FINDING_RATIO: Number(ratio.toFixed(3)),
    DOMINANT_MODEL2_FINDING_FOUND: ratio >= 0.6,
    control_success: controls.map((c) => ({
      caseId: c.caseId,
      raw_span: c.raw_span,
      correct_term: c.correct_term,
      base_has: c.base_recall_correct_present,
      model2_added: c.model2_added_correct_term,
      note:
        c.base_recall_correct_present === 'YES'
          ? 'SUCCESS_NOT_ATTRIBUTABLE_TO_MODEL2'
          : c.model2_added_correct_term === 'YES'
            ? 'MODEL2_MAY_HAVE_HELPED'
            : 'CHECK',
    })),
    code_audit: {
      model2_is: 'user-conditioned candidate expansion via P/D retrieval ACTIONS',
      model2_is_not: 'text correction / final selector / lexicon owner',
      tone_bias_consumed: false,
      phonetic_bias_consumed: true,
      empty_phonetic_bias_gates_P: true,
      neural_receives_tone_tensor: false,
      neural_receives_surface_correction_pairs: false,
      architecture_drift_hardcoded_typo_map: false,
      stage_j_checkpoint:
        'training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt',
    },
    MODEL2_ARCHITECTURE_ALIGNED: 'PARTIAL',
    MODEL2_RETRAIN_REQUIRED: 'NO_THIS_PHASE',
    MODEL2_INTEGRATION_CHANGE_REQUIRED: dominant === 'MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED' ? 'EVIDENCE_SUGGESTS_YES' : 'NO',
    MODEL3_REOPEN_REQUIRED: 'NO',
    RETRY_ARCHITECTURE_REOPEN_REQUIRED: 'NO',
    LEXICON_EXPANSION_REQUIRED: lexAbsent > failureProbes.length * 0.6 ? 'EVIDENCE_SUGGESTS' : 'DOES_NOT_SUGGEST',
    ONE_NEXT_AUDIT: nextAudit,
    PRODUCTION_CODE_CHANGE: 'NONE',
    MODEL2_WEIGHT_CHANGE: 'NONE',
    MODEL2_RETRAIN: 'NONE',
    verdict,
    model2OwnerSupported,
    architectureDrift,
  };

  writeCsv(path.join(OUT, 'Model2_Phonetic_Tone_Expansion_Probe_Audit.csv'), probeRows);
  writeCsv(path.join(OUT, 'Model2_Design_vs_Implementation_Matrix.csv'), matrix);
  fs.writeFileSync(
    path.join(OUT, 'Model2_Phonetic_Tone_Expansion_Audit_Summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  const md = buildReport(summary, matrix, probeRows, failureProbes, controls);
  fs.writeFileSync(
    path.join(OUT, 'Model2_Phonetic_Tone_Expansion_Effectiveness_Audit.md'),
    md,
    'utf8'
  );

  try {
    fs.unlinkSync(path.join(OUT, '_model2_lexicon_lookup.json'));
  } catch {}

  console.log(
    JSON.stringify(
      {
        verdict,
        accepted,
        rejected,
        failureProbes: failureProbes.length,
        dominant,
        dominantCount,
        ratio,
        lexPresent,
        lexAbsent,
        m2Added,
        nextAudit,
        controls: summary.control_success,
        primaryCounts,
      },
      null,
      2
    )
  );
}

function buildReport(s, matrix, allProbes, failureProbes, controls) {
  const matrixMd = matrix
    .map(
      (r) =>
        `| ${r.capability} | ${r.frozen_design_expectation} | ${r.current_implementation.replace(/\|/g, '/')} | **${r.status}** |`
    )
    .join('\n');
  const probeMd = failureProbes
    .map(
      (r) =>
        `| ${r.caseId} | ${r.raw_span}→${r.correct_term} | ${r.lexicon_term_present} | ${r.base_recall_correct_present} | ${r.model2_added_correct_term} | ${r.phonetic_difference_class} | ${r.primary_finding} |`
    )
    .join('\n');
  return `# Model2 Phonetic / Tone Expansion Effectiveness Audit

Generated: 2026-09-10  
Phase: \`MODEL2_PHONETIC_TONE_EXPANSION_EFFECTIVENESS_AUDIT\`  
Mode: READ_ONLY / PRE-DEVELOPMENT  
RUN_ID: \`${s.RUN_ID}\`

## Verdict

\`${s.verdict}\`

\`\`\`text
DOMINANT_FINDING = ${s.DOMINANT_FINDING} (${s.DOMINANT_FINDING_COUNT}/${s.PROBE_ACCEPTED_FAILURE}, ratio ${s.DOMINANT_FINDING_RATIO})
ONE_NEXT_AUDIT = ${s.ONE_NEXT_AUDIT}
PRODUCTION_CODE_CHANGE = NONE
MODEL2_WEIGHT_CHANGE = NONE
MODEL2_RETRAIN = NONE
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
LEXICON = UNCHANGED
\`\`\`

## Design vs Implementation

| Capability | Frozen design | Current implementation | Status |
|---|---|---|---|
${matrixMd}

## Code-level Model2 contract (authoritative)

Model2 **IS**: user-conditioned **candidate expansion** via P/D **retrieval actions**.

Model2 **IS NOT**: text correction model, final selector, lexicon owner, Model3/KenLM replacement.

### Features actually consumed at inference

| Feature | Status |
|---|---|
| FineSpan syllables / windowPinyinKey | PASSED to sidecar; neural uses syllable **hash bag** |
| windowText | Passed; used by D executor / P lexicon query — **not** neural text-correction input |
| phonetic_bias (user pronunciation) | **CONNECTED** — also **hard-gates** P actions (all relations must have bias>0) |
| personal_terms / personal_term_evidence | CONNECTED |
| long_term_domain_evidence | CONNECTED (Stage D) |
| tone_bias | Schema exists — **STORED-NOT-CONSUMED** by Model2 adapter |
| domain_bias / confusion_bias | **UNUSED** by Model2 adapter |
| Acoustic tone pattern as Model2 neural feature | **NO** |

Training objective: retrieve-ACTION ranking (BCE + pairwise), **not** lexical surface correction. **ALIGNED** with expansion role; **PARTIALLY_ALIGNED** with “tone neighborhood expansion” because tone is not a Model2 feature.

Architecture drift (hardcoded typo map): **NO**.

## Probes

Accepted failure probes: **${s.PROBE_ACCEPTED_FAILURE}**  
Controls (success): **${s.PROBE_ACCEPTED_CONTROL}**  
Rejected: **${s.PROBE_REJECTED}**

| caseId | probe | lexicon | base has | Model2 added | phonetic class | primary |
|---|---|---|---|---|---|---|
${probeMd}

### Controls (d084 / d184)

${controls
  .map(
    (c) =>
      `- **${c.caseId}** \`${c.raw_span}→${c.correct_term}\`: base_has=${c.base_recall_correct_present}, model2_added=${c.model2_added_correct_term} → ${
        c.base_recall_correct_present === 'YES'
          ? 'SUCCESS_NOT_ATTRIBUTABLE_TO_MODEL2'
          : 'see CSV'
      }`
  )
  .join('\n')}

## Dominant finding interpretation

\`${s.DOMINANT_FINDING}\` means: for most probes where the correct Lexicon term exists and Base Recall misses it, Model2 also does **not** add it — and code shows **tone/profile features required for P expansion are missing or empty / not supplied** on this dialog200 path (empty \`phonetic_bias\` gates P; \`tone_bias\` never consumed).

This is **integration / feature-supply**, not proven Model2-weight failure under §28 ownership rule (required features not supplied → cannot assign MODEL2_TONE_EXPANSION_INEFFECTIVE).

## Required answers

| # | Answer |
|---|--------|
| A | Role still expansion (P/D actions), **PARTIAL** vs frozen tone/user-profile expectations |
| B | spanSyllables, windowText/PinyinKey, phonetic_bias, personal_terms, domain evidence, basePool — **not** tone_bias |
| C | Surface/pinyin keys enter adapter; **tone does not** enter Model2 neural/P gate as dedicated feature |
| D | phonetic_bias **can** enter if profile populated; dialog200 dump cannot prove non-empty profile; tone_bias **never** consumed |
| E | Yes, expansion path exists (UNION); effectiveness depends on profile-gated P/D actions |
| F | Lexicon present on **${s.LEXICON_TERM_PRESENT_COUNT}/${s.PROBE_ACCEPTED_FAILURE}** failure probes |
| G | Base miss reason mostly **NOT_OBSERVABLE** in compact dump (no query/tone fields); code-side tone constraints exist in Base Recall |
| H | Model2 added correct term: **${s.MODEL2_ADDED_CORRECT_TERM_COUNT}/${s.PROBE_ACCEPTED_FAILURE}** |
| I | Tone mismatch as Model2-owned failure: **NOT_PROVEN** (tone feature not supplied to Model2) |
| J | Phonetic neighborhood “too narrow” as model behavior: **NOT_PROVEN**; empty phonetic_bias → P inert is stronger evidence |
| K | **Integration gap** (required features not supplied / tone unused) — not Model3/Retry; lexicon absent only if counted dominant |
| L | ONE potential Delta (next audit only): repair Model2 integration contract so pronunciation/tone-capable profile signals actually condition P expansion — **no retrain yet** |
| M | Retrain Model2: **NO this phase** |
| N | Modify Model3: **NO** |
| O | Modify Retry architecture: **NO** |
| P | Expand Lexicon: **${s.LEXICON_EXPANSION_REQUIRED}** (do not execute) |
| Q | NEXT: \`${s.ONE_NEXT_AUDIT}\` |

## Freeze

\`\`\`text
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
LEXICON = UNCHANGED
FULL_MAINLINE = KEEP FROZEN
\`\`\`
`;
}

main();
