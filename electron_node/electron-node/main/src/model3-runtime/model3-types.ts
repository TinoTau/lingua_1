/**
 * Model3 V1 mainline internal types (FW/span-assembly only).
 * Not JobResult fields. No second domain/span SSOT.
 */

/** MODEL2 = authorized PROFILE_PRONUNCIATION repair evidence (ACP Domain Authority V1). */
export type Model3AnchorSource = 'MODEL2';

export type Model3AnchorMark = {
  spanId: string;
  surface: string;
  rawStart: number;
  rawEnd: number;
  source: Model3AnchorSource;
};

export type Model3DecisionLabel = 'KEEP' | 'RETRY';

/** Exact six packed features used by Model3 forward (observation / eval SSOT). */
export type Model3PackedFeatures = {
  isAnchor: number;
  span_len_log1p: number;
  span_rel_position: number;
  first_pass_cand_log1p: number;
  current_cjk_len_log1p: number;
  pinyin_channel_avail: number;
};

/** Per-span inference-input trace — observational only; does not affect decisions. */
export type Model3InferenceInputSpanTrace = {
  spanId: string;
  surface: string;
  /** Exact surface string the host tokenized / packed (SSOT). */
  surfaceUsed?: string;
  surfaceCharLen?: number;
  rawStart: number;
  rawEnd: number;
  seqIndex: number;
  seqLen: number;
  isAnchor: boolean;
  anchorSource?: Model3AnchorSource | 'NONE';
  features: Model3PackedFeatures;
  /** Exact model-visible tensors from host forward (preferred offline replay SSOT). */
  featVector?: number[];
  availMask?: number[];
  tokenIds?: number[];
  rawFirstPassCandidateCount: number;
  rawPinyinChannelAvail: boolean;
  keepLogit?: number;
  retryLogit?: number;
  margin?: number;
  decision: Model3DecisionLabel;
  eligible: boolean;
};

export type Model3SpanDecision = {
  spanId: string;
  /** Observation-only diagnostics. */
  surface?: string;
  isAnchor?: boolean;
  decision: Model3DecisionLabel;
  keepLogit?: number;
  retryLogit?: number;
  /** retryLogit − keepLogit; diagnostics only. */
  margin?: number;
  eligible: boolean;
  /** Observation-only packed features from host forward. */
  features?: Model3PackedFeatures;
  surfaceUsed?: string;
  surfaceCharLen?: number;
  featVector?: number[];
  availMask?: number[];
  tokenIds?: number[];
  rawFirstPassCandidateCount?: number;
  rawPinyinChannelAvail?: boolean;
  seqIndex?: number;
  seqLen?: number;
  rawStart?: number;
  rawEnd?: number;
  anchorSource?: Model3AnchorSource | 'NONE';
};

export type Model3RetryAttemptTrace = {
  spanId: string;
  attempted: boolean;
  rejectedAsAnchor: boolean;
  retainedDomains: readonly string[];
  candidateCountBefore: number;
  returnedCandidateCount: number;
  mergedCandidateCount: number;
  finalPerSpanCandidateCount: number;
  latencyMs: number;
};

/** ASR postprocess retry-region diagnostics (internal FW trace). */
export type Model3RetryRegionTrace = {
  retryRegionId: string;
  sourceSpanIds: readonly string[];
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  oldLocalSpanSurfaces: readonly string[];
  newLocalSpanSurfaces: readonly string[];
  regionMergedFromAdjacentRetry: boolean;
  recallCandidatesReturned: number;
  candidateBudgetAfter: number;
  secondDomainVote: false;
  model3Reinvoked: false;
  resegmentOk: boolean;
  /**
   * Observation-only. When resegmentOk=false, Stage-2 query geometry source.
   * RETRY_REGION_LEGAL_WINDOW_SPACE = Delta2 restored SSOT (not first-pass FineSpan lock).
   */
  fallbackGeometrySource?: 'RETRY_REGION_LEGAL_WINDOW_SPACE' | 'FIRST_PASS_FINESPAN';
  /** Observation-only lattice/resegment failure code when resegmentOk=false. */
  fallbackReason?: string;
};

