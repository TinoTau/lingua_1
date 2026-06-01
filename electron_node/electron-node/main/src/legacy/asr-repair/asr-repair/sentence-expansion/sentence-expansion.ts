import type { ASRHypothesis } from '../../../../asr/types';
import { getAsrRepairQualityConfig } from '../../../../asr-repair-quality/quality-config';
import { SEGMENT_HYPOTHESIS_INDEX } from '../../../../lexicon/window-recall';
import { selectActiveUtteranceTextWindowBased } from '../../../../lexicon/selector/windowSelector';
import type { LexiconBoundCandidate } from '../../../../lexicon/selector/types';
import { resolveCandidateSource } from '../candidate-source';
import type { WindowCandidate } from '../../../../lexicon/hotword-types';
import { windowCandidatesToPreview } from './window-candidates-to-preview';
import {
  buildExpansionDiagnostics,
  emptyExpansionDiagnostics,
  type ExpansionDiagnostics,
} from './expansion-diagnostics';
import { sentenceCandidateDedupKey } from './sentence-candidate-dedup';
import {
  DEFAULT_SENTENCE_EXPANSION_LIMITS,
  type SentenceCandidate,
  type SentenceExpansionLimits,
} from './types';

export type ExpandSentenceCandidatesInput = {
  segmentText: string;
  hypotheses: ASRHypothesis[];
  windowCandidates: WindowCandidate[];
  limits?: Partial<SentenceExpansionLimits>;
};

export type ExpandSentenceCandidatesResult = {
  candidates: SentenceCandidate[];
  diagnostics: ExpansionDiagnostics;
};

