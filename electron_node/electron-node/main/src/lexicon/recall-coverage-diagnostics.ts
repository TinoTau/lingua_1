import { normalizeSegmentTextForMatch } from './segment-text-normalize';
import { scorePinyinSimilarity } from './phonetic/pinyin';
import { detectSuspiciousSpans } from './suspicious-span-detector';
import type { NoWindowBucket } from './no-window-bucket';
import type { WindowRecallDiagnostics } from './window-recall-diagnostics';
import type { LexiconRuntime } from './lexicon-runtime';

export type RecallRejectReason =
  | 'edit_distance_too_high'
  | 'pinyin_mismatch'
  | 'no_bundle_candidate'
  | 'normalization_mismatch'
  | 'segment_alignment_risk'
  | 'window_budget_exceeded';

export type RecallCoverageDiagnostics = {
  noWindowBucket: string;
  sampleWindowText: string;
  normalizedWindowText: string;
  whyRejected: RecallRejectReason;
  fuzzyObservedAttemptCount: number;
  fuzzyObservedHitCount: number;
  fuzzyObservedRejectedCount: number;
  pinyinAttemptCount: number;
  pinyinHitCount: number;
  pinyinNoHitCount: number;
  pinyinNormalizationMismatchCount: number;
};

function syllableEditDistance(a: string[], b: string[]): number {
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }
  const maxLen = Math.max(a.length, b.length);
  const score = scorePinyinSimilarity(a, b);
  return Math.round((1 - score) * maxLen);
}

function pickSampleWindowText(segmentText: string): string {
  const chunks = detectSuspiciousSpans(segmentText);
  if (chunks.length === 0) {
    return segmentText.slice(0, Math.min(8, segmentText.length));
  }
  const longest = chunks.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  return longest.text.slice(0, Math.min(8, longest.text.length));
}

function classifyWhyRejected(
  bucket: NoWindowBucket | string,
  closest: { editDistance: number; pinyinDistance: number },
  diagnostics: WindowRecallDiagnostics
): RecallRejectReason {
  if (bucket === 'segment_alignment_risk') {
    return 'segment_alignment_risk';
  }
  if (bucket === 'window_budget_exceeded') {
    return 'window_budget_exceeded';
  }
  // V3 canonical-only: no observed/confusion world in production; keep a single bucket for coverage.
  if (bucket === 'bundle_missing_observed') {
    return 'no_bundle_candidate';
  }
  if (bucket === 'normalization_mismatch') {
    return 'normalization_mismatch';
  }
  const hits =
    diagnostics.hitsObserved +
    diagnostics.hitsPinyin +
    diagnostics.hitsConfusion +
    diagnostics.hitsFuzzyObserved;
  if (hits > 0 && diagnostics.windowCandidateCount === 0) {
    return 'normalization_mismatch';
  }
  if (closest.editDistance <= 1) {
    return 'no_bundle_candidate';
  }
  if (closest.pinyinDistance <= 1) {
    return 'edit_distance_too_high';
  }
  return 'pinyin_mismatch';
}

export function buildRecallCoverageDiagnostics(
  segmentText: string,
  runtime: LexiconRuntime,
  diagnostics: WindowRecallDiagnostics
): RecallCoverageDiagnostics | null {
  if (diagnostics.windowCandidateCount > 0) {
    return null;
  }

  const bucket = (diagnostics.noWindowBucket ?? 'no_observed_substring') as NoWindowBucket;
  const sampleWindowText = pickSampleWindowText(segmentText);

  const out: RecallCoverageDiagnostics = {
    noWindowBucket: bucket,
    sampleWindowText,
    normalizedWindowText: normalizeSegmentTextForMatch(sampleWindowText),
    whyRejected: classifyWhyRejected(bucket, { editDistance: 999, pinyinDistance: 999 }, diagnostics),
    fuzzyObservedAttemptCount: diagnostics.fuzzyObservedAttemptCount ?? 0,
    fuzzyObservedHitCount: diagnostics.fuzzyObservedHitCount ?? 0,
    fuzzyObservedRejectedCount: diagnostics.fuzzyObservedRejectedCount ?? 0,
    pinyinAttemptCount: diagnostics.pinyinAttemptCount ?? 0,
    pinyinHitCount: diagnostics.pinyinHitCount ?? 0,
    pinyinNoHitCount: diagnostics.pinyinNoHitCount ?? 0,
    pinyinNormalizationMismatchCount: diagnostics.pinyinNormalizationMismatchCount ?? 0,
  };

  return out;
}
