import type { FwApprovedReplacement } from './types';
import type { SentenceCombination } from './build-sentence-candidates';

export function mapSentenceToApprovedReplacements(
  picked: SentenceCombination,
  requireRepairTarget: boolean
): FwApprovedReplacement[] {
  const approved: FwApprovedReplacement[] = [];
  for (const repl of picked.replacements) {
    if (repl.word === repl.span.text) {
      continue;
    }
    if (requireRepairTarget && !repl.repairTarget) {
      continue;
    }
    approved.push({
      start: repl.span.start,
      end: repl.span.end,
      candidateText: repl.word,
      span: repl.span,
    });
  }
  return approved;
}
