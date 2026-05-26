import { buildDiffContextWindows } from './diff-context-windows';
import { detectNbestDiffSpans } from './nbest-diff-span';
import {
  emptyHotwordRecallStats,
  recallHotwordsForWindow,
  type HotwordRecallStats,
} from './hotword-recall';
import type { ASRHypothesis } from '../asr/types';
import type { AsrWindow } from './lexicon-types';
import type { WindowCandidate } from './hotword-types';
import type { LexiconRuntime } from './lexicon-runtime';
import { resolveRecoverQualityConfig } from '../recover-quality/quality-config';
import {
  emptyWindowRecallDiagnostics,
  type WindowRecallDiagnostics,
} from './window-recall-diagnostics';
import { classifyNoWindowBucket } from './no-window-bucket';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';

export const DEFAULT_MAX_WINDOW_CANDIDATES = 192;
export const DEFAULT_MAX_DIFF_WINDOWS = 64;
export const SEGMENT_HYPOTHESIS_INDEX = 0;

export type SegmentWindowRecallResult = {
  candidates: WindowCandidate[];
  truncated: boolean;
  windowCount: number;
  diagnostics: WindowRecallDiagnostics;
  noDiffSpan?: boolean;
  maxDomainBoostApplied: number;
};

function buildV5DiffWindows(
  segmentText: string,
  hypotheses: ASRHypothesis[],
  diagnostics: WindowRecallDiagnostics
): { windows: AsrWindow[]; noDiffSpan: boolean } {
  const diffSpans = detectNbestDiffSpans(segmentText, hypotheses);
  diagnostics.diffSpanCount = diffSpans.length;

  if (diffSpans.length === 0) {
    diagnostics.noDiffSpan = true;
    diagnostics.slidingWindowCount = 0;
    diagnostics.windowsFromNbestDiffCount = 0;
    return { windows: [], noDiffSpan: true };
  }

  const cfg = resolveRecoverQualityConfig();
  const built = buildDiffContextWindows(segmentText, diffSpans, {
    allowedWindowLengths: cfg.allowedWindowLengths,
    fineLengths: [2, 3],
    coarseLengths: [4, 5],
    diffContextLeft: cfg.diffContextLeft,
    diffContextRight: cfg.diffContextRight,
    maxWindows: DEFAULT_MAX_DIFF_WINDOWS,
    hypothesisIndex: SEGMENT_HYPOTHESIS_INDEX,
  });

  diagnostics.noDiffSpan = false;
  diagnostics.slidingWindowCount = 0;
  diagnostics.windowsFromNbestDiffCount = built.windows.length;
  diagnostics.windowLengthDistribution = built.windowLengthDistribution;
  return { windows: built.windows, noDiffSpan: false };
}

function hitToWindowCandidate(
  hit: ReturnType<typeof recallHotwordsForWindow>[number],
  window: AsrWindow,
  fromText: string
): WindowCandidate {
  return {
    windowId: window.windowId,
    hypothesisIndex: SEGMENT_HYPOTHESIS_INDEX,
    from: fromText,
    to: hit.hotword.word,
    start: window.start,
    end: window.end,
    hotwordId: hit.hotword.id,
    phoneticScore: hit.phoneticScore,
    priorScore: hit.priorScore,
    candidateScore: hit.candidateScore,
    rankInTopK: hit.rankInTopK ?? 1,
    termLength: hit.termLength ?? window.text.length,
    source: hit.recallPath,
    matchType: hit.matchType,
    windowPinyin: [...window.syllables],
    candidatePinyin: [...hit.hotword.pinyin],
    diffSpanId: window.meta?.diffSpanId,
    windowTrigger: window.meta?.windowTrigger,
    sourceHypothesisRank: window.meta?.hypothesisRank,
    candidateScoreBreakdown: hit.candidateScoreBreakdown,
    matchedAlias: hit.matchedAlias,
  };
}

function candidateKey(c: WindowCandidate): string {
  return [c.start, c.end, c.hotwordId, c.to].join('\0');
}

