/**
 * Model3 V1 mainline path step — vote once → anchors → infer → retry → assemble.
 * Vote FROZEN; pool REFRESHABLE after RETRY mutation.
 *
 * TESTABILITY REFACTOR (MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION):
 * - prepareModel3PathUpstream: Domain Vote + Anchors + pack/infer (once)
 * - completeModel3PathFromUpstream: decisions → Retry → Assembly (same production impl)
 * - runModel3PathStepCausalFork: one upstream → BASELINE KEEP + S3 actionable
 * Behavior of production runModel3PathStep remains semantically identical when
 * acceptance fork is off.
 */

import {
  buildFineSpanCandidatePool,
  completeDomainAwareAssemblyFromVote,
} from '../fw-detector/span-assembly-v4/assemble-domain-aware-span-sets';
import type { DomainAwareAssemblyResult } from '../fw-detector/span-assembly-v4/domain-assembly-types';
import type { FineSpanCandidatePool } from '../fw-detector/span-assembly-v4/domain-assembly-types';
import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { CoarseSpan } from '../fw-detector/span-assembly-shared/types';
import type { PinyinImeV2Dict, PinyinImeV2RuntimeConfig } from '../fw-detector/pinyin-ime-v2/pinyin-ime-v2-types';
import { voteUtteranceDomainFromPool } from '../fw-detector/span-assembly-shared/utterance-domain-vote';
import type { AcousticToneSlice, WordTimeSpan } from '../fw-detector/tone-time-align';
import type { DomainPrior } from '../fw-detector/domain-context-contract';
import type { LexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2';
import { RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY } from '../lexicon-v2/recall-semantic-mode';
import { recallSpanTopKV2 } from '../lexicon-v2/recall-span-topk-v2';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { materializeModel3Anchors, anchorSpanIdSet } from './model3-anchor-adapter';
import { packModel3SpanInferFields } from './model3-feature-pack';
import { getActiveModel3Identity, getModel3InferenceHost } from './model3-inference-client';
import { getModel3CheckpointIdentity } from './model3-checkpoint-registry';
import { buildModel3PathDiagnostics } from './model3-path-diagnostics';
import {
  captureV2Boundary,
  isFrozenEvidenceCaptureV2Enabled,
} from '../capture-v2';
import { routeModel3Retry } from './model3-retry-router';
import { resegmentRetryRegionWithLattice } from './model3-retry-region-resegment';
import {
  isCandidateProvenanceTraceEnabled,
  recordPreAssembly,
  recordAssemblyInputSelected,
  takePathProvenance,
} from './model3-candidate-provenance-trace';
import {
  buildAcceptanceHashPayload,
  cloneActiveCandidates,
  clonePathFineSpans,
  hashAcceptanceUpstream,
  hashPackedOnly,
  keepOverrideFromPacked,
  type Model3AcceptanceUpstreamHashPayload,
} from './model3-acceptance-snapshot';
import type {
  Model3InferenceInputSpanTrace,
  Model3PathDiagnostics,
  Model3SpanDecision,
  Model3AnchorMark,
  Model3AnchorSource,
} from './model3-types';
import type { RecallQueryEvidence } from '../lexicon-v2/recall-query-evidence';

export type RunModel3PathStepResult = {
  assemblyResult: DomainAwareAssemblyResult;
  activeCandidates: WindowCandidate[];
  diagnostics: Model3PathDiagnostics;
  voteCallCount: number;
};

export type Model3PathStepArgs = {
  activeCandidates: WindowCandidate[];
  coarseSpans: CoarseSpan[];
  rawText: string;
  pathFineSpans: readonly PathFineSpan[];
  domainPriors?: readonly DomainPrior[];
  globalSyllables: readonly string[];
  runtime: LexiconRuntimeV2;
  profile: ActiveLexiconProfileSnapshot;
  /** Test hook: force decisions without sidecar (not a business flag). */
  decisionOverride?: readonly Model3SpanDecision[];
  /** Test hook: force Model3 load/infer failure. */
  forceFail?: boolean;
  /**
   * Test hook: KEEP every span.
   * Unit tests without host may skip sidecar; acceptance causal fork always packs first.
   */
  keepAll?: boolean;
  /** Optional lattice deps for retry-region re-segmentation (production orchestrator). */
  imeConfig?: PinyinImeV2RuntimeConfig;
  dict?: PinyinImeV2Dict;
  minPrior?: number;
  acousticSlices?: readonly AcousticToneSlice[];
  wordTimeSpans?: readonly WordTimeSpan[];
  fuzzyRecallEnabled?: boolean;
  toneTimestampOnlyEnabled?: boolean;
  /** Observation / hash path id (acceptance only). */
  pathId?: string;
  /**
   * Acceptance only: always pack via host even when keepAll/override is set.
   * Ensures baselinePackedHash == s3PackedHash.
   */
  forcePackSymmetry?: boolean;
  /**
   * Utterance-local RecallQueryEvidence (ACP V1). Runtime routing context only —
   * NOT Model3 model input / features.
   */
  recallQueryEvidence?: readonly RecallQueryEvidence[];
};

export type Model3PathUpstreamPrepared = {
  vote: ReturnType<typeof voteUtteranceDomainFromPool>;
  anchors: Model3AnchorMark[];
  anchorIds: Set<string>;
  preRetryPool: FineSpanCandidatePool[];
  /** Packed decisions from host infer (features/tensors present). */
  packedDecisions: Model3SpanDecision[];
  /** Effective S3 actionable decisions after Anchor masking. */
  s3Decisions: Model3SpanDecision[];
  model3LatencyMs: number;
  inferenceOk: boolean;
  inferError?: string;
  checkpointIdentity?: {
    modelId: string;
    weightsSha256: string | null;
    role?: string;
  };
  hashPayload: Model3AcceptanceUpstreamHashPayload;
  upstreamHash: string;
  packedHash: string;
  /** Candidate/span clones frozen at prepare time (pre-Retry). */
  frozenCandidates: WindowCandidate[];
  frozenPathFineSpans: PathFineSpan[];
};

function maskAnchorDecisions(
  decisions: Model3SpanDecision[],
  anchorIds: ReadonlySet<string>
): Model3SpanDecision[] {
  return decisions.map((d) => {
    if (anchorIds.has(d.spanId) && d.decision === 'RETRY') {
      return { ...d, decision: 'KEEP' as const, eligible: false };
    }
    if (anchorIds.has(d.spanId)) {
      return { ...d, eligible: false };
    }
    return d;
  });
}

function buildInferenceInputTrace(
  decisions: readonly Model3SpanDecision[]
): Model3InferenceInputSpanTrace[] | undefined {
  const traceEnabled = process.env.MODEL3_INFERENCE_INPUT_TRACE !== '0';
  if (!traceEnabled || !decisions.some((d) => d.features)) return undefined;
  return decisions
    .filter((d) => d.features)
    .map((d) => ({
      spanId: d.spanId,
      surface: d.surface || '',
      surfaceUsed: d.surfaceUsed,
      surfaceCharLen: d.surfaceCharLen,
      rawStart: d.rawStart ?? -1,
      rawEnd: d.rawEnd ?? -1,
      seqIndex: d.seqIndex ?? 0,
      seqLen: d.seqLen ?? decisions.length,
      isAnchor: Boolean(d.isAnchor),
      anchorSource: d.anchorSource ?? 'NONE',
      features: d.features!,
      featVector: d.featVector,
      availMask: d.availMask,
      tokenIds: d.tokenIds,
      rawFirstPassCandidateCount: d.rawFirstPassCandidateCount ?? 0,
      rawPinyinChannelAvail: d.rawPinyinChannelAvail ?? false,
      keepLogit: d.keepLogit,
      retryLogit: d.retryLogit,
      margin: d.margin,
      decision: d.decision,
      eligible: d.eligible,
    }));
}

async function inferPackedDecisions(args: Model3PathStepArgs, anchorIds: ReadonlySet<string>): Promise<{
  decisions: Model3SpanDecision[];
  model3LatencyMs: number;
  inferenceOk: boolean;
  inferError?: string;
  checkpointIdentity?: Model3PathUpstreamPrepared['checkpointIdentity'];
}> {
  const host = getModel3InferenceHost();
  const t0 = Date.now();
  const spanInputs = args.pathFineSpans.map((span) => {
    const packed = packModel3SpanInferFields({
      span,
      rawText: args.rawText,
      globalSyllables: args.globalSyllables,
      isAnchor: anchorIds.has(span.spanId),
    });
    return {
      spanId: span.spanId,
      isAnchor: anchorIds.has(span.spanId),
      ...packed,
    };
  });
  const infer = await host.inferPath({ spans: spanInputs });
  const model3LatencyMs = Date.now() - t0;
  const spanById = new Map(args.pathFineSpans.map((s) => [s.spanId, s]));
  let checkpointIdentity: Model3PathUpstreamPrepared['checkpointIdentity'];
  try {
    const identity = getActiveModel3Identity();
    checkpointIdentity = {
      modelId: identity.modelId,
      weightsSha256: host.getLoadedSha256(),
      role: identity.role,
    };
  } catch {
    checkpointIdentity = {
      modelId: 'UNKNOWN',
      weightsSha256: host.getLoadedSha256(),
    };
  }
  const decisions = infer.decisions.map((d, idx) => {
    const span = spanById.get(d.spanId);
    const surface = span ? args.rawText.slice(span.rawStart, span.rawEnd) : d.surface;
    return {
      ...d,
      surface,
      isAnchor: anchorIds.has(d.spanId),
      rawStart: span?.rawStart,
      rawEnd: span?.rawEnd,
      seqIndex: d.seqIndex ?? idx,
      seqLen: d.seqLen ?? args.pathFineSpans.length,
    };
  });
  return {
    decisions,
    model3LatencyMs,
    inferenceOk: infer.ok,
    checkpointIdentity,
  };
}

/**
 * Upstream prepare without Model3 infer — vote, anchors, frozen clones only.
 * Used by dual-weight class audit fork.
 */
export async function prepareModel3PathUpstreamWithoutInfer(
  args: Model3PathStepArgs
): Promise<
  Pick<
    Model3PathUpstreamPrepared,
    | 'vote'
    | 'anchors'
    | 'anchorIds'
    | 'preRetryPool'
    | 'frozenCandidates'
    | 'frozenPathFineSpans'
  >
> {
  const preRetryPool = buildFineSpanCandidatePool(
    args.activeCandidates,
    args.coarseSpans,
    args.pathFineSpans
  );
  const vote = voteUtteranceDomainFromPool(preRetryPool);
  const { anchors } = materializeModel3Anchors({
    pathFineSpans: args.pathFineSpans,
    activeCandidates: args.activeCandidates,
    rawText: args.rawText,
  });
  const anchorIds = anchorSpanIdSet(anchors);
  if (args.forceFail) {
    throw new Error('model3_forced_fail');
  }
  return {
    vote,
    anchors,
    anchorIds,
    preRetryPool,
    frozenCandidates: cloneActiveCandidates(args.activeCandidates),
    frozenPathFineSpans: clonePathFineSpans(args.pathFineSpans),
  };
}

function attachAnchorSource(
  decisions: Model3SpanDecision[],
  anchors: Model3AnchorMark[],
  anchorIds: ReadonlySet<string>
): Model3SpanDecision[] {
  const anchorById = new Map(anchors.map((a) => [a.spanId, a]));
  return decisions.map((d) => ({
    ...d,
    anchorSource:
      (anchorById.get(d.spanId)?.source as Model3AnchorSource | undefined) ??
      (anchorIds.has(d.spanId) ? undefined : ('NONE' as const)),
  }));
}

function buildPreparedFromCore(
  core: Awaited<ReturnType<typeof prepareModel3PathUpstreamWithoutInfer>>,
  args: Model3PathStepArgs,
  packedDecisions: Model3SpanDecision[],
  inferMeta: {
    model3LatencyMs: number;
    inferenceOk: boolean;
    inferError?: string;
    checkpointIdentity?: Model3PathUpstreamPrepared['checkpointIdentity'];
  }
): Model3PathUpstreamPrepared {
  const withAnchorSource = attachAnchorSource(packedDecisions, core.anchors, core.anchorIds);
  const hashPayload = buildAcceptanceHashPayload({
    rawAsrText: args.rawText,
    pathId: args.pathId,
    pathFineSpans: core.frozenPathFineSpans,
    activeCandidates: core.frozenCandidates,
    retainedDomains: core.vote.retainedDomains,
    anchors: core.anchors,
    packedDecisions: withAnchorSource,
  });
  return {
    ...core,
    packedDecisions: withAnchorSource,
    s3Decisions: maskAnchorDecisions(withAnchorSource, core.anchorIds),
    model3LatencyMs: inferMeta.model3LatencyMs,
    inferenceOk: inferMeta.inferenceOk,
    inferError: inferMeta.inferError,
    checkpointIdentity: inferMeta.checkpointIdentity,
    hashPayload,
    upstreamHash: hashAcceptanceUpstream(hashPayload),
    packedHash: hashPackedOnly(hashPayload.packedSpans),
  };
}

/**
 * Upstream prepare — Domain Vote once, Anchors, pack/infer.
 * Fork boundary for acceptance causal A/B.
 */
export async function prepareModel3PathUpstream(
  args: Model3PathStepArgs
): Promise<Model3PathUpstreamPrepared> {
  const domainPriors = args.domainPriors ?? [];
  const preRetryPool = buildFineSpanCandidatePool(
    args.activeCandidates,
    args.coarseSpans,
    args.pathFineSpans
  );
  const vote = voteUtteranceDomainFromPool(preRetryPool);

  const { anchors } = materializeModel3Anchors({
    pathFineSpans: args.pathFineSpans,
    activeCandidates: args.activeCandidates,
    rawText: args.rawText,
  });
  const anchorIds = anchorSpanIdSet(anchors);

  if (args.forceFail) {
    throw new Error('model3_forced_fail');
  }

  const harnessKeepAll =
    Boolean(args.keepAll) || process.env.MODEL3_HARNESS_KEEP_ALL === '1';
  const forcePack = Boolean(args.forcePackSymmetry) || Boolean(args.pathId);

  let packedDecisions: Model3SpanDecision[];
  let model3LatencyMs = 0;
  let inferenceOk = true;
  let inferError: string | undefined;
  let checkpointIdentity: Model3PathUpstreamPrepared['checkpointIdentity'];

  // Legacy unit-test KEEP_ALL without host — only when packing symmetry not required.
  if (harnessKeepAll && !forcePack && !args.decisionOverride) {
    packedDecisions = args.pathFineSpans.map((span) => ({
      spanId: span.spanId,
      decision: 'KEEP' as const,
      eligible: !anchorIds.has(span.spanId),
    }));
  } else if (args.decisionOverride && !forcePack) {
    packedDecisions = args.decisionOverride.map((d) => ({ ...d }));
  } else {
    const inferred = await inferPackedDecisions(args, anchorIds);
    packedDecisions = inferred.decisions;
    model3LatencyMs = inferred.model3LatencyMs;
    inferenceOk = inferred.inferenceOk;
    inferError = inferred.inferError;
    checkpointIdentity = inferred.checkpointIdentity;
    if (args.decisionOverride) {
      const byId = new Map(args.decisionOverride.map((d) => [d.spanId, d]));
      packedDecisions = packedDecisions.map((d) => {
        const o = byId.get(d.spanId);
        return o ? { ...d, decision: o.decision, eligible: o.eligible } : d;
      });
    } else if (harnessKeepAll) {
      packedDecisions = keepOverrideFromPacked(packedDecisions, anchorIds);
    }
  }

  const s3Decisions = maskAnchorDecisions(packedDecisions, anchorIds);

  // Attach anchorSource for traces
  const anchorById = new Map(anchors.map((a) => [a.spanId, a]));
  const withAnchorSource: Model3SpanDecision[] = s3Decisions.map((d) => ({
    ...d,
    anchorSource:
      (anchorById.get(d.spanId)?.source as Model3AnchorSource | undefined) ??
      (anchorIds.has(d.spanId) ? undefined : ('NONE' as const)),
  }));

  const frozenCandidates = cloneActiveCandidates(args.activeCandidates);
  const frozenPathFineSpans = clonePathFineSpans(args.pathFineSpans);

  const hashPayload = buildAcceptanceHashPayload({
    rawAsrText: args.rawText,
    pathId: args.pathId,
    pathFineSpans: frozenPathFineSpans,
    activeCandidates: frozenCandidates,
    retainedDomains: vote.retainedDomains,
    anchors,
    packedDecisions: withAnchorSource,
  });
  const upstreamHash = hashAcceptanceUpstream(hashPayload);
  const packedHash = hashPackedOnly(hashPayload.packedSpans);

  return {
    vote,
    anchors,
    anchorIds,
    preRetryPool,
    packedDecisions: withAnchorSource,
    s3Decisions: withAnchorSource,
    model3LatencyMs,
    inferenceOk,
    inferError,
    checkpointIdentity,
    hashPayload,
    upstreamHash,
    packedHash,
    frozenCandidates,
    frozenPathFineSpans,
  };
}

/**
 * Downstream complete from frozen upstream + effective decisions.
 * Uses production Retry / Recall / Assembly — no duplicated business logic.
 */
export async function completeModel3PathFromUpstream(
  prepared: Model3PathUpstreamPrepared,
  effectiveDecisions: readonly Model3SpanDecision[],
  args: Model3PathStepArgs
): Promise<RunModel3PathStepResult> {
  const domainPriors = args.domainPriors ?? [];
  const anchors = prepared.anchors;
  const vote = prepared.vote;
  const anchorSnapshot = anchors.map((a) => ({ ...a }));

  // Branch isolation: clone pre-Retry candidates / spans from frozen snapshot.
  const pathFineSpans = clonePathFineSpans(prepared.frozenPathFineSpans);
  const activeCandidates = cloneActiveCandidates(prepared.frozenCandidates);

  const decisions = maskAnchorDecisions(
    effectiveDecisions.map((d) => ({ ...d })),
    prepared.anchorIds
  );
  const inferenceInputTrace = buildInferenceInputTrace(decisions);

  const tRetry0 = Date.now();
  const provenanceEnabled = isCandidateProvenanceTraceEnabled();
  const provenancePathId = args.pathId ?? '_anonymous';
  const retryResult = await routeModel3Retry({
    decisions,
    anchors,
    pathFineSpans,
    activeCandidates,
    retainedDomains: vote.retainedDomains,
    rawText: args.rawText,
    globalSyllables: args.globalSyllables,
    pathId: provenancePathId,
    recallQueryEvidence: args.recallQueryEvidence,
    recall: ({ span, local, retainedDomains, syllables, windowText, perSpanLimit }) => {
      const result = recallSpanTopKV2(args.runtime, {
        syllables,
        windowText,
        termLength: Math.max(1, syllables.length),
        topK: perSpanLimit,
        profile: args.profile,
        domainIds: retainedDomains.length ? retainedDomains : [],
        perSpanLimit,
        acousticTonePattern: span.toneRebindTrace?.acousticTonePattern ?? undefined,
        recallMode: RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY,
      });
      void local;
      return result.hits;
    },
    resegment:
      args.imeConfig && args.dict
        ? (regionArgs) =>
            resegmentRetryRegionWithLattice({
              ...regionArgs,
              runtime: args.runtime,
              profile: args.profile,
              retainedDomains: vote.retainedDomains,
              imeConfig: args.imeConfig!,
              dict: args.dict!,
              coarseSpans: args.coarseSpans,
              minPrior: args.minPrior,
              acousticSlices: args.acousticSlices,
              wordTimeSpans: args.wordTimeSpans,
              fuzzyRecallEnabled: args.fuzzyRecallEnabled,
              toneTimestampOnlyEnabled: args.toneTimestampOnlyEnabled,
            })
        : undefined,
  });
  const retryPathLatencyMs = Date.now() - tRetry0;

  let anchor_mutation_violations = 0;
  for (let i = 0; i < anchorSnapshot.length; i += 1) {
    const a = anchorSnapshot[i]!;
    const b = anchors[i];
    if (!b || a.spanId !== b.spanId || a.source !== b.source || a.surface !== b.surface) {
      anchor_mutation_violations += 1;
    }
  }

  let poolRefreshed = false;
  let assemblyPool: FineSpanCandidatePool[] = prepared.preRetryPool;
  if (retryResult.mutated) {
    assemblyPool = buildFineSpanCandidatePool(
      retryResult.activeCandidates,
      args.coarseSpans,
      pathFineSpans
    );
    poolRefreshed = true;
  }

  if (provenanceEnabled) {
    const poolCandidates = assemblyPool.flatMap((p) => p.candidates);
    const preAsmSource =
      poolCandidates.length > 0 ? poolCandidates : retryResult.activeCandidates;
    recordPreAssembly(provenancePathId, preAsmSource);
  }

  const assemblyResult = completeDomainAwareAssemblyFromVote(
    assemblyPool,
    vote,
    args.coarseSpans,
    args.rawText,
    pathFineSpans,
    domainPriors
  );

  if (provenanceEnabled) {
    const picks = assemblyResult.spanSets.flat().map((p) => ({
      word: p.word,
      span: p.span,
    }));
    const preSurfaces = (retryResult.activeCandidates || [])
      .filter((c) => !c.isCovered)
      .map((c) => c.replacement);
    recordAssemblyInputSelected(provenancePathId, picks, preSurfaces);
  }

  if (assemblyResult.vote !== vote) {
    throw new Error('model3_vote_identity_broken');
  }

  const candidateProvenance = provenanceEnabled
    ? takePathProvenance(provenancePathId) ?? retryResult.candidateProvenance
    : undefined;

  const diagnostics = buildModel3PathDiagnostics({
    anchors,
    decisions,
    inferenceInputTrace,
    checkpointIdentity: prepared.checkpointIdentity,
    retryAttempts: retryResult.retryAttempts,
    retryRegions: retryResult.retryRegions,
    retryRecallInvocations: retryResult.retryRecallInvocations,
    candidateProvenance,
    poolRefreshed,
    model3LatencyMs: prepared.model3LatencyMs,
    retryPathLatencyMs,
    inferenceOk: prepared.inferenceOk,
    error: prepared.inferError,
    anchor_mutation_violations,
  });

  // Capture V2 B17 — OBSERVABILITY_ONLY; accumulates per path via by_path merge.
  if (isFrozenEvidenceCaptureV2Enabled()) {
    const pathKey = String(args.pathId ?? 'path');
    captureV2Boundary('B17', {
      by_path: {
        [pathKey]: {
          anchors: anchors.map((a) => ({ ...a })),
          inference_input_trace: inferenceInputTrace ? [...inferenceInputTrace] : null,
          packed_feature_identity_or_hash: prepared.checkpointIdentity ?? null,
          decisions: decisions.map((d) => ({ ...d })),
          retry_regions: retryResult.retryRegions ?? [],
          checkpoint_identity: prepared.checkpointIdentity ?? null,
        },
      },
      note: 'per-path snapshot; later paths overwrite same boundary with merged by_path if collector merges — current: last write wins unless harness merges',
    });
  }

  return {
    assemblyResult,
    activeCandidates: retryResult.activeCandidates,
    diagnostics: { ...diagnostics, voteCallCount: 1 },
    voteCallCount: 1,
  };
}

export async function runModel3PathStep(args: Model3PathStepArgs): Promise<RunModel3PathStepResult> {
  const prepared = await prepareModel3PathUpstream(args);
  return completeModel3PathFromUpstream(prepared, prepared.s3Decisions, args);
}

export type Model3CausalForkPathResult = {
  upstreamHash: string;
  packedHash: string;
  hashPayload: Model3AcceptanceUpstreamHashPayload;
  baseline: RunModel3PathStepResult;
  s3: RunModel3PathStepResult;
  baselinePostForkMs: number;
  s3PostForkMs: number;
  hashAfterBaseline: string;
  hashAfterS3: string;
  mutationIsolated: boolean;
};

/**
 * Acceptance-only: ONE upstream prepare → BASELINE KEEP + S3 actionable.
 * Does not create a permanent production dual mainline.
 */
export async function runModel3PathStepCausalFork(
  args: Model3PathStepArgs
): Promise<Model3CausalForkPathResult> {
  const prepared = await prepareModel3PathUpstream({
    ...args,
    forcePackSymmetry: true,
    keepAll: false,
    decisionOverride: undefined,
  });

  const baselineDecisions = keepOverrideFromPacked(prepared.packedDecisions, prepared.anchorIds);

  const tB0 = Date.now();
  const baseline = await completeModel3PathFromUpstream(prepared, baselineDecisions, args);
  const baselinePostForkMs = Date.now() - tB0;
  const hashAfterBaseline = hashAcceptanceUpstream(prepared.hashPayload);

  const tS0 = Date.now();
  const s3 = await completeModel3PathFromUpstream(prepared, prepared.s3Decisions, args);
  const s3PostForkMs = Date.now() - tS0;
  const hashAfterS3 = hashAcceptanceUpstream(prepared.hashPayload);

  return {
    upstreamHash: prepared.upstreamHash,
    packedHash: prepared.packedHash,
    hashPayload: prepared.hashPayload,
    baseline,
    s3,
    baselinePostForkMs,
    s3PostForkMs,
    hashAfterBaseline,
    hashAfterS3,
    mutationIsolated:
      hashAfterBaseline === prepared.upstreamHash && hashAfterS3 === prepared.upstreamHash,
  };
}

/**
 * Acceptance-only: ONE upstream snapshot → baseline S3 weights + A1 candidate weights.
 * Both branches execute full Retry → Recall → Assembly downstream.
 */
export async function runModel3PathStepDualWeightCausalFork(
  args: Model3PathStepArgs,
  baselineIdentityId: string,
  candidateIdentityId: string
): Promise<Model3CausalForkPathResult> {
  const core = await prepareModel3PathUpstreamWithoutInfer({
    ...args,
    forcePackSymmetry: true,
    keepAll: false,
    decisionOverride: undefined,
  });
  const host = getModel3InferenceHost();
  const baselineIdentity = getModel3CheckpointIdentity(baselineIdentityId);
  const candidateIdentity = getModel3CheckpointIdentity(candidateIdentityId);

  await host.reloadCheckpointIdentity(baselineIdentity);
  const baselineInfer = await inferPackedDecisions(args, core.anchorIds);
  const baselineDecisions = maskAnchorDecisions(baselineInfer.decisions, core.anchorIds);
  const prepared = buildPreparedFromCore(core, args, baselineInfer.decisions, {
    model3LatencyMs: baselineInfer.model3LatencyMs,
    inferenceOk: baselineInfer.inferenceOk,
    inferError: baselineInfer.inferError,
    checkpointIdentity: {
      modelId: baselineIdentity.modelId,
      weightsSha256: host.getLoadedSha256(),
      role: baselineIdentity.role,
    },
  });

  const tB0 = Date.now();
  const baseline = await completeModel3PathFromUpstream(prepared, baselineDecisions, args);
  const baselinePostForkMs = Date.now() - tB0;
  const hashAfterBaseline = hashAcceptanceUpstream(prepared.hashPayload);

  await host.reloadCheckpointIdentity(candidateIdentity);
  const candidateInfer = await inferPackedDecisions(args, core.anchorIds);
  const candidateDecisions = maskAnchorDecisions(candidateInfer.decisions, core.anchorIds);
  const candidatePrepared: Model3PathUpstreamPrepared = {
    ...prepared,
    model3LatencyMs: candidateInfer.model3LatencyMs,
    inferenceOk: candidateInfer.inferenceOk,
    inferError: candidateInfer.inferError,
    checkpointIdentity: {
      modelId: candidateIdentity.modelId,
      weightsSha256: host.getLoadedSha256(),
      role: candidateIdentity.role,
    },
  };

  const tS0 = Date.now();
  const s3 = await completeModel3PathFromUpstream(candidatePrepared, candidateDecisions, args);
  const s3PostForkMs = Date.now() - tS0;
  const hashAfterS3 = hashAcceptanceUpstream(prepared.hashPayload);

  return {
    upstreamHash: prepared.upstreamHash,
    packedHash: prepared.packedHash,
    hashPayload: prepared.hashPayload,
    baseline,
    s3,
    baselinePostForkMs,
    s3PostForkMs,
    hashAfterBaseline,
    hashAfterS3,
    mutationIsolated:
      hashAfterBaseline === prepared.upstreamHash && hashAfterS3 === prepared.upstreamHash,
  };
}
