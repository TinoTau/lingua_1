/**
 * Mirror top-level legacy observability fields into ctx.legacy partition.
 * Top-level fields remain for backward compatibility; legacy path syncs before result extra.
 */

import type { JobContext } from './job-context';

export function syncJobContextLegacyPartition(ctx: JobContext): void {
  if (!ctx.legacy) {
    ctx.legacy = {};
  }

  ctx.legacy.recover = {
    recoverLifecycle: ctx.recoverLifecycle,
    recoverLifecycleSkipReason: ctx.recoverLifecycleSkipReason,
    recoverSkipped: ctx.recoverSkipped,
    repairSkipReason: ctx.repairSkipReason,
    restoreMetrics: ctx.restoreMetrics,
    sentenceCandidates: ctx.sentenceCandidates,
    sentenceCandidateTrace: ctx.sentenceCandidateTrace,
    sentenceRepairDecision: ctx.sentenceRepairDecision,
    sentenceRepairExtra: ctx.sentenceRepairExtra,
  };

  ctx.legacy.ctc = {
    asrNbest: ctx.asrNbest,
    asrHypotheses: ctx.asrHypotheses,
    nbestSynthetic: ctx.nbestSynthetic,
    segmentSynthetic: ctx.segmentSynthetic,
    ctcNbestPreserved: ctx.ctcNbestPreserved,
    aggregationResyncReason: ctx.aggregationResyncReason,
    asrKenlmMeta: ctx.asrKenlmMeta,
  };

  ctx.legacy.windowRecall = {
    windowCandidates: ctx.windowCandidates,
    windowRecallDiagnostics: ctx.windowRecallDiagnostics,
    v5Metrics: ctx.v5Metrics,
    segmentAlignmentDiagnostics: ctx.segmentAlignmentDiagnostics,
    crossBoundaryRiskReport: ctx.crossBoundaryRiskReport,
    recallCoverageDiagnostics: ctx.recallCoverageDiagnostics,
    expansionDiagnostics: ctx.expansionDiagnostics,
  };
}
