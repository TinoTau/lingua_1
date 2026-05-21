import {
  normalizeSegmentTextForMatch,
  isFuzzyObservedMatch,
  boundedEditDistance,
} from './segment-text-normalize';

describe('segment-text-normalize', () => {
  it('strips punctuation and whitespace', () => {
    expect(normalizeSegmentTextForMatch('  后选生城，')).toBe('后选生城');
  });

  it('matches fuzzy observed within edit distance 1', () => {
    expect(isFuzzyObservedMatch('后选生城', '后选声城', 1)).toBe(true);
    expect(boundedEditDistance('ab', 'cd', 1)).toBeGreaterThan(1);
  });
});
