import { describe, expect, it } from '@jest/globals';
import { buildCandidateSentence, buildCandidateSentencesForSpan } from './candidate-sentence-builder';

describe('candidate-sentence-builder', () => {
  it('replaces span text in raw sentence', () => {
    const raw = '我想去咖啡厅坐坐';
    const span = { text: '咖啡厅', start: 3, end: 6 };
    expect(buildCandidateSentence(raw, span, '咖啡馆')).toBe('我想去咖啡馆坐坐');
  });

  it('builds one sentence per candidate word', () => {
    const raw = '我想去咖啡厅坐坐';
    const span = { text: '咖啡厅', start: 3, end: 6 };
    const sentences = buildCandidateSentencesForSpan(raw, span, ['咖啡馆', '咖啡店']);
    expect(sentences).toEqual(['我想去咖啡馆坐坐', '我想去咖啡店坐坐']);
  });
});
