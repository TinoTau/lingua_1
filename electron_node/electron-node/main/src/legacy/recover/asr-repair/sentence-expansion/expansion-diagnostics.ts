import type { ActiveSelectorDecision } from '../../../../lexicon/selector/types';
import type { SentenceCandidate } from './types';

export type ExpansionDropReason =
  | 'overlap'
  | 'score_below_threshold'
  | 'duplicate'
  | 'invalid_span'
  | 'empty_preview'
  | 'no_candidate'
  | 'max_replacements_reached'
  | 'not_applied'
  | 'raw_ctc_baseline'
  | 'unknown';

export type ExpansionFunnel = {
  windowCandidateCount: number;
  previewCount: number;
  eligiblePreviewCount: number;
  droppedWindowCandidateCount: number;
  sentenceCandidateCount: number;
  windowSingleCount: number;
  windowPairCount: number;
  windowMultiCount: number;
  duplicateSentenceRejectedCount: number;
  dropReasonDistribution: Record<string, number>;
};

export type ExpansionDiagnostics = {
  expansionFunnel: ExpansionFunnel;
  /** @deprecated 使用 selectorRejectByMaxActiveWindows */
  selectorRejectByMaxReplacements?: Record<string, number>;
  selectorRejectByMaxActiveWindows: Record<string, number>;
  maxActiveWindowsPerSentence: number;
  sentenceCandidateBudget: number;
};

function countCandidateSources(candidates: SentenceCandidate[]): Pick<
  ExpansionFunnel,
  'windowSingleCount' | 'windowPairCount' | 'windowMultiCount'
> {
  let windowSingleCount = 0;
  let windowPairCount = 0;
  let windowMultiCount = 0;
  for (const c of candidates) {
    if (c.candidateSource === 'window_single') {
      windowSingleCount += 1;
    } else if (c.candidateSource === 'window_pair') {
      windowPairCount += 1;
    } else if (c.candidateSource === 'window_multi') {
      windowMultiCount += 1;
    }
  }
  return { windowSingleCount, windowPairCount, windowMultiCount };
}

function tallyWindowRejections(decisions: ActiveSelectorDecision[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const decision of decisions) {
    for (const w of decision.windows ?? []) {
      if (!w.rejectedReason) {
        continue;
      }
      dist[w.rejectedReason] = (dist[w.rejectedReason] ?? 0) + 1;
    }
  }
  return dist;
}

export function buildExpansionDiagnostics(input: {
  windowCandidateCount: number;
  previewCount: number;
  eligiblePreviewCount: number;
  decisions: ActiveSelectorDecision[];
  candidates: SentenceCandidate[];
  duplicateSentenceRejectedCount: number;
}): ExpansionDiagnostics {
  const dropReasonDistribution = tallyWindowRejections(input.decisions);
  const sourceCounts = countCandidateSources(input.candidates);
  const droppedWindowCandidateCount = Math.max(
    0,
    input.windowCandidateCount - input.eligiblePreviewCount
  );

  return {
    expansionFunnel: {
      windowCandidateCount: input.windowCandidateCount,
      previewCount: input.previewCount,
      eligiblePreviewCount: input.eligiblePreviewCount,
      droppedWindowCandidateCount,
      sentenceCandidateCount: input.candidates.length,
      duplicateSentenceRejectedCount: input.duplicateSentenceRejectedCount,
      dropReasonDistribution,
      ...sourceCounts,
    },
    selectorRejectByMaxReplacements: {},
    selectorRejectByMaxActiveWindows: {},
    maxActiveWindowsPerSentence: 2,
    sentenceCandidateBudget: 32,
  };
}

export function emptyExpansionDiagnostics(): ExpansionDiagnostics {
  return buildExpansionDiagnostics({
    windowCandidateCount: 0,
    previewCount: 0,
    eligiblePreviewCount: 0,
    decisions: [],
    candidates: [],
    duplicateSentenceRejectedCount: 0,
  });
}