function mergeStats(target: WindowRecallDiagnostics, win: HotwordRecallStats): void {
  target.lexiconPinyinTopkCandidateCount =
    (target.lexiconPinyinTopkCandidateCount ?? 0) + win.hitsLexiconPinyinTopk;
  target.topkDroppedBelowMinScore =
    (target.topkDroppedBelowMinScore ?? 0) + win.topkDroppedBelowMinScore;
  target.outOfBundleCandidateCount =
    (target.outOfBundleCandidateCount ?? 0) + win.outOfBundleCandidateCount;
  target.pinyinAttemptCount = (target.pinyinAttemptCount ?? 0) + win.pinyinAttemptCount;
  target.pinyinHitCount = (target.pinyinHitCount ?? 0) + win.pinyinHitCount;
  target.pinyinNoHitCount = (target.pinyinNoHitCount ?? 0) + win.pinyinNoHitCount;
}

function recallOnWindows(
  segmentText: string,
  windows: AsrWindow[],
  runtime: LexiconRuntime,
  profile: ActiveLexiconProfileSnapshot,
  seen: Set<string>,
  out: WindowCandidate[],
  maxCandidates: number,
  diagnostics: WindowRecallDiagnostics
): { truncated: boolean; maxDomainBoostApplied: number } {
  let maxBoost = 0;
  for (const window of windows) {
    if (out.length >= maxCandidates) {
      return { truncated: true, maxDomainBoostApplied: maxBoost };
    }
    const winStats = emptyHotwordRecallStats();
    const hits = recallHotwordsForWindow(window, runtime, profile, winStats);
    maxBoost = Math.max(maxBoost, winStats.maxDomainBoostApplied);
    if (hits.length > 0) {
      diagnostics.windowsWithRecallTriggered += 1;
    }
    mergeStats(diagnostics, winStats);
    const fromText = segmentText.slice(window.start, window.end);
    for (const hit of hits) {
      if (hit.hotword.word === fromText) {
        continue;
      }
      const candidate = hitToWindowCandidate(hit, window, fromText);
      const key = candidateKey(candidate);
      if (seen.has(key)) {
        diagnostics.candidateDedupDropped += 1;
        continue;
      }
      seen.add(key);
      out.push(candidate);
      if (out.length >= maxCandidates) {
        diagnostics.droppedByQuota += 1;
        return { truncated: true, maxDomainBoostApplied: maxBoost };
      }
    }
  }
  return { truncated: false, maxDomainBoostApplied: maxBoost };
}

export function recallSegmentWindowCandidates(
  segmentText: string,
  hypotheses: ASRHypothesis[],
  runtime: LexiconRuntime,
  profile: ActiveLexiconProfileSnapshot = defaultGeneralProfile(),
  maxCandidates: number = DEFAULT_MAX_WINDOW_CANDIDATES
): SegmentWindowRecallResult {
  const trimmed = segmentText.trim();
  const diagnostics = emptyWindowRecallDiagnostics();
  diagnostics.segmentTextLength = trimmed.length;
  diagnostics.hypothesisCount = hypotheses.length;

  if (!trimmed) {
    return {
      candidates: [],
      truncated: false,
      windowCount: 0,
      diagnostics,
      maxDomainBoostApplied: 0,
    };
  }

  diagnostics.confusionSpansOnSegment = 0;

  const built = buildV5DiffWindows(trimmed, hypotheses, diagnostics);
  const windows = built.windows;

  if (built.noDiffSpan) {
    diagnostics.windowsEnumerated = 0;
    diagnostics.windowCandidateCount = 0;
    diagnostics.noWindowBucket = 'no_diff_span';
    return {
      candidates: [],
      truncated: false,
      windowCount: 0,
      diagnostics,
      noDiffSpan: true,
      maxDomainBoostApplied: 0,
    };
  }

  diagnostics.windowsEnumerated = windows.length;
  const seen = new Set<string>();
  const out: WindowCandidate[] = [];
  const { truncated, maxDomainBoostApplied } = recallOnWindows(
    trimmed,
    windows,
    runtime,
    profile,
    seen,
    out,
    maxCandidates,
    diagnostics
  );

  out.sort((a, b) => (b.candidateScore ?? 0) - (a.candidateScore ?? 0));

  diagnostics.lexiconPinyinTopkCandidateCount = out.length;
  diagnostics.outOfBundleCandidateCount = 0;
  diagnostics.windowCandidateCount = out.length;
  diagnostics.truncated = truncated;

  if (out.length === 0) {
    diagnostics.noWindowBucket = classifyNoWindowBucket({
      segmentTextLength: trimmed.length,
      diagnostics,
      confusionObservedCount: 0,
    });
  }

  return {
    candidates: out,
    truncated,
    windowCount: windows.length,
    diagnostics,
    maxDomainBoostApplied,
  };
}
