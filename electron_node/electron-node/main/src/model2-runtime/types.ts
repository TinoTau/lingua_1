/**
 * Model2 runtime types — internal only (not JobResult).
 * Label: STAGE_J_RUNTIME_CHECKPOINT_SWAP
 */

import type { UserProfileV1 } from '../../../../shared/protocols/messages';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';

export type RetrievalProvenance =
  | 'BASE_FUZZY'
  | 'PROFILE_PRONUNCIATION'
  | 'PROFILE_DOMAIN'
  | 'PROFILE_RETRIEVAL';

export type Model2PolicyInput = {
  spanId: string;
  spanSyllables: string[];
  windowText: string;
  windowPinyinKey: string;
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  basePool: number;
  phoneticBias: Record<string, number>;
  personalTerms: string[];
  longTermDomainEvidence: Record<string, number>;
  personalTermEvidence: Record<string, number>;
  profileVersion?: number | null;
  sessionId?: string;
};

export type Model2DomainHit = {
  term_id: string;
  sqlite_term_id?: string | null;
  surface: string;
  pinyin_key: string;
  domain_ids: string[];
  prior_score?: number;
  term_type?: string;
};

export type Model2InferResult = {
  ok: boolean;
  model2Invoked: boolean;
  selectedActions: string[];
  queryBudget: number;
  latencyMs?: number;
  domainRetrievalMs?: number;
  error?: string;
  reason?: string;
  featurePack?: string;
  actionProbsTop?: Array<{ action_id: string; prob: number }>;
  domainAction?: string | null;
  domainNone?: boolean;
  domainHits?: Model2DomainHit[];
  domainRawN?: number;
  domainExecutorError?: string;
  sha256?: string;
  inferenceCount?: number;
  loadCount?: number;
  domainProbsTop?: Array<{ action_id: string; prob: number }>;
  nApplicable?: number;
  packedFeatureHash?: string;
  featureHash?: string;
  domainExecutor?: Record<string, unknown>;
  pFeaturePresence?: boolean;
  dFeaturePresence?: boolean;
  /** Observation-only: IPC payload Unicode scalar sanitization stats. */
  unicodeSanitize?: {
    sanitized: boolean;
    sanitized_string_count: number;
    sanitized_code_unit_count: number;
    sanitization_owner: string;
  };
};

export type Model2ExpandDiagnostics = {
  model2_invoked: boolean;
  profile_available: boolean;
  selected_actions: string[];
  query_budget: number;
  profile_queries: number;
  profile_candidate_count: number;
  introduced_term_ids: string[];
  merged_candidate_count: number;
  model_latency_ms: number;
  lexicon_latency_ms: number;
  feature_build_ms: number;
  domain_action?: string | null;
  domain_none?: boolean;
  domain_candidates_added?: number;
  pronunciation_candidates_added?: number;
  checkpoint_sha256?: string;
  load_failed?: boolean;
  inference_failed?: boolean;
  reason?: string;
  label: 'STAGE_J_RUNTIME_CHECKPOINT_SWAP';
  /** Observation-only; present iff MODEL2_DIALOG200_TRACE=1. */
  path_trace?: Record<string, unknown>;
  /**
   * Observation-only Stage-J zeroing diagnostics (no gating).
   * Always populated when expand runs past inference; does not change expansion behavior.
   */
  observability?: Model2StageJObservability;
};

/** Observation-only compact Stage-J decision/retrieval facts for Pilot diagnostics. */
export type Model2StageJObservability = {
  selected_action_count: number;
  selected_action_ids: string[];
  /** null when domain head was not reached (load/inference failure / not invoked). */
  domain_none: boolean | null;
  domain_action: string | null;
  acousticTonePattern_present: boolean;
  toneRecallReadiness: string | null;
  p_retrieval_status:
    | 'NO_P_ACTION'
    | 'P_RETRIEVAL_NOT_RUN'
    | 'P_RETRIEVAL_TONE_NOT_READY'
    | 'P_RETRIEVAL_RUN_EMPTY'
    | 'P_RETRIEVAL_RUN_HIT'
    | 'MODEL2_NOT_INVOKED'
    | 'MODEL2_INFERENCE_FAILED'
    | 'MODEL2_LOAD_FAILED';
  p_retrieval_hit_count: number;
  p_materialized_count: number;
  d_hit_count: number;
  d_materialized_count: number;
  p_added: number;
  d_added: number;
  inference_failed: boolean;
  load_failed: boolean;
  failure_reason: string | null;
  profile_unicode_sanitized: boolean;
  sanitized_string_count: number;
  sanitized_code_unit_count: number;
  sanitization_owner: string | null;
};

export type SessionUserProfileBinding = {
  userId?: string | null;
  profileVersion?: number | null;
  profile?: UserProfileV1 | null;
};

export type Model2ExpandResult = {
  candidates: WindowCandidate[];
  diagnostics: Model2ExpandDiagnostics;
};
