/**
 * Compact Model3 path diagnostics (internal FW trace — not JobResult).
 */

import type {
  Model3AnchorMark,
  Model3InferenceInputSpanTrace,
  Model3PathDiagnostics,
  Model3RetryRecallInvocationTrace,
  Model3SpanDecision,
} from './model3-types';
import type { Model3RetryAttemptTrace, Model3RetryRegionTrace } from './model3-types';

export function buildModel3PathDiagnostics(args: {
  anchors: readonly Model3AnchorMark[];
  decisions: readonly Model3SpanDecision[];
  inferenceInputTrace?: readonly Model3InferenceInputSpanTrace[];
  checkpointIdentity?: Model3PathDiagnostics['checkpointIdentity'];
  retryAttempts: readonly Model3RetryAttemptTrace[];
  retryRegions?: readonly Model3RetryRegionTrace[];
  /** Observation-only Retry Recall inputs/outputs (MODEL2_DIALOG200_TRACE=1). */
  retryRecallInvocations?: readonly Model3RetryRecallInvocationTrace[];
  /** Observation-only (MODEL3_CANDIDATE_PROVENANCE_TRACE=1). */
  candidateProvenance?: unknown;
  poolRefreshed: boolean;
  model3LatencyMs: number;
  retryPathLatencyMs: number;
  inferenceOk: boolean;
  error?: string;
  anchor_mutation_violations?: number;
}): Model3PathDiagnostics {
  const model2_anchor_count = args.anchors.filter((a) => a.source === 'MODEL2').length;
  return {
    voteCallCount: 1,
    voteFrozen: true,
    poolRefreshed: args.poolRefreshed,
    anchors: args.anchors,
    model2_anchor_count,
    anchor_mutation_violations: args.anchor_mutation_violations ?? 0,
    decisions: args.decisions,
    inferenceInputTrace: args.inferenceInputTrace,
    checkpointIdentity: args.checkpointIdentity,
    retryAttempts: args.retryAttempts,
    retryRegions: args.retryRegions ?? [],
    retryRecallInvocations: args.retryRecallInvocations,
    candidateProvenance: args.candidateProvenance,
    model3LatencyMs: args.model3LatencyMs,
    retryPathLatencyMs: args.retryPathLatencyMs,
    inferenceOk: args.inferenceOk,
    error: args.error,
  };
}
