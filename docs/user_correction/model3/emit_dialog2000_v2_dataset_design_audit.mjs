#!/usr/bin/env node
/**
 * Emit Dialog2000 V2 Dataset Design Audit artifacts (READ_ONLY).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;

function writeCsv(file, rows) {
  if (!rows.length) return;
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

const inventory = [
  {
    asset: 'dialog_200_manifest',
    path: 'test wav/dialog_200/cases.manifest.json',
    type: 'manifest',
    purpose: '200 Piper TTS cases with reference/scenario',
    cases: 200,
    input_format: 'json cases id/text/scenario/wav',
    output_format: 'N/A',
    profile_support: 'NONE (NO_PROFILE by design)',
    audio_support: 'YES wav per case',
    asr_support: 'YES via runners',
    seed_support: 'NO',
    split_support: 'NO train/dev/holdout',
    reusable_for_v2: 'PARTIAL (template/runner/audio pattern; content is NO_PROFILE golden)',
    notes: 'restored_full_v1; single voice zh_CN-huayan-medium; no speaker/profile fields',
  },
  {
    asset: 'dialog_200_wavs',
    path: 'test wav/dialog_200/dialog_d*.wav',
    type: 'audio',
    purpose: 'Clean Piper TTS 16k mono',
    cases: 200,
    input_format: 'wav',
    output_format: 'wav',
    profile_support: 'N/A',
    audio_support: 'YES',
    asr_support: 'YES real Faster-Whisper',
    seed_support: 'NO',
    split_support: 'NO',
    reusable_for_v2: 'LOW as pronunciation corpus; HIGH as runner smoke pattern',
    notes: 'No accent/noise/elision variants',
  },
  {
    asset: 'dialog_200_restore_scripts',
    path: 'electron_node/electron-node/scripts/test-corpus/restore-dialog200-full.py',
    type: 'generator',
    purpose: 'Regenerate dialog_200 wavs via Piper :5009',
    cases: 200,
    input_format: 'experiment JSON texts',
    output_format: 'wav+manifest',
    profile_support: 'NO',
    audio_support: 'YES',
    asr_support: 'indirect',
    seed_support: 'NO',
    split_support: 'NO',
    reusable_for_v2: 'MEDIUM (Piper restore pattern)',
    notes: 'GENERATION_PROVENANCE: curated experiment JSON + Piper TTS',
  },
  {
    asset: 'dialog200_runners',
    path: 'electron_node/electron-node/tests/run-dialog200-*.mjs + run-fresh-dialog200-causal-reconciliation.mjs',
    type: 'runner',
    purpose: 'POST /run-pipeline-with-audio real ASR+postprocess batches',
    cases: 200,
    input_format: 'wavPath+session_id',
    output_format: 'jsonl/csv/json dumps',
    profile_support: 'NOT_WIRED (defaults NO_PROFILE)',
    audio_support: 'YES',
    asr_support: 'REAL_ASR_SUPPORTED',
    seed_support: 'run_id timestamps only',
    split_support: 'NO',
    reusable_for_v2: 'HIGH with extension for profile inject',
    notes: 'test-server runPipelineWithAudio has no userProfile option; SessionBootstrap not called',
  },
  {
    asset: 'normalized_baseline_evaluator',
    path: 'docs/user_correction/model3/run_asr_repair_normalized_baseline.mjs',
    type: 'evaluator',
    purpose: 'LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1',
    cases: 200,
    input_format: 'jsonl RAW/FINAL/REFERENCE',
    output_format: 'csv/json/md',
    profile_support: 'NO (text-only quality)',
    audio_support: 'NO',
    asr_support: 'offline on dumps',
    seed_support: 'N/A',
    split_support: 'NO',
    reusable_for_v2: 'HIGH for final quality; needs profile-aware metrics extension',
    notes: 'OpenCC+punct norm; offline only',
  },
  {
    asset: 'model2_dialog200_path_trace',
    path: 'electron_node/.../model2-runtime/dialog200-path-trace.ts',
    type: 'trace',
    purpose: 'MODEL2_DIALOG200_TRACE compact candidates/actions',
    cases: 'any with env=1',
    input_format: 'runtime',
    output_format: 'path_trace fields',
    profile_support: 'profileInputSummary when present',
    audio_support: 'N/A',
    asr_support: 'N/A',
    seed_support: 'N/A',
    split_support: 'N/A',
    reusable_for_v2: 'HIGH for Model2 expansion metrics',
    notes: 'REUSABLE',
  },
  {
    asset: 'piper_tts_service',
    path: 'electron_node/services/piper_tts/',
    type: 'tts',
    purpose: 'Local Chinese TTS for corpus restore',
    cases: 'N/A',
    input_format: 'text+voice',
    output_format: 'wav',
    profile_support: 'N/A',
    audio_support: 'YES',
    asr_support: 'indirect',
    seed_support: 'UNKNOWN/non-deterministic possible',
    split_support: 'N/A',
    reusable_for_v2: 'HIGH',
    notes: 'Production /tts lacks speed API; training phonemize endpoints exist',
  },
  {
    asset: 'yourtts_service',
    path: 'electron_node/services/your_tts/',
    type: 'tts',
    purpose: 'Voice clone / playback; not dialog_200 generator',
    cases: 'N/A',
    input_format: 'text+speaker embedding',
    output_format: 'audio',
    profile_support: 'N/A',
    audio_support: 'YES',
    asr_support: 'indirect',
    seed_support: 'UNKNOWN',
    split_support: 'N/A',
    reusable_for_v2: 'MEDIUM for multi-speaker; SINGLE_TTS_BIAS risk if only Piper used for V2',
    notes: 'MULTI_TTS_SUPPORT partial (second engine exists)',
  },
  {
    asset: 'pronunciation_corruptor',
    path: 'training/model2/pronunciation/corruptor.py',
    type: 'pronunciation_tool',
    purpose: 'Corrupt TTS input text then synthesize → real ASR',
    cases: 'training probes',
    input_format: 'GT text + relation',
    output_format: 'wav+asr',
    profile_support: 'paired with profile in Phase7 spikes',
    audio_support: 'YES via Piper',
    asr_support: 'YES',
    seed_support: 'YES (training scripts)',
    split_support: 'PARTIAL in training splits',
    reusable_for_v2: 'HIGH for pronunciation audio generation',
    notes: 'NOT text-only final error injection; acoustic path through ASR',
  },
  {
    asset: 'phoneme_realizer',
    path: 'training/model2/pronunciation/phoneme_realizer.py',
    type: 'pronunciation_tool',
    purpose: 'espeak cmn phoneme family substitution via Piper phonemize',
    cases: 'training',
    input_format: 'text',
    output_format: 'phoneme sequence → TTS',
    profile_support: 'N/A',
    audio_support: 'YES',
    asr_support: 'YES',
    seed_support: 'PARTIAL',
    split_support: 'N/A',
    reusable_for_v2: 'HIGH for accent/phoneme control',
    notes: 'Tone preserved in syllable_substitution; elision NOT_SUPPORTED',
  },
  {
    asset: 'acoustic_corruption_bank',
    path: 'training/model2/corruption/bank.py',
    type: 'audio_aug',
    purpose: 'noise/volume/reverb/speed',
    cases: 'training',
    input_format: 'wav',
    output_format: 'wav',
    profile_support: 'N/A',
    audio_support: 'YES',
    asr_support: 'indirect',
    seed_support: 'YES',
    split_support: 'N/A',
    reusable_for_v2: 'MEDIUM (channel effects not pronunciation family)',
    notes: 'speed 0.9/1.1; not phoneme/tone/elision',
  },
  {
    asset: 'model3_error_text_corrupt',
    path: 'training/model3_error_text/',
    type: 'text_injection',
    purpose: 'ACTIVE_SET_V1 text corruption for Model3',
    cases: 'training',
    input_format: 'text',
    output_format: 'corrupted text',
    profile_support: 'NO',
    audio_support: 'NO',
    asr_support: 'NO',
    seed_support: 'YES',
    split_support: 'YES training',
    reusable_for_v2: 'REJECT_FOR_MAIN_V2 (TEXT_ERROR_INJECTION_ONLY)',
    notes: 'unit/training only',
  },
  {
    asset: 'model2_profile_e2e_fixtures',
    path: 'electron_node/.../model2-runtime/e2e-sqlite-fixture.test.helpers.ts',
    type: 'profile_fixture',
    purpose: 'phonetic_bias ACTIVE_SET_V1 + temporary lexicon',
    cases: 'unit/e2e',
    input_format: 'UserProfileV1',
    output_format: 'fixture',
    profile_support: 'YES direct injection',
    audio_support: 'NO',
    asr_support: 'mock/span',
    seed_support: 'N/A',
    split_support: 'N/A',
    reusable_for_v2: 'HIGH for controlled profile A/B unit; not full dialog harness',
    notes: 'direct fixture injection type A',
  },
  {
    asset: 'profile_delta_writeback',
    path: 'central_server/api-gateway/src/profile_delta.rs',
    type: 'profile_generator',
    purpose: 'correction → ProfileDelta → UserProfileV1',
    cases: 'production path',
    input_format: 'ProfileDeltaV1',
    output_format: 'UserProfileV1',
    profile_support: 'YES correction-derived',
    audio_support: 'N/A',
    asr_support: 'N/A',
    seed_support: 'N/A',
    split_support: 'N/A',
    reusable_for_v2: 'HIGH for CORRECTION_DRIVEN_PROFILE_GENERATION',
    notes: 'SUPPORTED end-to-end in gateway; not wired into dialog runners',
  },
  {
    asset: 'session_bootstrap_protocol',
    path: 'central_server/shared/protocols/messages.ts + node-agent-simple.ts',
    type: 'runtime_injection',
    purpose: 'Load UserProfile into session cache for jobs',
    cases: 'production',
    input_format: 'SessionBootstrap.user_profile',
    output_format: 'ctx.userProfileV1',
    profile_support: 'YES if bootstrap called',
    audio_support: 'N/A',
    asr_support: 'N/A',
    seed_support: 'N/A',
    split_support: 'N/A',
    reusable_for_v2: 'HIGH — missing only harness wiring',
    notes: 'PER_CASE possible via distinct session_id + bootstrap',
  },
  {
    asset: 'phase7e_profile_ab_spike',
    path: 'training/model2/scripts/run_phase7e_recall_spike.py',
    type: 'offline_ab',
    purpose: 'correct/empty/wrong/swapped phonetic_bias recall spike',
    cases: 'probe set',
    input_format: 'profile variants',
    output_format: 'metrics',
    profile_support: 'YES offline',
    audio_support: 'NO',
    asr_support: 'NO (retrieval only)',
    seed_support: 'YES',
    split_support: 'PARTIAL',
    reusable_for_v2: 'MEDIUM pattern for WRONG_PROFILE controls; not full pipeline',
    notes: 'PROFILE_A_B pattern exists offline only',
  },
  {
    asset: 'model3_frozen_upstream_fork',
    path: 'model3-runtime runModel3PathStepCausalFork / decisionOverride',
    type: 'replay',
    purpose: 'Replay Model3 decisions on frozen upstream',
    cases: 'dialog audits',
    input_format: 'cached path state',
    output_format: 'decision diff',
    profile_support: 'NO',
    audio_support: 'NO',
    asr_support: 'cached upstream',
    seed_support: 'N/A',
    split_support: 'N/A',
    reusable_for_v2: 'LOW for Model2 profile (Model3-owned); pattern inspirational only',
    notes: 'Not UserProfile A/B',
  },
  {
    asset: 'active_set_v1_relations',
    path: 'electron_node/.../relation-direction.ts + training/model2_v2/runtime/active_set.py',
    type: 'ssot',
    purpose: 'Phonetic relation vocabulary for profiles',
    cases: 'N/A',
    input_format: 'relation keys',
    output_format: 'N/A',
    profile_support: 'YES phonetic_bias keys',
    audio_support: 'N/A',
    asr_support: 'N/A',
    seed_support: 'N/A',
    split_support: 'N/A',
    reusable_for_v2: 'HIGH — GENERALIZATION_CAPABLE (pattern-level)',
    notes: 'n_l z_zh ch_c sh_s eng_en in_ing h_f; tone NOT expressible',
  },
];

const capability = [
  {
    capability: 'real_audio_to_asr_to_postprocess',
    required_for_v2: 'YES',
    existing_support: 'YES',
    existing_component: 'dialog200 runners + Faster-Whisper :6007 + /run-pipeline-with-audio',
    path: 'electron_node/electron-node/tests/run-dialog200-*.mjs',
    status: 'SUPPORTED',
    reuse_candidate: 'YES',
    gap: 'NONE',
    risk: 'LOW',
    recommended_future_action: 'REUSE_AS_IS',
  },
  {
    capability: 'per_case_userprofile_injection',
    required_for_v2: 'YES',
    existing_support: 'PARTIAL',
    existing_component: 'SessionBootstrap + node-agent cache (prod); dialog harness unwired',
    path: 'node-agent-simple.ts; test-server.ts lacks userProfile body field',
    status: 'MISSING_HARNESS',
    reuse_candidate: 'YES extend harness',
    gap: 'PER_CASE_PROFILE_INJECTOR',
    risk: 'BLOCKS_PROFILE_EVAL',
    recommended_future_action: 'MINIMAL_EXTENSION',
  },
  {
    capability: 'profile_abc_replay_same_asr',
    required_for_v2: 'YES preferred',
    existing_support: 'NO',
    existing_component: 'Model3 frozen-upstream fork only; Phase7e offline A/B',
    path: 'run-model3-path-step.ts; run_phase7e_recall_spike.py',
    status: 'MISSING',
    reuse_candidate: 'PARTIAL pattern',
    gap: 'PROFILE_A_B_REPLAY_RUNNER',
    risk: 'ASR_NONDETERMINISM_CONFOUND if triple full ASR',
    recommended_future_action: 'DESIGN_MINIMAL_REPLAY',
  },
  {
    capability: 'correction_derived_profile',
    required_for_v2: 'YES preferred for e2e',
    existing_support: 'YES',
    existing_component: 'profile_delta.rs apply_profile_delta',
    path: 'central_server/api-gateway/src/profile_delta.rs',
    status: 'SUPPORTED',
    reuse_candidate: 'YES',
    gap: 'Need deterministic synthetic correction history harness',
    risk: 'LOW',
    recommended_future_action: 'REUSE + SCENARIO_GENERATOR',
  },
  {
    capability: 'direct_profile_fixture',
    required_for_v2: 'YES for unit/A-B',
    existing_support: 'YES',
    existing_component: 'model2 e2e fixtures; emptyUserProfile()',
    path: 'model2-runtime e2e helpers',
    status: 'SUPPORTED',
    reuse_candidate: 'YES',
    gap: 'P0-P3 staging naming not present (contents can express maturity)',
    risk: 'LOW',
    recommended_future_action: 'REUSE',
  },
  {
    capability: 'tts_corpus_generation',
    required_for_v2: 'YES',
    existing_support: 'YES',
    existing_component: 'Piper + restore-dialog200-full.py',
    path: 'electron_node/services/piper_tts; scripts/test-corpus/',
    status: 'SUPPORTED',
    reuse_candidate: 'YES',
    gap: 'seed/hash/dataset_id incomplete',
    risk: 'SINGLE_TTS_BIAS_RISK if only Piper',
    recommended_future_action: 'REUSE + MANIFEST_BUILDER',
  },
  {
    capability: 'multi_tts_voices',
    required_for_v2: 'PREFERRED',
    existing_support: 'PARTIAL',
    existing_component: 'Piper voices + YourTTS clone path',
    path: 'piper_tts; your_tts',
    status: 'PARTIAL',
    reuse_candidate: 'YES',
    gap: 'dialog_200 uses single voice only',
    risk: 'SINGLE_TTS_BIAS_RISK',
    recommended_future_action: 'EXTEND_PILOT_VOICES_LATER',
  },
  {
    capability: 'pronunciation_phoneme_perturbation',
    required_for_v2: 'YES',
    existing_support: 'YES training-side',
    existing_component: 'PronunciationCorruptor + PhonemeRealizer + ACTIVE_SET_V1 transforms',
    path: 'training/model2/pronunciation/',
    status: 'SUPPORTED_OFF_MAIN_CORPUS',
    reuse_candidate: 'YES',
    gap: 'Not applied to dialog_200 golden; need eval-corpus generator wrapper',
    risk: 'PRONUNCIATION_AUDIO_GENERATION_GAP if wrapper missing',
    recommended_future_action: 'REUSE_INTO_EVAL_GENERATOR',
  },
  {
    capability: 'tone_perturbation_audio',
    required_for_v2: 'DESIRED',
    existing_support: 'NO for Model2-active eval',
    existing_component: 'syllable_substitution preserves tone; tone_bias inactive Stage-J',
    path: 'syllable_substitution.py; feature audit',
    status: 'NOT_SUPPORTED_FOR_MODEL2',
    reuse_candidate: 'NO for Stage-J Model2 tone',
    gap: 'TONE_GENERALIZATION_NOT_TESTABLE_UNDER_CURRENT_ACTIVE_PROFILE_CONTRACT',
    risk: 'Do not fake via wrong-character text injection',
    recommended_future_action: 'RECORD_GAP_ONLY_NO_MODEL2_CHANGE',
  },
  {
    capability: 'elision_connected_speech',
    required_for_v2: 'DESIRED',
    existing_support: 'NO',
    existing_component: 'none found',
    path: 'N/A',
    status: 'NOT_SUPPORTED',
    reuse_candidate: 'NO',
    gap: 'ELISION_PERTURBATION',
    risk: 'unrealistic if forced via text deletion only',
    recommended_future_action: 'DEFER_BEYOND_PILOT',
  },
  {
    capability: 'speech_rate_control',
    required_for_v2: 'PARTIAL',
    existing_support: 'PARTIAL',
    existing_component: 'acoustic bank SPEED 0.9/1.1; Piper /tts no speed API',
    path: 'training/model2/corruption/bank.py',
    status: 'INDIRECTLY_POSSIBLE',
    reuse_candidate: 'YES',
    gap: 'mild rate only',
    risk: 'LOW',
    recommended_future_action: 'OPTIONAL_PILOT',
  },
  {
    capability: 'normalized_quality_evaluator',
    required_for_v2: 'YES',
    existing_support: 'YES',
    existing_component: 'run_asr_repair_normalized_baseline.mjs',
    path: 'docs/user_correction/model3/',
    status: 'SUPPORTED',
    reuse_candidate: 'YES',
    gap: 'needs dataset-agnostic I/O (not hardwired RUN_ID only)',
    risk: 'LOW',
    recommended_future_action: 'SMALL_EXTENSION',
  },
  {
    capability: 'model2_candidate_metrics',
    required_for_v2: 'YES',
    existing_support: 'PARTIAL',
    existing_component: 'MODEL2_DIALOG200_TRACE; base_candidates vs model2_union in dumps',
    path: 'dialog200-path-trace.ts; fresh jsonl',
    status: 'PARTIAL',
    reuse_candidate: 'YES',
    gap: 'PROFILE_AWARE_EVALUATOR (PROFILE_GAIN / false expansion)',
    risk: 'LOW',
    recommended_future_action: 'EXTEND_EVALUATOR',
  },
  {
    capability: 'user_lexical_holdout',
    required_for_v2: 'YES',
    existing_support: 'PARTIAL',
    existing_component: 'training splits user-disjoint; dialog_200 has none',
    path: 'training/model2/splits/assign.py',
    status: 'PARTIAL',
    reuse_candidate: 'YES for design patterns',
    gap: 'eval manifest holdout classes',
    risk: 'OVERFIT if absent',
    recommended_future_action: 'MANIFEST_HOLDUT_FIELDS',
  },
  {
    capability: 'dataset_identity_seed_manifest',
    required_for_v2: 'YES',
    existing_support: 'PARTIAL',
    existing_component: 'dialog manifest version/wavBytes; no seed/hash/build_id',
    path: 'cases.manifest.json',
    status: 'EXTENDABLE',
    reuse_candidate: 'YES schema extension',
    gap: 'DATASET_MANIFEST_BUILDER',
    risk: 'identity drift',
    recommended_future_action: 'MINIMAL_NEW_BUILDER',
  },
  {
    capability: 'anti_overfit_profile_vs_eval_terms',
    required_for_v2: 'YES',
    existing_support: 'MISSING enforce',
    existing_component: 'relation pattern SSOT supports principle; no generator enforce',
    path: 'relation-direction.ts',
    status: 'MISSING',
    reuse_candidate: 'SSOT only',
    gap: 'PROFILE_SCENARIO_GENERATOR holdout rules',
    risk: 'LEXICAL_MEMORIZATION',
    recommended_future_action: 'ENFORCE_IN_PILOT_DESIGN',
  },
  {
    capability: 'stateless_per_case_runner',
    required_for_v2: 'YES default',
    existing_support: 'YES',
    existing_component: 'dialog runners use unique session per case by default',
    path: 'inference-service runPipelineWithAudio sessionId',
    status: 'SUPPORTED',
    reuse_candidate: 'YES',
    gap: 'NONE for independence; accumulation needs explicit session reuse',
    risk: 'LOW',
    recommended_future_action: 'REUSE',
  },
  {
    capability: 'profile_accumulation_history_replay',
    required_for_v2: 'PREFERRED later',
    existing_support: 'PARTIAL',
    existing_component: 'apply_profile_delta EMA deterministic given delta sequence',
    path: 'profile_delta.rs',
    status: 'PARTIAL',
    reuse_candidate: 'YES',
    gap: 'history scenario player for P1→P3',
    risk: 'LOW',
    recommended_future_action: 'PILOT_OPTIONAL',
  },
];

const reuseMap = [
  {
    future_function: 'full_audio_asr_acceptance_runner',
    existing_asset: 'run-dialog200-*.mjs / run-fresh-dialog200-causal-reconciliation.mjs',
    reuse_percent_estimate: 'HIGH',
    reuse_as_is: 'YES core loop',
    needs_extension: 'profile bootstrap + manifest schema',
    replacement_needed: 'NO',
    reason: 'Already real Faster-Whisper + full postprocess',
  },
  {
    future_function: 'tts_wav_generation',
    existing_asset: 'Piper TTS + restore-dialog200-full.py',
    reuse_percent_estimate: 'HIGH',
    reuse_as_is: 'YES',
    needs_extension: 'multi-voice/seed metadata',
    replacement_needed: 'NO',
    reason: 'Proven corpus restore path',
  },
  {
    future_function: 'pronunciation_mechanism_audio',
    existing_asset: 'PronunciationCorruptor + PhonemeRealizer + ACTIVE_SET transforms',
    reuse_percent_estimate: 'HIGH',
    reuse_as_is: 'NO wrapper',
    needs_extension: 'eval-corpus generator composing sentence×relation×severity',
    replacement_needed: 'NO',
    reason: 'Training tools already acoustic-path capable',
  },
  {
    future_function: 'userprofile_p0_p3',
    existing_asset: 'UserProfileV1 + profile_delta + e2e fixtures',
    reuse_percent_estimate: 'HIGH',
    reuse_as_is: 'contents YES; stages NO name',
    needs_extension: 'PROFILE_SCENARIO_GENERATOR',
    replacement_needed: 'NO',
    reason: 'Contract connected; need scenario contents + holdout discipline',
  },
  {
    future_function: 'per_case_profile_injection',
    existing_asset: 'SessionBootstrap → node-agent',
    reuse_percent_estimate: 'MEDIUM',
    reuse_as_is: 'prod path YES',
    needs_extension: 'PER_CASE_PROFILE_INJECTOR in test harness',
    replacement_needed: 'NO',
    reason: 'Dialog HTTP harness never bootstraps profile',
  },
  {
    future_function: 'same_asr_profile_abc_compare',
    existing_asset: 'Phase7e offline A/B; Model3 frozen fork',
    reuse_percent_estimate: 'LOW',
    reuse_as_is: 'pattern only',
    needs_extension: 'PROFILE_A_B_REPLAY_RUNNER',
    replacement_needed: 'NO new platform',
    reason: 'No cached-ASR×profile replay today',
  },
  {
    future_function: 'normalized_cer_outcomes',
    existing_asset: 'run_asr_repair_normalized_baseline.mjs',
    reuse_percent_estimate: 'HIGH',
    reuse_as_is: 'logic YES',
    needs_extension: 'dataset-agnostic IO',
    replacement_needed: 'NO',
    reason: 'Correct quality ruler',
  },
  {
    future_function: 'model2_expansion_metrics',
    existing_asset: 'MODEL2_DIALOG200_TRACE + union dumps',
    reuse_percent_estimate: 'MEDIUM',
    reuse_as_is: 'trace YES',
    needs_extension: 'PROFILE_AWARE_EVALUATOR',
    replacement_needed: 'NO',
    reason: 'Need PROFILE_GAIN / false expansion aggregates',
  },
  {
    future_function: 'holdout_splits',
    existing_asset: 'training/model2/splits/assign.py user-disjoint',
    reuse_percent_estimate: 'MEDIUM',
    reuse_as_is: 'idea YES',
    needs_extension: 'eval manifest holdout classes',
    replacement_needed: 'NO',
    reason: 'Training split utils not eval manifest',
  },
  {
    future_function: 'text_only_error_injection_main_chain',
    existing_asset: 'training/model3_error_text',
    reuse_percent_estimate: 'NONE',
    reuse_as_is: 'NO for V2 main',
    needs_extension: 'N/A',
    replacement_needed: 'REJECT_FOR_DIALOG2000_V2 main path',
    reason: 'Bypasses acoustic ASR behavior',
  },
  {
    future_function: 'dialog_200_NO_PROFILE_golden',
    existing_asset: 'test wav/dialog_200',
    reuse_percent_estimate: 'MEDIUM',
    reuse_as_is: 'as P0 control / regression',
    needs_extension: 'not as Model2 P eval corpus',
    replacement_needed: 'NO — keep frozen golden',
    reason: 'Cannot evaluate PROFILE_REQUIRED P expansion',
  },
];

const summary = {
  PHASE: 'LINGUA_DIALOG2000_V2_DATASET_DESIGN_AUDIT',
  EXISTING_DIALOG_RUNNER_REUSABLE: true,
  REAL_AUDIO_ASR_PATH_REUSABLE: true,
  TTS_INFRASTRUCTURE_REUSABLE: true,
  MULTI_TTS_SUPPORT: 'PARTIAL',
  PRONUNCIATION_PERTURBATION_SUPPORT: 'SUPPORTED_TRAINING_SIDE',
  TONE_PERTURBATION_SUPPORT: 'NOT_SUPPORTED_FOR_ACTIVE_MODEL2',
  ELISION_PERTURBATION_SUPPORT: 'NOT_SUPPORTED',
  PROFILE_FIXTURE_SUPPORT: true,
  CORRECTION_DERIVED_PROFILE_SUPPORT: true,
  PER_CASE_PROFILE_INJECTION_SUPPORT: 'NOT_SUPPORTED_IN_DIALOG_HARNESS',
  PROFILE_A_B_REPLAY_SUPPORT: 'NOT_SUPPORTED',
  MODEL2_TRACE_SUPPORT: true,
  NORMALIZED_EVALUATOR_REUSABLE: true,
  SEED_REPRODUCIBILITY_SUPPORT: 'PARTIAL',
  DATASET_MANIFEST_SUPPORT: 'EXTENDABLE',
  USER_HOLDOUT_SUPPORT: 'PARTIAL',
  LEXICAL_HOLDOUT_SUPPORT: 'MISSING_ENFORCE',
  WRONG_PROFILE_CONTROL_SUPPORT: 'OFFLINE_ONLY',
  KNOWN_TRAIN_EVAL_LEAK: 'NO_KNOWN_LEAK_FOR_DIALOG200_GOLDEN',
  ANTI_OVERFIT_INFRASTRUCTURE_STATUS: 'PARTIAL',
  TONE_GENERALIZATION_TESTABLE: 'NO',
  RELATION_GENERALIZATION: 'GENERALIZATION_CAPABLE',
  ACTIVE_PHONETIC_RELATIONS: ['n_l', 'z_zh', 'ch_c', 'sh_s', 'eng_en', 'in_ing', 'h_f'],
  PILOT_200_FEASIBILITY: 'PILOT_200_FEASIBLE_WITH_MINIMAL_COMPONENTS',
  MINIMAL_MISSING_COMPONENTS: [
    'PER_CASE_PROFILE_INJECTOR',
    'PROFILE_SCENARIO_GENERATOR',
    'PRONUNCIATION_AUDIO_EVAL_GENERATOR_WRAPPER',
    'DATASET_MANIFEST_BUILDER',
    'PROFILE_AWARE_EVALUATOR',
    'PROFILE_A_B_REPLAY_RUNNER',
  ],
  REUSE_FIRST_COMPONENTS: [
    'dialog200_real_asr_runners',
    'piper_tts_restore_path',
    'pronunciation_corruptor_phoneme_realizer',
    'profile_delta_writeback',
    'session_bootstrap_injection_path',
    'ACTIVE_SET_V1_relation_ssot',
    'normalized_baseline_evaluator',
    'MODEL2_DIALOG200_TRACE',
  ],
  ARCHITECTURE_CHANGE_REQUIRED: false,
  ARCHITECTURE_DEPENDENCY_FOUND: false,
  ONE_NEXT_PHASE: 'LINGUA_DIALOG2000_V2_PILOT200_DESIGN',
  PRODUCTION_CODE_CHANGE: 'NONE',
  verdict: 'DIALOG2000_V2_AUDIT_PASS_MINIMAL_GAPS_FOUND',
};

const md = `# Dialog2000 V2 Dataset Design Audit

Generated: 2026-09-11  
Phase: \`LINGUA_DIALOG2000_V2_DATASET_DESIGN_AUDIT\`  
Mode: READ_ONLY / PRE-DESIGN  

## Verdict

\`DIALOG2000_V2_AUDIT_PASS_MINIMAL_GAPS_FOUND\`

\`\`\`text
PILOT_200_FEASIBILITY = PILOT_200_FEASIBLE_WITH_MINIMAL_COMPONENTS
ONE_NEXT_PHASE = LINGUA_DIALOG2000_V2_PILOT200_DESIGN
ARCHITECTURE_CHANGE_REQUIRED = NO
PRODUCTION_CODE_CHANGE = NONE
\`\`\`

## Executive answers (Q1–Q10)

| Q | Answer |
|---|--------|
| Q1 Dataset infra | dialog_200 manifest+wavs+many runners; context_prior subset; normalized evaluator; Model2 traces |
| Q2 TTS/audio | Piper (primary); YourTTS (clone); acoustic bank; restore scripts |
| Q3 Pronunciation perturb | Training-side PronunciationCorruptor/PhonemeRealizer/ACTIVE_SET transforms; **not** on dialog_200 golden |
| Q4 Profile gen/inject | fixtures + correction→ProfileDelta **SUPPORTED**; dialog harness **unwired** |
| Q5 Per-case profile | **NOT_SUPPORTED** in dialog runners (SessionBootstrap path exists in prod) |
| Q6 Real ASR | **REAL_ASR_SUPPORTED** Faster-Whisper via \`/run-pipeline-with-audio\` |
| Q7 Normalized evaluator | **REUSABLE** (extend IO) |
| Q8 Seed/manifest/split | Partial version/wavBytes; **no** seed/hash/holdout on dialog_200 |
| Q9 Leak | dialog_200 golden treated EVAL_ONLY; Model2 expand scans dialog surfaces → contamination labels exist; no production caseId branch found |
| Q10 Minimal new | Injector + scenario generator + pronunciation eval wrapper + manifest builder + profile-aware eval (+ optional A/B replay) |

## dialog_200 facts

| Field | Value |
|-------|-------|
| Cases | 200 (d001–d200) |
| Audio | Piper TTS 16k mono; voice \`zh_CN-huayan-medium\` |
| Text | curated experiment JSON (not live LLM pipeline) |
| Profile | **200/200 NO_PROFILE** (fixture/runner default; not per-case map) |
| ASR | Real Faster-Whisper |
| Runner | test-server \`runPipelineWithAudio\` — **no userProfile body field** |
| Provenance | \`restored_full_v1\` / README; **GENERATION_PROVENANCE_INCOMPLETE** for original utterance authoring prompts |

## Capability highlights

### Reuse as-is / high reuse
- Real audio→ASR→Lingua runners
- Piper restore path
- ACTIVE_SET_V1 relation SSOT (**pattern-level** → \`GENERALIZATION_CAPABLE\`)
- profile_delta correction-derived profiles
- SessionBootstrap consumption path
- Normalized baseline evaluator
- \`MODEL2_DIALOG200_TRACE\`

### Minimal gaps (Pilot blockers)
1. **PER_CASE_PROFILE_INJECTOR** — wire SessionBootstrap / session profile into dialog harness  
2. **PROFILE_SCENARIO_GENERATOR** — P0–P3 + correct/wrong/empty; enforce profile-build terms ≠ eval terms  
3. **PRONUNCIATION_AUDIO_EVAL_GENERATOR_WRAPPER** — reuse Corruptor/PhonemeRealizer for eval corpus (not text-only injection)  
4. **DATASET_MANIFEST_BUILDER** — userId, profileStage, mechanism, split, seed, generator version  
5. **PROFILE_AWARE_EVALUATOR** — PROFILE_GAIN / false expansion / useful addition  
6. **PROFILE_A_B_REPLAY_RUNNER** — preferred same-ASR×profile compare (optional if Pilot accepts 3× full ASR)

### Explicit non-reuse for V2 main path
- \`training/model3_error_text\` as primary generator → \`REJECT_FOR_DIALOG2000_V2\` (\`TEXT_ERROR_INJECTION_ONLY\`)
- dialog_200 golden as Model2 P effectiveness corpus → keep as **P0/regression only**

## TTS / perturbation matrix (summary)

| Mechanism | Status |
|-----------|--------|
| n/l, zh/z, ch/c, sh/s, eng/en, in/ing, h/f | DIRECTLY_SUPPORTED (ACTIVE_SET + corruptor/realizer) |
| an/ang etc. deferred relations | INDIRECTLY_POSSIBLE (schema) / not ACTIVE Stage-J |
| Tone shift for Model2 | **NOT_SUPPORTED** under active contract (\`TONE_GENERALIZATION_NOT_TESTABLE_UNDER_CURRENT_ACTIVE_PROFILE_CONTRACT\`) |
| Elision / connected speech | **NOT_SUPPORTED** |
| Speech rate | INDIRECTLY_POSSIBLE (acoustic bank) |
| Multi-engine | PARTIAL (Piper+YourTTS) → \`SINGLE_TTS_BIAS_RISK\` if Pilot stays Piper-only |

## Profile path

\`\`\`text
A direct fixture → Model2 e2e     = SUPPORTED (unit)
B correction → ProfileDelta → UP = SUPPORTED (gateway)
dialog harness per-case inject   = NOT_SUPPORTED today
P0–P3 by content maturity        = EXPRESSIBLE (no named stages)
WRONG_PROFILE controls           = OFFLINE_ONLY (Phase7e); not dialog harness
\`\`\`

## Risks (observed → future constraint)

| Risk | Observed | Future constraint |
|------|----------|-------------------|
| OVERFIT | dialog_200 NO_PROFILE cannot train/eval Model2 P | Profile eval must use non-empty profiles |
| TEST LEAK | No production caseId branch found | Forbid reference-driven candidate injection |
| TTS BIAS | Single Piper voice on golden | Multi-voice later; declare bias in Pilot |
| PROFILE LEAK | Hand-written bias fixtures possible | Prefer correction-derived; separate build vs eval terms |
| LEXICAL MEMORIZATION | Relation SSOT is pattern-level (good) | Enforce PROFILE BUILD TERMS ≠ EVAL TARGET TERMS |
| DOMAIN CONFOUND | scenarios bound in dialog texts | Cross-combine domain×relation in Pilot design |
| SPEAKER CONFOUND | No speaker field; one voice | Decouple speaker×profile×mechanism |

## Required report answers

| # | Answer |
|---|--------|
| A | Runners, Piper restore, NO_PROFILE golden as P0 control, evaluators, traces, relation SSOT |
| B | **YES** real audio→Faster-Whisper→postprocess |
| C | **NO** in current dialog harness; prod SessionBootstrap **YES** |
| D | **NO** cached-ASR profile A/B today; offline Phase7e only |
| E | **YES** via profile_delta |
| F | ACTIVE_SET_V1 seven families (n/l, retroflex/affricate, nasal finals, h/f) |
| G | **NO** (tone_bias inactive) |
| H | Phoneme/family **PARTIAL via training tools**; tone/elision **NO**; rate **PARTIAL** |
| I | Eval pronunciation wrapper + profile injector + scenario/manifest/eval |
| J | **YES** normalized evaluator reusable |
| K | **PARTIAL** traces; no PROFILE_GAIN aggregator |
| L | Holdout **PARTIAL/MISSING** on eval manifests |
| M | No known dialog_200 train leak; expand scripts label contamination |
| N | **YES** single-TTS bias risk |
| O | Pilot 200 **feasible with minimal components** |
| P | See MINIMAL_MISSING_COMPONENTS |
| Q | Runners, Piper, corruptor/realizer, profile_delta, bootstrap path, ACTIVE_SET, norm eval, Model2 trace |
| R | Manifest schema, harness inject, evaluator metrics |
| S | Text-only error injection as main path; dialog_200 as Model2 P yardstick |
| T | \`LINGUA_DIALOG2000_V2_PILOT200_DESIGN\` |

## Freeze / non-goals

\`\`\`text
PRODUCTION_CODE_CHANGE = NONE
MODEL2/MODEL3/LEXICON = UNCHANGED
DATASET_GENERATION = NONE this phase
\`\`\`
`;

writeCsv(path.join(OUT, 'Dialog2000_V2_Existing_Asset_Inventory.csv'), inventory);
writeCsv(path.join(OUT, 'Dialog2000_V2_Capability_Matrix.csv'), capability);
writeCsv(path.join(OUT, 'Dialog2000_V2_Reuse_Map.csv'), reuseMap);
fs.writeFileSync(
  path.join(OUT, 'Dialog2000_V2_Dataset_Design_Audit_Summary.json'),
  JSON.stringify(summary, null, 2),
  'utf8'
);
fs.writeFileSync(path.join(OUT, 'Dialog2000_V2_Dataset_Design_Audit.md'), md, 'utf8');

console.log(
  JSON.stringify(
    {
      verdict: summary.verdict,
      pilot: summary.PILOT_200_FEASIBILITY,
      next: summary.ONE_NEXT_PHASE,
      gaps: summary.MINIMAL_MISSING_COMPONENTS,
      toneTestable: summary.TONE_GENERALIZATION_TESTABLE,
    },
    null,
    2
  )
);
