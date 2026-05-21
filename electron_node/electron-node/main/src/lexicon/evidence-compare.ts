import type { LexiconRecallEvidence } from './lexicon-types';

/** Lower sort index = better evidence (term path beats pinyin, then higher priority). */
export function compareEvidence(a: LexiconRecallEvidence, b: LexiconRecallEvidence): number {
  const pathRank = (p: LexiconRecallEvidence['recallPath']) => (p === 'term' ? 0 : 1);
  const pathDiff = pathRank(a.recallPath) - pathRank(b.recallPath);
  if (pathDiff !== 0) {
    return pathDiff;
  }
  return b.priority - a.priority;
}

export function pickBestEvidence(evidences: LexiconRecallEvidence[]): LexiconRecallEvidence {
  return [...evidences].sort(compareEvidence)[0];
}