function avg(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function countEligiblePreview(
  pool: WindowCandidate[],
  preview: ReturnType<typeof windowCandidatesToPreview>
): number {
  let n = 0;
  for (const item of preview) {
    const matched = pool.find(
      (c) =>
        c.start === item.spanStart &&
        c.end === item.spanEnd &&
        c.from === item.spanText &&
        c.to === item.candidateText
    );
    if (matched && matched.to !== matched.from) {
      n += 1;
    }
  }
  return n;
}

function boundReplacementsToWindowCandidates(
  pool: WindowCandidate[],
  bounds: LexiconBoundCandidate[]
): WindowCandidate[] {
  return bounds.map((b) => {
    const { start, end, from, to } = b.replacement;
    const matched = pool.find(
      (c) => c.start === start && c.end === end && c.from === from && c.to === to
    );
    if (matched) {
      return matched;
    }
    const poolPrior = pool.reduce((m, c) => Math.max(m, c.priorScore), 0);
    const poolScore = pool.reduce((m, c) => Math.max(m, c.candidateScore ?? 0), 0);
    return {
      windowId: `sel-${start}-${end}`,
      hypothesisIndex: SEGMENT_HYPOTHESIS_INDEX,
      from,
      to,
      start,
      end,
      hotwordId: 'selector-bound',
      phoneticScore: b.replacement.phoneticScore ?? 0,
      priorScore: poolPrior,
      candidateScore: poolScore,
      rankInTopK: 1,
      termLength: (to || from).length,
      source: 'lexicon_pinyin_topk',
    };
  });
}

function decisionToSentenceCandidate(
  baseText: string,
  rank0: ASRHypothesis,
  pool: WindowCandidate[],
  decision: ReturnType<typeof selectActiveUtteranceTextWindowBased>
): SentenceCandidate | null {
  if (!decision.applied || !decision.selectedCandidates?.length) {
    return null;
  }
  const replacements = boundReplacementsToWindowCandidates(pool, decision.selectedCandidates);
  if (!replacements.length || decision.selectedText === baseText) {
    return null;
  }
  return {
    text: decision.selectedText,
    hypothesisIndex: SEGMENT_HYPOTHESIS_INDEX,
    baseText,
    replacements,
    candidateSource: resolveCandidateSource(replacements),
    acousticScore: rank0.acousticScore,
    phoneticScore: avg(replacements.map((r) => r.phoneticScore)),
    hotwordPrior: sum(replacements.map((r) => r.priorScore)),
  };
}

/**
 * 历史主链：window recall → windowSelector → SentenceCandidate[] → KenLM rerank。
 */
export function expandSentenceCandidates(
  input: ExpandSentenceCandidatesInput
): ExpandSentenceCandidatesResult {
  const quality = getAsrRepairQualityConfig();
  const limits = {
    ...DEFAULT_SENTENCE_EXPANSION_LIMITS,
    maxActiveWindowsPerSentence: quality.maxActiveWindows,
    maxSentenceCandidates: quality.maxSentenceCandidates,
    ...input.limits,
  };
  const baseText = input.segmentText.trim();
  if (!baseText) {
    return { candidates: [], diagnostics: emptyExpansionDiagnostics() };
  }

  const rank0 =
    input.hypotheses.find((h) => h.rank === SEGMENT_HYPOTHESIS_INDEX) ?? input.hypotheses[0];
  if (!rank0) {
    return { candidates: [], diagnostics: emptyExpansionDiagnostics() };
  }

  const pool = input.windowCandidates.filter(
    (c) => c.hypothesisIndex === SEGMENT_HYPOTHESIS_INDEX
  );
  const preview = windowCandidatesToPreview(pool);
  if (!preview.length) {
    return {
      candidates: [],
      diagnostics: buildExpansionDiagnostics({
        windowCandidateCount: pool.length,
        previewCount: 0,
        eligiblePreviewCount: 0,
        decisions: [],
        candidates: [],
        duplicateSentenceRejectedCount: 0,
      }),
    };
  }

  const out: SentenceCandidate[] = [];
  const seenKeys = new Set<string>();
  let duplicateSentenceRejectedCount = 0;
  const decisions: ReturnType<typeof selectActiveUtteranceTextWindowBased>[] = [];
  const selectorRejectByMaxActiveWindows: Record<string, number> = {};

  for (
    let activeWindowCount = 1;
    activeWindowCount <= limits.maxActiveWindowsPerSentence;
    activeWindowCount++
  ) {
    const decision = selectActiveUtteranceTextWindowBased({
      originalText: baseText,
      preview,
      minPhoneticScore: quality.expansionMinPhoneticScore,
      maxReplacements: activeWindowCount,
    });
    decisions.push(decision);

    for (const w of decision.windows ?? []) {
      if (w.rejectedReason) {
        const key = `aw${activeWindowCount}:${w.rejectedReason}`;
        selectorRejectByMaxActiveWindows[key] = (selectorRejectByMaxActiveWindows[key] ?? 0) + 1;
      }
    }

    const candidate = decisionToSentenceCandidate(baseText, rank0, pool, decision);
    if (!candidate || candidate.candidateSource === 'raw_ctc_baseline') {
      continue;
    }
    const dedupeKey = sentenceCandidateDedupKey(candidate);
    if (seenKeys.has(dedupeKey)) {
      duplicateSentenceRejectedCount += 1;
      continue;
    }
    seenKeys.add(dedupeKey);
    out.push(candidate);
    if (out.length >= limits.maxSentenceCandidates) {
      break;
    }
  }

  const diagnostics = buildExpansionDiagnostics({
    windowCandidateCount: pool.length,
    previewCount: preview.length,
    eligiblePreviewCount: countEligiblePreview(pool, preview),
    decisions,
    candidates: out,
    duplicateSentenceRejectedCount,
  });
  diagnostics.selectorRejectByMaxActiveWindows = selectorRejectByMaxActiveWindows;
  diagnostics.maxActiveWindowsPerSentence = limits.maxActiveWindowsPerSentence;
  diagnostics.sentenceCandidateBudget = limits.maxSentenceCandidates;

  return {
    candidates: out.slice(0, limits.maxSentenceCandidates),
    diagnostics,
  };
}
