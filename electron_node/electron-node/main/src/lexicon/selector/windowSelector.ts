import { buildLexiconBoundCandidates } from './buildLexiconBoundCandidates';
import { buildSpanWindows } from './buildSpanWindows';
import { applyReplacementsRightToLeft, spansOverlap } from './applySpanReplacements';
import { compareBoundCandidates } from './selectionCompare';
import type { WindowPhoneticPreviewItem } from '../phonetic/types';
import type { ActiveSelectorDecision, LexiconBoundCandidate, SpanWindow } from './types';

const DEFAULT_MIN_PHONETIC_SCORE = 0.85;
const DEFAULT_MAX_REPLACEMENTS = 2;

function selectOnePerWindow(window: SpanWindow, minScore: number): void {
  if (!window.boundCandidates.length) {
    window.rejectedReason = 'no_candidate';
    return;
  }

  const qualified = window.boundCandidates.filter(
    (c) => (c.replacement.phoneticScore ?? 0) >= minScore
  );
  if (!qualified.length) {
    window.rejectedReason = 'score_below_threshold';
    return;
  }

  const sorted = [...qualified].sort(compareBoundCandidates);
  window.selectedCandidate = sorted[0];
}

function resolveWindowConflicts(
  windows: SpanWindow[],
  maxReplacements: number
): LexiconBoundCandidate[] {
  const contenders = windows.filter((w) => w.selectedCandidate);
  const sorted = [...contenders].sort((a, b) =>
    compareBoundCandidates(a.selectedCandidate!, b.selectedCandidate!)
  );

  const picked: LexiconBoundCandidate[] = [];
  for (const window of sorted) {
    const candidate = window.selectedCandidate!;
    if (picked.length >= maxReplacements) {
      window.rejectedReason = 'max_replacements_reached';
      window.selectedCandidate = undefined;
      continue;
    }

    const { start, end } = candidate.replacement;
    const overlaps = picked.some((p) =>
      spansOverlap(start, end, p.replacement.start, p.replacement.end)
    );
    if (overlaps) {
      window.rejectedReason = 'overlap';
      window.selectedCandidate = undefined;
      continue;
    }

    picked.push(candidate);
  }

  return picked;
}

function noChangeDecision(
  originalText: string,
  reason: ActiveSelectorDecision['selectedReason'],
  windows: SpanWindow[]
): ActiveSelectorDecision {
  return {
    selectedText: originalText,
    applied: false,
    selectedReason: reason,
    windows,
  };
}

function appliedDecision(
  originalText: string,
  picked: LexiconBoundCandidate[],
  windows: SpanWindow[]
): ActiveSelectorDecision {
  const selectedText = applyReplacementsRightToLeft(
    originalText,
    picked.map((c) => ({
      start: c.replacement.start,
      end: c.replacement.end,
      to: c.replacement.to,
    }))
  );

  const selectedReason =
    picked.length >= 2 ? 'multi_window_candidates_selected' : 'phonetic_candidate_selected';

  return {
    selectedText,
    applied: true,
    selectedReason,
    selectedCandidate: picked[0],
    selectedCandidates: picked,
    windows,
  };
}

/**
 * Window-based selector: per-window select-one, then inter-window conflict + RTL apply.
 * 统一走 span 窗路径（禁止 maxReplacements<=1 时全局 flat 单选，避免漏掉非重叠多窗）。
 */
export function selectActiveUtteranceTextWindowBased(params: {
  originalText: string;
  preview: WindowPhoneticPreviewItem[];
  minPhoneticScore?: number;
  maxReplacements?: number;
}): ActiveSelectorDecision {
  const originalText = params.originalText;
  const minScore = params.minPhoneticScore ?? DEFAULT_MIN_PHONETIC_SCORE;
  const maxReplacements = Math.max(1, params.maxReplacements ?? DEFAULT_MAX_REPLACEMENTS);

  if (!params.preview.length) {
    return noChangeDecision(originalText, 'no_candidate', []);
  }

  const windows = buildSpanWindows({ originalText, preview: params.preview });
  for (const window of windows) {
    window.boundCandidates = buildLexiconBoundCandidates({
      originalText,
      preview: window.previews,
    });
    selectOnePerWindow(window, minScore);
  }

  const picked = resolveWindowConflicts(windows, maxReplacements);
  if (!picked.length) {
    const anyBound = windows.some((w) => w.boundCandidates.length > 0);
    const reason = anyBound ? 'score_below_threshold' : 'no_candidate';
    return noChangeDecision(originalText, reason, windows);
  }

  return appliedDecision(originalText, picked, windows);
}
