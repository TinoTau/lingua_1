#!/usr/bin/env node
/**
 * Emit Model2 Integration Contract Repair Audit artifacts (READ_ONLY).
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
    '\ufeff' +
      [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n') +
      '\n',
    'utf8'
  );
}

const authorityMatrix = [
  {
    signal: 'phonetic_bias',
    historical_design_role: 'Core pronunciation relation strengths (ACTIVE_SET_V1); Stage P retrieval conditioning',
    latest_authoritative_role: 'ACTIVE Model2 input: neural profile items + P-action eligibility (bias>0 required per relation)',
    authority_source:
      'model2_v3_userprofile_feature_audit.md; Stage J Runtime Swap 2026-08-18; model2_inference_host.py P decode; model2-runtime.test.ts EMPTY profile',
    authority_status: 'ACTIVE',
    expected_producer: 'manual correction → ProfileDelta.phonetic_updates (ASCII syllable replace whitelist)',
    expected_storage: 'UserProfileV1.phonetic_bias (gateway SSOT)',
    expected_consumer: 'Model2 adapter → sidecar phonetic_bias → pack_batch_inputs + P action filter',
    expected_semantics:
      'HARD_PERMISSION_GATE for P expansion eligibility (relation must have bias>0); also soft neural conditioning when non-empty. Empty profile: Model2 still invoked but no P actions (by design).',
    current_producer: 'profile_delta.rs apply_profile_delta (CONNECTED when corrections exist)',
    current_storage: 'user_profile.rs phonetic_bias',
    current_consumer: 'finespan-adapter.ts positiveRecord(phonetic_bias) → host P gate',
    current_semantics: 'Matches HARD_PERMISSION_GATE for P; empty → NO_P_ACTION while Model2 still runs',
    alignment_status: 'ALIGNED',
    evidence:
      'StageJ swap: empty still invokes; target not introduced on empty. Test EMPTY profile still invokes ONE Model2 (no P actions).',
  },
  {
    signal: 'tone_bias',
    historical_design_role: 'Tone confusion profile; V3 set-encoder type=tone planned',
    latest_authoritative_role:
      'DEFERRED_BY_DATA (Tone HOLD) — schema retained; NOT Stage-J ACTIVE Model2 neural/P input',
    authority_source: 'model2_v3_userprofile_feature_audit.md; Stage D writeback (tone_updates ALWAYS EMPTY)',
    authority_status: 'SUPERSEDED',
    expected_producer: 'tone_updates from correction — currently always empty (no acoustic tone on correction event)',
    expected_storage: 'UserProfileV1.tone_bias',
    expected_consumer: 'Future Model2 tone path when Tone HOLD lifted — NOT current Stage-J consumer',
    expected_semantics: 'STORAGE_ONLY / DEFERRED — not required Model2 Stage-J input',
    current_producer: 'tone_updates ALWAYS EMPTY on correction path',
    current_storage: 'schema field exists',
    current_consumer: 'NONE (adapter does not read)',
    current_semantics: 'STORED-NOT-CONSUMED — expected under Tone HOLD',
    alignment_status: 'ALIGNED',
    evidence:
      'Feature audit: used=NO main path; DEFERRED_BY_DATA. Not superseded by phonetic_bias rename — separate deferred channel. DO NOT reconnect as quality Delta.',
  },
  {
    signal: 'confusion_bias',
    historical_design_role: 'Reserved confusion extension slot',
    latest_authoritative_role: 'UNUSED / DEFERRED extension — not Stage-J ACTIVE',
    authority_source: 'model2_v3_userprofile_feature_audit.md',
    authority_status: 'SUPERSEDED',
    expected_producer: 'none current',
    expected_storage: 'UserProfileV1.confusion_bias',
    expected_consumer: 'none',
    expected_semantics: 'STORAGE_ONLY / NOT_MODEL2_OWNED for Stage J',
    current_producer: 'none',
    current_storage: 'schema',
    current_consumer: 'NONE',
    current_semantics: 'STORED-NOT-CONSUMED',
    alignment_status: 'ALIGNED',
    evidence: 'Feature audit UNUSED/DEFERRED; STALE_FIELD_CANDIDATE for later cleanup only',
  },
  {
    signal: 'domain_bias',
    historical_design_role: 'Soft domain preference; NOT Lexicon SSOT',
    latest_authoritative_role:
      'STORAGE soft preference; Stage D ACTIVE input is long_term_domain_evidence NOT domain_bias',
    authority_source: 'user_profile.rs comments; StageDProfileContractV1; writeback acceptance',
    authority_status: 'SUPERSEDED',
    expected_producer: 'NOT from correction domain_updates (ALWAYS EMPTY / forbidden as lexicon write)',
    expected_storage: 'UserProfileV1.domain_bias',
    expected_consumer: 'NOT Model2 Stage D executor',
    expected_semantics: 'STORAGE_ONLY / NOT_MODEL2_OWNED for Stage-J D path',
    current_producer: 'correction does not write',
    current_storage: 'schema',
    current_consumer: 'NONE in Model2 adapter',
    current_semantics: 'STORED-NOT-CONSUMED (by design; D uses long_term_domain_evidence)',
    alignment_status: 'ALIGNED',
    evidence: 'Stage D freeze inputs list long_term_domain_evidence; domain_bias explicitly soft preference not D input',
  },
  {
    signal: 'personal_terms',
    historical_design_role: 'Personal lexicon preference list',
    latest_authoritative_role: 'ACTIVE StageDProfileContract lexical profile items',
    authority_source: 'StageDProfileContractV1; Stage D writeback acceptance; finespan-adapter.ts',
    authority_status: 'ACTIVE',
    expected_producer: 'correction → personal_term_updates after Lexicon resolve',
    expected_storage: 'UserProfileV1.personal_terms',
    expected_consumer: 'Model2 adapter personalTerms → neural profile items',
    expected_semantics: 'Lexical preference items for Model2',
    current_producer: 'profile_delta.rs with lexicon resolve',
    current_storage: 'user_profile.rs',
    current_consumer: 'finespan-adapter.ts',
    current_semantics: 'CONNECTED when profile populated',
    alignment_status: 'ALIGNED',
    evidence: 'adapter filters personal_terms; Stage J pack uses personal_terms',
  },
  {
    signal: 'personal_term_evidence',
    historical_design_role: 'Strength/evidence on personal terms',
    latest_authoritative_role: 'ACTIVE Stage D lexical evidence map',
    authority_source: 'Stage D writeback acceptance; finespan-adapter.ts personalTermEvidence',
    authority_status: 'ACTIVE',
    expected_producer: 'correction resolve EMA',
    expected_storage: 'UserProfileV1.personal_term_evidence',
    expected_consumer: 'Model2 adapter → sidecar',
    expected_semantics: 'Strength on personal lexical items',
    current_producer: 'profile_delta.rs',
    current_storage: 'user_profile.rs',
    current_consumer: 'finespan-adapter.ts positiveRecord',
    current_semantics: 'CONNECTED',
    alignment_status: 'ALIGNED',
    evidence: 'Writeback acceptance PASS; adapter reads field',
  },
  {
    signal: 'long_term_domain_evidence',
    historical_design_role: 'Training-only derivation (early audit) → later production writeback',
    latest_authoritative_role: 'ACTIVE Stage D Model2 input (StageDProfileContractV1)',
    authority_source:
      'STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1.md; Writeback Acceptance 2026-08-17 (supersedes morning NOT_READY)',
    authority_status: 'ACTIVE',
    expected_producer: 'derived from resolved terms × term_domain_tags',
    expected_storage: 'UserProfileV1.long_term_domain_evidence',
    expected_consumer: 'Model2 adapter → D executor / neural domain items',
    expected_semantics: 'Domain evidence for Stage D soft actions',
    current_producer: 'writeback derivation CONNECTED (acceptance PASS)',
    current_storage: 'user_profile.rs',
    current_consumer: 'finespan-adapter.ts longTermDomainEvidence',
    current_semantics: 'CONNECTED when profile has derived evidence',
    alignment_status: 'ALIGNED',
    evidence: 'Freeze inputs + adapter + Stage J swap pack_batch_inputs',
  },
];

const runtimeTrace = [
  {
    signal: 'phonetic_bias',
    producer: 'Scheduler features → ProfileDelta.phonetic_updates → apply_profile_delta',
    storage_field: 'UserProfileV1.phonetic_bias',
    runtime_load_site: 'SessionBootstrap.user_profile → node-agent-simple session cache → job ctx.userProfileV1',
    runtime_object_field: 'userProfile.phonetic_bias',
    adapter_read_site: 'finespan-adapter.ts buildModel2PolicyInput positiveRecord(profile.phonetic_bias)',
    sidecar_field: 'phonetic_bias (JSON infer payload)',
    model_or_executor_consumer:
      'pack_batch_inputs profile items (soft) + P ACTION_CATALOG filter requiring bias>0 (hard)',
    runtime_status: 'CONNECTED',
    first_break_location: 'NONE',
    evidence:
      'Code path complete. dialog200 RUN intentionally NO_PROFILE → field empty at load (TRANSFORMED_AS_DESIGNED / empty), not DROPPED.',
  },
  {
    signal: 'personal_terms',
    producer: 'ProfileDelta.personal_term_updates after lexicon resolve',
    storage_field: 'UserProfileV1.personal_terms',
    runtime_load_site: 'SessionBootstrap → node-agent-simple',
    runtime_object_field: 'userProfile.personal_terms',
    adapter_read_site: 'finespan-adapter.ts personalTerms filter',
    sidecar_field: 'personal_terms',
    model_or_executor_consumer: 'pack_batch_inputs lexical profile items',
    runtime_status: 'CONNECTED',
    first_break_location: 'NONE',
    evidence: 'Adapter + Stage J host consume; empty on dialog200 NO_PROFILE by design',
  },
  {
    signal: 'personal_term_evidence',
    producer: 'EMA on resolved personal terms in profile_delta.rs',
    storage_field: 'UserProfileV1.personal_term_evidence',
    runtime_load_site: 'SessionBootstrap → node-agent-simple',
    runtime_object_field: 'userProfile.personal_term_evidence',
    adapter_read_site: 'finespan-adapter.ts personalTermEvidence',
    sidecar_field: 'personal_term_evidence',
    model_or_executor_consumer: 'profile item strength / D evidence side',
    runtime_status: 'CONNECTED',
    first_break_location: 'NONE',
    evidence: 'Writeback acceptance PASS; adapter positiveRecord',
  },
  {
    signal: 'long_term_domain_evidence',
    producer: 'Derived writeback from resolved terms × domain tags',
    storage_field: 'UserProfileV1.long_term_domain_evidence',
    runtime_load_site: 'SessionBootstrap → node-agent-simple',
    runtime_object_field: 'userProfile.long_term_domain_evidence',
    adapter_read_site: 'finespan-adapter.ts longTermDomainEvidence',
    sidecar_field: 'long_term_domain_evidence',
    model_or_executor_consumer: 'Stage D domain_soft / domain_none path',
    runtime_status: 'CONNECTED',
    first_break_location: 'NONE',
    evidence: 'Stage D freeze + Stage J swap; empty on dialog200 NO_PROFILE',
  },
];

const summary = {
  PHASE: 'MODEL2_INTEGRATION_CONTRACT_REPAIR_AUDIT',
  RUN_ID,
  AUTHORITATIVE_MODEL2_CONTRACT_FOUND: true,
  AUTHORITATIVE_CONTRACT_SOURCES: [
    'docs/user_correction/STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1.md (2026-08-17)',
    'docs/user_correction/Lingua_Model2_V3_StageJ_Model_Freeze_Report_2026_08_18.md',
    'docs/user_correction/Lingua_Model2_V3_StageJ_Runtime_Checkpoint_Swap_Development_Report_2026_08_18.md',
    'docs/user_correction/FW_REPAIR_V4_POST_TRACE_FREEZE_V1.md (dialog_200 NO_PROFILE)',
    'training/model2_v3/contracts/model2_v3_userprofile_feature_audit.md',
    'central_server/api-gateway/src/user_profile.rs',
  ],
  ACTIVE_PROFILE_SIGNALS: [
    'phonetic_bias',
    'personal_terms',
    'personal_term_evidence',
    'long_term_domain_evidence',
  ],
  SUPERSEDED_PROFILE_SIGNALS: [
    'tone_bias (DEFERRED_BY_DATA / Tone HOLD — not Stage-J ACTIVE)',
    'confusion_bias (UNUSED/DEFERRED)',
    'domain_bias (soft preference storage; D uses long_term_domain_evidence)',
  ],
  UNCLEAR_PROFILE_SIGNALS: [],
  TONE_BIAS_AUTHORITY_STATUS: 'STORAGE_ONLY_NOT_MODEL2_INPUT',
  TONE_BIAS_CLASS: 'DEFERRED_BY_DATA_TONE_HOLD',
  TONE_BIAS_RECONNECT_ALLOWED: false,
  PHONETIC_BIAS_AUTHORITY_STATUS: 'ACTIVE',
  PHONETIC_BIAS_SEMANTICS: 'HARD_PERMISSION_GATE',
  PHONETIC_BIAS_SEMANTICS_DETAIL:
    'P-action decode requires phonetic_bias[relation]>0 (hard eligibility). Non-empty bias also soft-conditions neural features. Soft-prior freeze docs apply to Domain D candidate universe (never hard-filter), not to P relation eligibility.',
  COLD_START_P_EXPANSION_SEMANTICS: 'PROFILE_REQUIRED',
  COLD_START_MODEL2_INVOKE: 'ALWAYS_RUN_NO_EXTERNAL_SKIP',
  COLD_START_D_EXPANSION: 'GENERIC_ALLOWED_KNOWN_LIMITATION',
  MODEL2_SPAN_CONTRACT: 'CONNECTED_BY_CODE',
  MODEL2_SPAN_NOTE:
    'Prior summary MODEL2_INPUT_SPAN_PRESENT_COUNT=0 was misread NOT_OBSERVABLE dump stats; FineSpan→Model2 span/syllables contract is CONNECTED in code.',
  PROFILE_DERIVATION_STATUS: 'CONNECTED',
  PROFILE_STORAGE_STATUS: 'CONNECTED',
  PROFILE_RUNTIME_LOAD_STATUS: 'CONNECTED',
  MODEL2_ADAPTER_STATUS: 'CONNECTED',
  MODEL2_SIDECAR_STATUS: 'CONNECTED',
  RUN_ID_PROFILE_RECOVERABLE: true,
  RUN_ID_PROFILE_VALUE: 'NO_PROFILE',
  RUN_ID_PROFILE_RECOVERY_METHOD:
    'Authoritative Post-Trace freeze + Stage J Dialog200 acceptance: dialog_200 = 200/200 NO_PROFILE; fresh runner does not inject session UserProfile. Per-case dump lacks profile snapshot but run-level value is recoverable as empty.',
  RUNTIME_PROFILE_VALUE_NOT_RECOVERABLE: false,
  PREVIOUS_6_OF_10_FINDING_STATUS: 'NOT_CONFIRMED',
  PREVIOUS_6_OF_10_REINTERPRETATION:
    'Empty phonetic_bias / missing P expansion on dialog200 probes is EXPECTED under intentional NO_PROFILE evaluation + designed P HARD_PERMISSION_GATE — not proof of adapter wiring failure. Field EXISTS/STORED/LOADED path is intact; field was not POPULATED for that run.',
  FIRST_CONFIRMED_CONTRACT_BREAK: 'NO_CONFIRMED_BREAK',
  STALE_FIELD_CANDIDATES: ['tone_bias', 'confusion_bias', 'domain_bias'],
  MODEL2_RETRAIN_REQUIRED: 'NO',
  MODEL2_WEIGHT_CHANGE_REQUIRED: 'NO',
  LEXICON_EXPANSION_REQUIRED: 'DOES_NOT_SUGGEST_THIS_PHASE',
  MODEL3_REOPEN_REQUIRED: 'NO',
  RETRY_REOPEN_REQUIRED: 'NO',
  ONE_DELTA_CANDIDATE: 'NONE',
  ONE_NEXT_PHASE: 'MODEL2_EXPANSION_BEHAVIOR_TARGETED_AUDIT',
  ONE_NEXT_PHASE_CONSTRAINT:
    'Must use non-empty / controlled UserProfile probes (or real correction-populated profiles). Do not treat dialog200 NO_PROFILE alone as Model2 P failure. Do not reconnect tone_bias. Do not remove P hard gate without ACP.',
  PRODUCTION_CODE_CHANGE: 'NONE',
  MODEL2_CODE_CHANGE: 'NONE',
  MODEL2_WEIGHT_CHANGE: 'NONE',
  MODEL2_RETRAIN: 'NONE',
  PROFILE_SCHEMA_CHANGE: 'NONE',
  LEXICON_CHANGE: 'NONE',
  verdict: 'MODEL2_INTEGRATION_AUDIT_PASS_NO_BREAK_FOUND',
};

const md = `# Model2 Integration Contract Repair Audit

Generated: 2026-09-11  
Phase: \`MODEL2_INTEGRATION_CONTRACT_REPAIR_AUDIT\`  
Mode: READ_ONLY / CONTRACT-TRACE  
RUN_ID: \`${RUN_ID}\`

## Verdict

\`MODEL2_INTEGRATION_AUDIT_PASS_NO_BREAK_FOUND\`

\`\`\`text
FIRST_CONFIRMED_CONTRACT_BREAK = NO_CONFIRMED_BREAK
ONE_DELTA_CANDIDATE = NONE
ONE_NEXT_PHASE = MODEL2_EXPANSION_BEHAVIOR_TARGETED_AUDIT
PREVIOUS_6_OF_10 = NOT_CONFIRMED (as integration gap)
PRODUCTION_CODE_CHANGE = NONE
MODEL3 = KEEP FROZEN
RETRY = KEEP FROZEN
LEXICON = UNCHANGED
MODEL2 WEIGHTS = UNCHANGED
\`\`\`

## Authoritative contract (Q1)

Latest accepted freeze stack (2026-08-17/18):

- Model2 = FineSpan-local **user-conditioned P/D candidate expansion** (RetrievalPolicyV3 Stage-J)
- ACTIVE profile inputs: \`phonetic_bias\`, \`personal_terms\`, \`personal_term_evidence\`, \`long_term_domain_evidence\`
- \`tone_bias\` / \`confusion_bias\` / \`domain_bias\` = schema retained but **not Stage-J ACTIVE Model2 inputs**
- Empty/missing profile: **still invoke** Model2 (no external skip); P actions require \`phonetic_bias[relation]>0\`
- dialog_200 evaluation product state: **NO_PROFILE** (200/200)

Sources: Stage D Restoration Freeze; Stage J Model Freeze; Stage J Runtime Swap; Post-Trace Freeze; \`model2_v3_userprofile_feature_audit.md\`; \`user_profile.rs\`.

## Signal authority answers

| Signal | Authority | Alignment |
|--------|-----------|-----------|
| phonetic_bias | ACTIVE | ALIGNED |
| personal_terms | ACTIVE | ALIGNED |
| personal_term_evidence | ACTIVE | ALIGNED |
| long_term_domain_evidence | ACTIVE | ALIGNED |
| tone_bias | SUPERSEDED / DEFERRED Tone HOLD → STORAGE_ONLY for Stage J | ALIGNED (not connected by design) |
| confusion_bias | SUPERSEDED / UNUSED | ALIGNED |
| domain_bias | SUPERSEDED for Model2 D (D uses long_term_domain_evidence) | ALIGNED |

### tone_bias (critical)

**D — not A:** \`STORAGE_ONLY_NOT_MODEL2_INPUT\` under current Stage-J authority (\`DEFERRED_BY_DATA\` / Tone HOLD).

- Not ACTIVE_REQUIRED_BY_FROZEN_DESIGN for Stage J
- Not renamed-away by phonetic_bias (separate deferred channel)
- Correction \`tone_updates\` ALWAYS EMPTY
- **DO NOT RECONNECT** as this phase's quality Delta (\`STALE_FIELD_CANDIDATE\` only)

### phonetic_bias (critical)

**Option 2 — \`HARD_PERMISSION_GATE\`** for P expansion eligibility.

Evidence: Stage J Runtime Swap + \`model2_inference_host.py\` relation filter + runtime test *EMPTY profile still invokes ONE Model2 (no P actions)*; Correct profile introduces targets.

Soft neural conditioning also applies when bias is non-empty. Domain **soft prior** freeze (never hard-filter D universe) is a **different** layer — do not conflate with P relation gate.

Current hard gate is **implementation aligned with Stage-P/J authority**, not proven semantics drift.

### Cold start

| Layer | Semantics |
|-------|-----------|
| Model2 invoke | ALWAYS_RUN (no external empty skip) |
| P expansion | \`PROFILE_REQUIRED\` (empty bias → no P actions) |
| D expansion | GENERIC_ALLOWED (known over-expansion limitation; no empty external gate) |

## Runtime chain (Q2–Q3)

For all ACTIVE signals:

\`\`\`text
correction/writeback → UserProfile storage → SessionBootstrap load → adapter → sidecar → P/D consumer
\`\`\`

Status: **CONNECTED** end-to-end in code.

\`MODEL2_SPAN_CONTRACT = CONNECTED_BY_CODE\` (prior \`INPUT_SPAN_PRESENT_COUNT=0\` was dump observability mis-stats, not a missing FineSpan→Model2 wire).

### RUN_ID profile (Q4 evidence)

\`RUN_ID_PROFILE_RECOVERABLE = true\` → value **\`NO_PROFILE\`**.

Recovery: Post-Trace Freeze + Stage J Dialog200 acceptance (not inventing cafe profiles). Fresh dialog200 runner does not supply session UserProfile.

## Calibration of previous 6/10

\`PREVIOUS_6_OF_10_FINDING_STATUS = NOT_CONFIRMED\`

Reinterpretation:

| Layer | Fact |
|-------|------|
| EXISTS / STORED / LOADED / PASSED / CONSUMED path | Intact |
| POPULATED on dialog200 RUN | **No** (NO_PROFILE by design) |
| AFFECTS DECISION | Empty bias → P inert — **designed** |

Therefore “MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED” as **integration wiring failure** is **not confirmed**. It described empty population under NO_PROFILE eval.

## First confirmed break

\`FIRST_CONFIRMED_CONTRACT_BREAK = NO_CONFIRMED_BREAK\`

No ACTIVE authoritative signal shows DROPPED / TRANSFORMED_INCORRECTLY / NOT_CONSUMED unexpectedly.

## Required answers

| # | Answer |
|---|--------|
| A | Stage-J user-conditioned P/D expansion; StageDProfileContractV1 + phonetic_bias |
| B | phonetic_bias, personal_terms, personal_term_evidence, long_term_domain_evidence |
| C | tone_bias, confusion_bias, domain_bias (deferred/storage/not D input) |
| D | **No** — not Stage-J ACTIVE |
| E | **HARD_PERMISSION_GATE** for P (+ soft neural when present) |
| F | Invoke yes; P no until phonetic relations learned; D may still fire |
| G | Yes (phonetic/personal/domain-evidence writeback acceptance) |
| H | Yes (SessionBootstrap → node agent) |
| I | Yes (finespan-adapter) |
| J | Yes (sidecar pack + P/D executors) |
| K | tone_bias, confusion_bias, domain_bias |
| L | Yes — run-level NO_PROFILE |
| M | **NOT_CONFIRMED** as integration break |
| N | Expected empty under NO_PROFILE + P hard gate |
| O | \`NO_CONFIRMED_BREAK\` |
| P | No retrain |
| Q | Lexicon not this phase |
| R | No Model3/Retry reopen |
| S | \`MODEL2_EXPANSION_BEHAVIOR_TARGETED_AUDIT\` with **non-empty profile** probes |

## Freeze

\`\`\`text
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
LEXICON = UNCHANGED
FULL_MAINLINE = KEEP FROZEN
MODEL2 WEIGHTS = UNCHANGED
MODEL2 RETRAIN = NO
\`\`\`
`;

writeCsv(path.join(OUT, 'Model2_Profile_Signal_Authority_Matrix.csv'), authorityMatrix);
writeCsv(path.join(OUT, 'Model2_Profile_Runtime_Contract_Trace.csv'), runtimeTrace);
fs.writeFileSync(
  path.join(OUT, 'Model2_Integration_Contract_Audit_Summary.json'),
  JSON.stringify(summary, null, 2),
  'utf8'
);
fs.writeFileSync(path.join(OUT, 'Model2_Integration_Contract_Repair_Audit.md'), md, 'utf8');

console.log(
  JSON.stringify(
    {
      verdict: summary.verdict,
      firstBreak: summary.FIRST_CONFIRMED_CONTRACT_BREAK,
      previous610: summary.PREVIOUS_6_OF_10_FINDING_STATUS,
      tone: summary.TONE_BIAS_AUTHORITY_STATUS,
      phonetic: summary.PHONETIC_BIAS_SEMANTICS,
      coldStart: summary.COLD_START_P_EXPANSION_SEMANTICS,
      next: summary.ONE_NEXT_PHASE,
      delta: summary.ONE_DELTA_CANDIDATE,
    },
    null,
    2
  )
);
