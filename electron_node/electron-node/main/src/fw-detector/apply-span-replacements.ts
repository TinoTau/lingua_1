import { applyReplacementsRightToLeft } from '../lexicon/selector/applySpanReplacements';
import type { FwApprovedReplacement } from './types';

export function applyFwSpanReplacements(
  originalText: string,
  replacements: FwApprovedReplacement[]
): string {
  if (!replacements.length) {
    return originalText;
  }
  return applyReplacementsRightToLeft(
    originalText,
    replacements.map((r) => ({
      start: r.start,
      end: r.end,
      to: r.candidateText,
    }))
  );
}
