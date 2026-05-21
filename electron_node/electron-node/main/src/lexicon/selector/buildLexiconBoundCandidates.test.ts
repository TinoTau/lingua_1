import { buildLexiconBoundCandidates } from './buildLexiconBoundCandidates';
import type { WindowPhoneticPreviewItem } from '../phonetic/types';

describe('buildLexiconBoundCandidates', () => {
  const originalText = '我们要做后选生城';

  it('builds single local replacement when span is unique', () => {
    const preview: WindowPhoneticPreviewItem[] = [
      {
        spanText: '后选生城',
        spanStart: 4,
        spanEnd: 8,
        candidateText: '候选生成',
        candidateSource: 'confusion',
        phoneticScore: 1,
      },
    ];
    const candidates = buildLexiconBoundCandidates({ originalText, preview });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidateText).toBe('我们要做候选生成');
    expect(candidates[0].replacement.from).toBe('后选生城');
    expect(candidates[0].replacement.to).toBe('候选生成');
  });

  it('discards single-character replacement', () => {
    const preview: WindowPhoneticPreviewItem[] = [
      {
        spanText: '她',
        candidateText: '他',
        candidateSource: 'confusion',
        phoneticScore: 1,
      },
    ];
    const candidates = buildLexiconBoundCandidates({
      originalText: '她今天来了',
      preview,
    });
    expect(candidates).toHaveLength(0);
  });

  it('uses explicit span coordinates when from appears multiple times', () => {
    const text = '今天我们团队要讨论后选生城相关的后选生城流程';
    const preview: WindowPhoneticPreviewItem[] = [
      {
        spanText: '后选生城',
        spanStart: 9,
        spanEnd: 13,
        candidateText: '候选生成',
        phoneticScore: 0.9,
      },
      {
        spanText: '后选生城',
        spanStart: 16,
        spanEnd: 20,
        candidateText: '候选生成',
        phoneticScore: 0.88,
      },
    ];
    const candidates = buildLexiconBoundCandidates({ originalText: text, preview });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].replacement.start).toBe(9);
    expect(candidates[1].replacement.start).toBe(16);
  });

  it('discards when from appears multiple times without coordinates', () => {
    const preview: WindowPhoneticPreviewItem[] = [
      {
        spanText: '我们',
        candidateText: '你们',
        candidateSource: 'confusion',
        phoneticScore: 1,
      },
    ];
    const candidates = buildLexiconBoundCandidates({
      originalText: '我们和我们',
      preview,
    });
    expect(candidates).toHaveLength(0);
  });

  it('discards full-sentence replacement', () => {
    const preview: WindowPhoneticPreviewItem[] = [
      {
        spanText: originalText,
        candidateText: '我今天去医院',
        candidateSource: 'confusion',
        phoneticScore: 1,
      },
    ];
    const candidates = buildLexiconBoundCandidates({ originalText, preview });
    expect(candidates).toHaveLength(0);
  });
});
