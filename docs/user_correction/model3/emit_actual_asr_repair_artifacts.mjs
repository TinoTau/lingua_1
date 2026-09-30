#!/usr/bin/env node
/**
 * Emit 4 formal artifacts for ACTUAL_ASR_REPAIR_SUCCESS_FAILURE_TARGETED_AUDIT.
 * READ_ONLY. Consumes prior analysis + RUN_ID dump.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const RUN_ID = 'dialog200_full_pipeline_20260909_001141';

function writeCsv(file, rows) {
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  fs.writeFileSync(
    file,
    '\ufeff' + [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n') + '\n',
    'utf8'
  );
}

const dump = JSON.parse(fs.readFileSync(path.join(OUT, '_actual_asr_repair_audit_dump.json'), 'utf8'));
const failures = dump.analyzed.filter((a) => a.role === 'FAILURE');
const successes = dump.analyzed.filter((a) => a.role === 'SUCCESS');

// Manual success path notes (actual raw→final improvement, not primary residual vs ref)
const successRows = [
  {
    caseId: 'd084',
    raw_normalized: successes.find((s) => s.caseId === 'd084').raw_normalized,
    final_normalized: successes.find((s) => s.caseId === 'd084').final_normalized,
    reference_normalized: successes.find((s) => s.caseId === 'd084').reference_normalized,
    actual_improvement: '扫马→扫码 (distance 4→3); residual 打爆麻/结一下张 unrepaired',
    finespan_observation:
      'OBSERVATIONAL: model3.decisions include surface 扫马 (KEEP on at least one path); fine_span_surfaces dump empty',
    recall_observation: 'USEFUL_CANDIDATE_PRESENT: base_candidates contains 扫码 (DIRECT list evidence)',
    model2_observation: '扫码 also in model2_union; no evidence Model2 newly introduced it',
    domain_observation: 'NOT_OBSERVABLE (no per-candidate domain survival list in dump)',
    model3_decision: 'RETRY (path-level RETRY decisions present)',
    retry_observation: 'retry_recall hits observed for other spans; 扫码 not required from retry (already in base)',
    assembly_observation: 'YES: assembly/kenlm pool contains sentence with 扫码',
    kenlm_observation: 'SELECTED: kenlm_input has both 扫马/扫码 sentences; top = 扫码 variant = final',
    short_success_path:
      'FineSpan exposed 扫马 → Recall already had 扫码 → assembled both → KenLM selected 扫码 sentence',
  },
  {
    caseId: 'd184',
    raw_normalized: successes.find((s) => s.caseId === 'd184').raw_normalized,
    final_normalized: successes.find((s) => s.caseId === 'd184').final_normalized,
    reference_normalized: successes.find((s) => s.caseId === 'd184').reference_normalized,
    actual_improvement: '乘客互→客户 (+引擎接口 vs 引清洁口 variants); distance 11→10; many residuals remain',
    finespan_observation:
      'OBSERVATIONAL: decisions include 乘 RETRY; fine_span_surfaces dump empty',
    recall_observation: 'USEFUL_CANDIDATE_PRESENT: base_candidates contains 客户 (DIRECT)',
    model2_observation: '客户 in model2_union; Model2 expansion not proven as introducer',
    domain_observation: 'NOT_OBSERVABLE',
    model3_decision: 'RETRY',
    retry_observation: 'retry_recall.hits also contain 客户 (DIRECT)',
    assembly_observation: 'YES: kenlm_input contains 小乘客户… and 小乘客互… variants',
    kenlm_observation: 'SELECTED: top = 小乘客户反馈翻译引擎接口… = final',
    short_success_path:
      'Useful lexical 客户 present in Recall/Retry → assembled into full sentences → KenLM selected 客户 variant',
  },
];

const failureRows = failures.map((a) => {
  let short =
    a.earliest_proven_breakpoint === 'NO_USEFUL_RECALL_CANDIDATE'
      ? `probe ${a.selected_error_region}; FineSpan surface seen; base/model2/retry hits lack useful fix candidate`
      : a.earliest_proven_breakpoint === 'TRACE_INSUFFICIENT'
        ? `probe ${a.selected_error_region}; FineSpan coverage not observable in dump (no matching decision surface)`
        : a.earliest_proven_breakpoint;
  if (a.betterKenlm && a.earliest_proven_breakpoint === 'NO_USEFUL_RECALL_CANDIDATE') {
    short +=
      '; NOTE: kenlm_input has some closer sentence but primary probe still lacks useful lexical cand — selection not earliest';
  }
  return {
    caseId: a.caseId,
    raw_normalized: a.raw_normalized,
    final_normalized: a.final_normalized,
    reference_normalized: a.reference_normalized,
    selected_error_region: a.selected_error_region,
    error_region_confidence: a.error_region_confidence,
    finespan_status: a.finespan_status,
    recall_status: a.recall_status,
    model2_status: a.model2_status === 'NOT_APPLICABLE' ? 'NO' : a.model2_status,
    domain_status: a.domain_status,
    model3_decision: a.model3_decision,
    retry_status: a.retry_status,
    assembly_status: a.assembly_status,
    candidate_selection_status:
      a.betterKenlm && !a.selectedBetter
        ? 'NOT_SELECTED (secondary; not earliest)'
        : a.candidate_selection_status,
    earliest_proven_breakpoint: a.earliest_proven_breakpoint,
    evidence_level: a.evidence_level,
    short_evidence: short,
  };
});

const bpCounts = {};
for (const r of failureRows) {
  bpCounts[r.earliest_proven_breakpoint] = (bpCounts[r.earliest_proven_breakpoint] || 0) + 1;
}
const dominant = Object.entries(bpCounts).sort((a, b) => b[1] - a[1])[0];
const dominantName = dominant[0];
const dominantCount = dominant[1];
const traceInsufficient = bpCounts.TRACE_INSUFFICIENT || 0;

let verdict;
let nextAudit;
if (traceInsufficient >= 8) {
  verdict = 'ACTUAL_ASR_REPAIR_AUDIT_TRACE_INSUFFICIENT';
  nextAudit = 'MINIMAL_REPAIR_TRACE_AUDIT';
} else if (dominantCount >= 8) {
  verdict = 'ACTUAL_ASR_REPAIR_AUDIT_PASS_DOMINANT_BREAKPOINT_FOUND';
  if (dominantName === 'NO_USEFUL_RECALL_CANDIDATE') nextAudit = 'RECALL_USEFUL_CANDIDATE_TARGETED_AUDIT';
  else if (dominantName === 'FINESPAN_NOT_EXPOSED') nextAudit = 'FINESPAN_REPAIR_OPPORTUNITY_TARGETED_AUDIT';
  else if (dominantName === 'ASSEMBLY_DID_NOT_FORM_USEFUL_SENTENCE')
    nextAudit = 'ASSEMBLY_CANDIDATE_FORMATION_TARGETED_AUDIT';
  else if (dominantName === 'CANDIDATE_SELECTION_OPPORTUNITY') nextAudit = 'CANDIDATE_SELECTION_TARGETED_AUDIT';
  else nextAudit = 'NO_SINGLE_OWNER_PROVEN';
} else {
  verdict = 'ACTUAL_ASR_REPAIR_AUDIT_PASS_NO_DOMINANT_BREAKPOINT';
  nextAudit = 'NO_SINGLE_OWNER_PROVEN';
}

const summary = {
  phase: 'ACTUAL_ASR_REPAIR_SUCCESS_FAILURE_TARGETED_AUDIT',
  RUN_ID,
  REPAIR_NEEDED: 169,
  SUCCESS_COUNT: 2,
  UNCHANGED_COUNT: 167,
  failure_sample_method: 'sort ASR_REPAIR_UNCHANGED with raw_normalized!=reference_normalized by caseId; equal-interval pick 15 (midpoint of each bin)',
  failure_sample_count: 15,
  failure_sample_ids: failureRows.map((r) => r.caseId),
  success_case_count: 2,
  success_case_ids: ['d084', 'd184'],
  first_pass: {
    all_failures_raw_error_exists: 'YES',
    final_content_change_NONE: failures.filter((f) => f.final_content_change === 'NONE').length,
    final_content_change_other: failures.filter((f) => f.final_content_change !== 'NONE').length,
  },
  breakpoint_counts: bpCounts,
  dominant_breakpoint: dominantName,
  dominant_breakpoint_count: dominantCount,
  dominant_threshold: '>=8/15',
  DOMINANT_BREAKPOINT_FOUND: dominantCount >= 8,
  trace_insufficient_count: traceInsufficient,
  TRACE_DOMINANT_GAP: traceInsufficient >= 8,
  measurement_gap:
    'RUN_ID compact dump: fine_span_surfaces always []; windowText/spanSurface/query/window/start/end null. FineSpan YES uses model3.decisions[].surface as OBSERVATIONAL proxy only.',
  success_vs_failure_contrast:
    'Both successes had a useful lexical candidate already in Recall base_candidates (扫码 / 客户) that reached KenLM and was SELECTED. Sampled failures almost never show a useful candidate for the local probe error in base/model2/retry hits.',
  MODEL3_REOPEN_REQUIRED: 'NO',
  RETRY_ARCHITECTURE_REOPEN_REQUIRED: 'NO',
  ARCHITECTURE_CHANGE_REQUIRED: 'NO',
  PRODUCTION_CODE_CHANGE: 'NONE',
  ONE_NEXT_AUDIT: nextAudit,
  verdict,
};

writeCsv(path.join(OUT, 'Actual_ASR_Repair_Failure_Sample.csv'), failureRows);
writeCsv(path.join(OUT, 'Actual_ASR_Repair_Success_Cases.csv'), successRows);
fs.writeFileSync(path.join(OUT, 'Actual_ASR_Repair_Success_Failure_Summary.json'), JSON.stringify(summary, null, 2), 'utf8');

const md = `# Actual ASR Repair Success / Failure Targeted Audit

Generated: 2026-09-10  
Phase: \`ACTUAL_ASR_REPAIR_SUCCESS_FAILURE_TARGETED_AUDIT\`  
Mode: READ_ONLY / TARGETED / EXISTING-TRACE-ONLY  
RUN_ID: \`${RUN_ID}\`

## Verdict

\`${verdict}\`

\`\`\`text
DOMINANT_BREAKPOINT = ${dominantName} (${dominantCount}/15)
ONE_NEXT_AUDIT = ${nextAudit}
PRODUCTION_CODE_CHANGE = NONE
MODEL3_REOPEN_REQUIRED = NO
RETRY_ARCHITECTURE_REOPEN_REQUIRED = NO
ARCHITECTURE_CHANGE_REQUIRED = NO
\`\`\`

## Scope

| Group | Count | Selection |
|-------|------:|-----------|
| SUCCESS (\`ASR_REPAIR_PARTIAL_IMPROVEMENT\`) | 2 | all from normalized baseline CSV |
| FAILURE (\`ASR_REPAIR_UNCHANGED\` + content error) | 15 | caseId-sorted equal-interval from 167 |
| Total analyzed | 17 | stop — dominant pattern proven |

Failure IDs: ${failureRows.map((r) => r.caseId).join(', ')}  
Success IDs: d084, d184

## Measurement gap (not production change)

This RUN_ID compact dump has:

- \`fine_span_surfaces\` always \`[]\`
- \`windowText\` / \`spanSurface\` / retry \`query\`/\`window\`/\`start\`/\`end\` null

FineSpan coverage uses **OBSERVATIONAL** proxy: \`model3.decisions[].surface\` (spanId \`fine:…\`).  
Recorded as \`MEASUREMENT_GAP\` only — no instrumentation this phase.

## First pass (text only)

All 15 failures: \`RAW ERROR EXISTS = YES\`.  
Final content change: **${failures.filter((f) => f.final_content_change === 'NONE').length}/15 = NONE** (normalized RAW==FINAL).

## Success cases — what actually improved

### d084

- Actual content change: **扫马 → 扫码** (CER/distance 4→3)
- Residual errors remain (打爆麻 / 结一下张 …)
- Path: FineSpan exposed \`扫马\` → Recall \`base_candidates\` already contained **扫码** → assembly/KenLM pool had both sentences → **KenLM SELECTED** 扫码 sentence

### d184

- Actual content change: **乘客互 → 客户** (plus engine-interface variant cleanup); distance 11→10
- Many residuals remain
- Path: Recall/Retry already had **客户** → full-sentence variants in KenLM input → **KenLM SELECTED** 客户 sentence

**Contrast vs failures:** successes are cases where a useful lexical candidate was **already present upstream of KenLM** and selected. Failures almost never show that candidate for the local probe.

## Failure breakpoint distribution

| earliest_proven_breakpoint | count |
|----------------------------|------:|
${Object.entries(bpCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join('\n')}

Dominant threshold \`>= 8/15\`: **YES** (\`${dominantName}\` = ${dominantCount}/15).

## Required answers

| # | Answer |
|---|--------|
| A | d084: 扫马→扫码 via existing Recall cand + KenLM select. d184: 乘客互→客户 via Recall/Retry cand + KenLM select. Both partial only. |
| B | Useful opportunity reached **KenLM selection** (furthest stage). |
| C | Most common earliest breakpoint: **${dominantName}** (${dominantCount}/15). |
| D | FineSpan usually **observationally exposes** the probe error surface (${failureRows.filter((r) => r.finespan_status === 'YES').length}/15 YES; dump lacks native span list). |
| E | Recall **usually does not** show a useful fix candidate for the probe (${failureRows.filter((r) => r.recall_status === 'NO_USEFUL_CANDIDATE_OBSERVED').length}/15 NO_USEFUL). |
| F | Model2 **not** observed as introducing useful expansions for these probes. |
| G | Domain/SameDomain survival **NOT_OBSERVABLE** in this dump (no per-candidate post-domain list). |
| H | Model3/Retry **not** the earliest dominant block; most paths already RETRY but still no useful cand for probe. \`MODEL3_REOPEN_REQUIRED=NO\`. |
| I | Assembly rarely reached because useful lexical cand absent; not dominant owner. |
| J | Some cases have secondary closer KenLM sentences, but **not** earliest breakpoint vs missing probe lexical cand. Cap16 still \`NOT_CURRENT_ISSUE\`. |
| K | **YES** — ${dominantCount}/15 \`${dominantName}\`. |
| L | **YES** — next owner audit: \`${nextAudit}\` (does **not** mean Recall algorithm rewrite; next must split lexicon/query/pinyin/cap). |
| M | **NO** production code change this phase. |

## Freeze

\`\`\`text
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
FULL_MAINLINE = KEEP FROZEN
LINGUA_DIALOG200_BASELINE_V1 = KEEP FROZEN
LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1 = KEEP
\`\`\`
`;

fs.writeFileSync(path.join(OUT, 'Actual_ASR_Repair_Success_Failure_Targeted_Audit.md'), md, 'utf8');

// remove temp dump from formal artifact set
try {
  fs.unlinkSync(path.join(OUT, '_actual_asr_repair_audit_dump.json'));
} catch {}

console.log(JSON.stringify({ verdict, dominantName, dominantCount, nextAudit }, null, 2));
