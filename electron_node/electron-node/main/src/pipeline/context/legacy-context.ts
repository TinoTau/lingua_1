/**
 * Legacy observability partition — Legacy ASR repair / CTC / window recall.
 * FW frozen main chain must not read or write these buckets.
 */

import type { ASRHypothesis } from '../../asr/types';
import type { AsrKenlmMeta, AsrNBestItem } from '../../task-router/types';
import type { WindowCandidate } from '../../lexicon/hotword-types';
import type { WindowRecallDiagnostics } from '../../lexicon/window-recall-diagnostics';
import type { RecallCoverageDiagnostics } from '../../lexicon/recall-coverage-diagnostics';
import type { SegmentAlignmentDiagnostics } from '../../asr/segment-alignment-diagnostics';
import type { CrossBoundaryRiskReport } from '../../asr/cross-boundary-risk';
import type { RestoreMetrics } from '../../legacy/asr-repair/asr-repair/restore-metrics';
import type { SentenceCandidate } from '../../legacy/asr-repair/asr-repair/sentence-expansion/types';
import type { ExpansionDiagnostics } from '../../legacy/asr-repair/asr-repair/sentence-expansion/expansion-diagnostics';
import type { SentenceRepairExtra } from '../../legacy/asr-repair/asr-repair/sentence-rerank/sentence-repair-observability';
import type { AsrRepairLifecycle } from '../../legacy/asr-repair/legacy-asr-repair-contract-types';
import type { SentenceCandidateTraceItem, V5Metrics } from '../../legacy/asr-repair/legacy-v5-metrics';

/** Legacy ASR repair sentence-repair / lifecycle observability. */
export interface LegacyAsrRepairContext {
  asrRepairLifecycle?: AsrRepairLifecycle;
  asrRepairLifecycleSkipReason?: string;
  asrRepairSkipped?: boolean;
  repairSkipReason?: string | null;
  restoreMetrics?: RestoreMetrics;
  sentenceCandidates?: SentenceCandidate[];
  sentenceCandidateTrace?: SentenceCandidateTraceItem[];
  sentenceRepairDecision?: SentenceCandidate;
  sentenceRepairExtra?: SentenceRepairExtra;
}

/** CTC n-best / hypothesis observability. */
export interface LegacyCtcContext {
  asrNbest?: AsrNBestItem[];
  asrHypotheses?: ASRHypothesis[];
  nbestSynthetic?: boolean;
  segmentSynthetic?: boolean;
  ctcNbestPreserved?: boolean;
  aggregationResyncReason?: string;
  asrKenlmMeta?: AsrKenlmMeta;
}

/** Window recall / expansion diagnostics. */
export interface LegacyWindowRecallContext {
  windowCandidates?: WindowCandidate[];
  windowRecallDiagnostics?: WindowRecallDiagnostics;
  v5Metrics?: V5Metrics;
  segmentAlignmentDiagnostics?: SegmentAlignmentDiagnostics;
  crossBoundaryRiskReport?: CrossBoundaryRiskReport | null;
  recallCoverageDiagnostics?: RecallCoverageDiagnostics | null;
  expansionDiagnostics?: ExpansionDiagnostics;
}

export interface LegacyContext {
  asrRepair?: LegacyAsrRepairContext;
  ctc?: LegacyCtcContext;
  windowRecall?: LegacyWindowRecallContext;
}