/** Observation-only per-invocation Retry Recall trace (MODEL2_DIALOG200_TRACE=1). */
export type Model3RetryRecallInvocationTrace = {
  retryRegionId: string;
  localSpanSource: 'LATTICE' | 'FALLBACK';
  /** Observation-only Stage-2 query geometry authority for this invocation. */
  fallbackGeometrySource?: 'RETRY_REGION_LEGAL_WINDOW_SPACE' | 'FIRST_PASS_FINESPAN';
  ownerSpanId: string;
  spanStart: number;
  spanEnd: number;
  /** Observation-only syllable geometry of this Stage2 query window (audit join). */
  syllableStart?: number;
  syllableEnd?: number;
  spanSurface: string;
  windowText: string;
  windowPinyinKey: string;
  syllables: readonly string[];
  /** Observation-only ACP V1: ASR vs preserved RecallQueryEvidence. */
  querySource?: 'ASR' | 'RECALL_QUERY_EVIDENCE';
  /** Observation-only ACP V1 mapping reason. */
  mappingReason?:
    | 'NONE'
    | 'EXACT'
    | 'SUBSPAN'
    | 'RAW_CONFLICT_REJECT'
    | 'UNSUPPORTED_GEOMETRY'
    | 'INVALID_EVIDENCE';
  acousticTonePattern?: readonly number[];
  retainedDomains: readonly string[];
  perSpanLimit: number;
  candidateCount: number;
  candidates: readonly {
    surface: string;
    source: string;
    domains: readonly string[];
    phoneticScore: number;
    candidateScore: number;
    toneCompatible?: boolean;
  }[];
};

export type Model3PathDiagnostics = {
  voteCallCount: number;
  voteFrozen: true;
  poolRefreshed: boolean;
  anchors: readonly Model3AnchorMark[];
  /** Count of PROFILE_PRONUNCIATION Anchors (source=MODEL2). */
  model2_anchor_count: number;
  anchor_mutation_violations: number;
  decisions: readonly Model3SpanDecision[];
  /** Observation-only exact Model3 inference-input SSOT for offline replay. */
  inferenceInputTrace?: readonly Model3InferenceInputSpanTrace[];
  /** Observation-only checkpoint identity at infer time. */
  checkpointIdentity?: {
    modelId: string;
    weightsSha256: string | null;
    role?: string;
  };
  retryAttempts: readonly Model3RetryAttemptTrace[];
  retryRegions: readonly Model3RetryRegionTrace[];
  /** Observation-only Retry Recall inputs/outputs (MODEL2_DIALOG200_TRACE=1). */
  retryRecallInvocations?: readonly Model3RetryRecallInvocationTrace[];
  /** Observation-only candidate provenance (MODEL3_CANDIDATE_PROVENANCE_TRACE=1). Not JobResult. */
  candidateProvenance?: unknown;
  model3LatencyMs: number;
  retryPathLatencyMs: number;
  inferenceOk: boolean;
  error?: string;
};

/**
 * Production / Electron-default identity seal (MODEL3_V2_S3_RANDOM_INIT_V1).
 * SSOT for selection remains model3-checkpoint-registry; these constants must match
 * MODEL3_PRODUCTION_IDENTITY_ID and must not drift to a second identity.
 */
export const MODEL3_EXPECTED_WEIGHTS_SHA256 =
  'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1';

/** sha256(config.json) — matches registry configHashMode config_file_sha256 for S3. */
export const MODEL3_EXPECTED_CONFIG_HASH =
  '8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221';

export const MODEL3_FEAT_NAMES = [
  'isAnchor',
  'span_len_log1p',
  'span_rel_position',
  'first_pass_cand_log1p',
  'current_cjk_len_log1p',
  'pinyin_channel_avail',
] as const;
