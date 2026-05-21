import { pickWithNearTieCoverageGuardrail } from './near-tie-coverage-guardrail';
import type { SentenceCandidate } from '../sentence-expansion/types';

function cand(
  source: SentenceCandidate['candidateSource'],
  combinedScore: number,
  replacementCount: number
): SentenceCandidate {
  const replacements = Array.from({ length: replacementCount }, (_, i) => ({
    windowId: `w${i}`,
    hypothesisIndex: 0,
    from: 'a',
    to: 'b',
    start: i,
    end: i + 1,
    hotwordId: `h${i}`,
    phoneticScore: 0.9,
    priorScore: 0.1,
    source: 'hotword' as const,
  }));
  return {
    text: `t-${source}-${replacementCount}`,
    hypothesisIndex: 0,
    baseText: 'base',
    replacements,
    candidateSource: source,
    acousticScore: 0,
    phoneticScore: 0.9,
    hotwordPrior: 0.1,
    combinedScore,
  };
}

describe('pickWithNearTieCoverageGuardrail', () => {
  it('prefers more replacements when scores are within epsilon', () => {
    const scored = [
      cand('window_single', 0.631, 1),
      cand('window_pair', 0.628, 2),
    ];
    const { picked, diagnostics } = pickWithNearTieCoverageGuardrail(scored, 0.005);
    expect(picked.candidateSource).toBe('window_pair');
    expect(diagnostics.applied).toBe(true);
  });

  it('keeps top score when gap exceeds epsilon', () => {
    const scored = [cand('window_single', 0.9, 1), cand('window_pair', 0.5, 2)];
    const { picked } = pickWithNearTieCoverageGuardrail(scored, 0.005);
    expect(picked.candidateSource).toBe('window_single');
  });
});
