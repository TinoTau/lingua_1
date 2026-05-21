import { selectActiveUtteranceText } from './activeSelector';
import type { LexiconBoundCandidate } from './types';

function makeCandidate(
  originalText: string,
  from: string,
  to: string,
  phoneticScore: number
): LexiconBoundCandidate {
  const start = originalText.indexOf(from);
  const candidateText =
    originalText.slice(0, start) + to + originalText.slice(start + from.length);
  return {
    originalText,
    candidateText,
    replacement: {
      start,
      end: start + from.length,
      from,
      to,
      source: 'window_phonetic_preview',
      phoneticScore,
    },
    sourceEvidence: {},
  };
}

describe('selectActiveUtteranceText', () => {
  const originalText = '我们要做后选生城';

  it('selects phonetic candidate when score >= 0.85', () => {
    const candidates = [makeCandidate(originalText, '后选生城', '候选生成', 1)];
    const decision = selectActiveUtteranceText({ originalText, candidates });
    expect(decision.applied).toBe(true);
    expect(decision.selectedReason).toBe('phonetic_candidate_selected');
    expect(decision.selectedText).toBe('我们要做候选生成');
  });

  it('keeps original when score below threshold', () => {
    const candidates = [makeCandidate(originalText, '后选生城', '候选生成', 0.7)];
    const decision = selectActiveUtteranceText({ originalText, candidates });
    expect(decision.applied).toBe(false);
    expect(decision.selectedReason).toBe('score_below_threshold');
    expect(decision.selectedText).toBe(originalText);
  });

  it('returns no_candidate when list empty', () => {
    const decision = selectActiveUtteranceText({ originalText, candidates: [] });
    expect(decision.selectedReason).toBe('no_candidate');
    expect(decision.selectedText).toBe(originalText);
  });

  it('picks highest phoneticScore among multiple', () => {
    const low = makeCandidate(originalText, '后选生城', '候选生成', 0.9);
    const high = makeCandidate(originalText, '后选生城', '候选生成', 1);
    const decision = selectActiveUtteranceText({
      originalText,
      candidates: [low, high],
    });
    expect(decision.applied).toBe(true);
    expect(decision.selectedCandidate?.replacement.phoneticScore).toBe(1);
  });
});
