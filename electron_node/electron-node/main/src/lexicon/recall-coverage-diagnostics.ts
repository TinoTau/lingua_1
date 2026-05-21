import { boundedEditDistance, normalizeSegmentTextForMatch } from './segment-text-normalize';
import { textToSyllables, scorePinyinSimilarity } from './phonetic/pinyin';
import { syllablesKey } from './pinyin-index';
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
  | 'window_budget_exceeded'
  | 'bundle_missing_observed';

export type RecallCoverageDiagnostics = {
  noWindowBucket: string;
  sampleWindowText: string;
  normalizedWindowText: string;
  closestObserved: string;
  editDistance: number;
  pinyinDistance: number;
  whyRejected: RecallRejectReason;
  fuzzyObservedAttemptCount: number;
  fuzzyObservedHitCount: number;
  fuzzyObservedRejectedCount: number;
  pinyinAttemptCount: number;
  pinyinHitCount: number;
  pinyinNoHitCount: number;
  pinyinNormalizationMismatchCount: number;
  bundleMissingObservedCandidates?: BundleMissingObservedEntry[];
};

export type BundleMissingObservedEntry = {
  windowText: string;
  suggestedObserved: string;
  targetHotword: string;
  editDistance: number;
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

function findClosestObserved(
  windowText: string,
  observedStrings: readonly string[]
): { observed: string; editDistance: number; pinyinDistance: number } {
  const normWindow = normalizeSegmentTextForMatch(windowText);
  const windowSyllables = textToSyllables(windowText);
  let best = { observed: '', editDistance: 999, pinyinDistance: 999 };

  for (const observed of observedStrings) {
    if (observed.length < 2) {
      continue;
    }
    const normObs = normalizeSegmentTextForMatch(observed);
    const editDistance = boundedEditDistance(normWindow, normObs, 8);
    const obsSyllables = textToSyllables(observed);
    const pinyinDistance = syllableEditDistance(windowSyllables, obsSyllables);
    if (
      best.observed === '' ||
      editDistance < best.editDistance ||
      (editDistance === best.editDistance && pinyinDistance < best.pinyinDistance)
    ) {
      best = { observed, editDistance, pinyinDistance };
    }
  }

  return best;
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
  if (bucket === 'bundle_missing_observed') {
    return 'bundle_missing_observed';
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

function buildBundleMissingReport(
  segmentText: string,
  observedStrings: readonly string[],
  runtime: LexiconRuntime,
  limit: number
): BundleMissingObservedEntry[] {
  const sample = pickSampleWindowText(segmentText);
  const chunks = detectSuspiciousSpans(segmentText);
  const windows: string[] = [sample];
  for (const c of chunks) {
    for (let len = 2; len <= Math.min(6, c.text.length); len++) {
      windows.push(c.text.slice(0, len));
    }
  }

  const entries: BundleMissingObservedEntry[] = [];
  const seen = new Set<string>();

  for (const windowText of windows) {
    const { observed, editDistance } = findClosestObserved(windowText, observedStrings);
    if (!observed || editDistance > 2) {
      continue;
    }
    const hits = runtime.recallHotwordsByObserved(observed, 1);
    if (hits.length > 0) {
      continue;
    }
    const key = `${windowText}\0${observed}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      windowText,
      suggestedObserved: observed,
      targetHotword: '',
      editDistance,
    });
    if (entries.length >= limit) {
      break;
    }
  }

  return entries;
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
  const observedStrings = runtime.getConfusionObservedStrings();
  const sampleWindowText = pickSampleWindowText(segmentText);
  const closest = findClosestObserved(sampleWindowText, observedStrings);

  const out: RecallCoverageDiagnostics = {
    noWindowBucket: bucket,
    sampleWindowText,
    normalizedWindowText: normalizeSegmentTextForMatch(sampleWindowText),
    closestObserved: closest.observed,
    editDistance: closest.observed ? closest.editDistance : 999,
    pinyinDistance: closest.observed ? closest.pinyinDistance : 999,
    whyRejected: classifyWhyRejected(bucket, closest, diagnostics),
    fuzzyObservedAttemptCount: diagnostics.fuzzyObservedAttemptCount ?? 0,
    fuzzyObservedHitCount: diagnostics.fuzzyObservedHitCount ?? 0,
    fuzzyObservedRejectedCount: diagnostics.fuzzyObservedRejectedCount ?? 0,
    pinyinAttemptCount: diagnostics.pinyinAttemptCount ?? 0,
    pinyinHitCount: diagnostics.pinyinHitCount ?? 0,
    pinyinNoHitCount: diagnostics.pinyinNoHitCount ?? 0,
    pinyinNormalizationMismatchCount: diagnostics.pinyinNormalizationMismatchCount ?? 0,
  };

  if (bucket === 'no_observed_substring' || bucket === 'bundle_missing_observed') {
    const missing = buildBundleMissingReport(segmentText, observedStrings, runtime, 3);
    if (missing.length > 0) {
      out.bundleMissingObservedCandidates = missing;
    }
  }

  return out;
}
