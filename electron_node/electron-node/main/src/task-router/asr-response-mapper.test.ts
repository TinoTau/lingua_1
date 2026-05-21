import { describe, it, expect } from '@jest/globals';
import { mapCtcUtteranceResponse } from './asr-response-mapper';

describe('mapCtcUtteranceResponse', () => {
  it('maps nbest and kenlm when present', () => {
    const { nbest, kenlmMeta } = mapCtcUtteranceResponse({
      text: '候选生成',
      nbest: [
        { text: '候选生成', score: -5.0, logit_score: -1.0, lm_score: -4.0 },
        { text: '后选生城', score: -10.0, logit_score: -2.0, lm_score: -8.0 },
      ],
      kenlm: {
        kenlm_available: true,
        kenlm_called_count: 4,
        kenlm_decision: 'pass',
      },
    });

    expect(nbest).toBeDefined();
    expect(nbest!.length).toBe(2);
    expect(nbest![0].rank).toBe(0);
    expect(nbest![0].text).toBe('候选生成');
    expect(nbest![0].acousticScore).toBe(-1.0);
    expect(nbest![0].lmScore).toBe(-4.0);
    expect(nbest![0].score).toBe(-5.0);
    expect(nbest![0].totalScore).toBe(-5.0);
    expect(kenlmMeta).toBeDefined();
    expect(kenlmMeta!.kenlm_available).toBe(true);
    expect(kenlmMeta!.kenlm_called_count).toBe(4);
    expect(kenlmMeta!.kenlm_decision).toBe('pass');
  });

  it('returns undefined evidence when only text', () => {
    const { nbest, kenlmMeta } = mapCtcUtteranceResponse({ text: 'hello' });
    expect(nbest).toBeUndefined();
    expect(kenlmMeta).toBeUndefined();
  });

  it('does not treat meta.decode_ms as KenLM meta', () => {
    const { kenlmMeta } = mapCtcUtteranceResponse({
      text: '候选生成',
      meta: { decode_ms: 12 },
    });
    expect(kenlmMeta).toBeUndefined();
  });

  it('skips nbest items without string text', () => {
    const { nbest } = mapCtcUtteranceResponse({
      nbest: [{ text: 'ok' }, { text: 123 }, { text: 'second' }],
    });
    expect(nbest!.length).toBe(2);
    expect(nbest![1].rank).toBe(1);
    expect(nbest![1].text).toBe('second');
  });

  it('reads hypotheses alias', () => {
    const { nbest } = mapCtcUtteranceResponse({
      hypotheses: [{ text: 'a' }, { text: 'b' }],
    });
    expect(nbest!.length).toBe(2);
  });

  it('reads nbest_list alias', () => {
    const { nbest } = mapCtcUtteranceResponse({
      nbest_list: [{ text: 'a', logit_score: -1 }, { text: 'b', logit_score: -2 }],
    });
    expect(nbest!.length).toBe(2);
  });
});
