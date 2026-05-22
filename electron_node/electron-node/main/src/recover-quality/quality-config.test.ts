import { describe, expect, it } from '@jest/globals';
import { resolveRecoverQualityConfig } from './quality-config';

describe('resolveRecoverQualityConfig', () => {
  it('includes V5 frozen defaults when node config omits lexicon fields', () => {
    const cfg = resolveRecoverQualityConfig({});
    expect(cfg.allowedWindowLengths).toEqual([2, 3, 4, 5]);
    expect(cfg.diffContextLeft).toBe(2);
    expect(cfg.diffContextRight).toBe(2);
    expect(cfg.topKByTermLength).toEqual({ '2': 5, '3': 5, '4': 3, '5': 2 });
    expect(cfg.maxActiveWindows).toBe(2);
    expect(cfg.maxSentenceCandidates).toBe(32);
    expect(cfg.nearPinyinEnabled).toBe(false);
    expect(cfg.crossSegmentRecallEnabled).toBe(false);
    expect(cfg.kenlmBaselineTolerance).toBe(0.15);
    expect(cfg.observedRecallEnabled).toBe(false);
  });

  it('merges lexicon overrides from node config', () => {
    const cfg = resolveRecoverQualityConfig({
      features: {
        lexiconRecall: {
          kenlmBaselineTolerance: 0.2,
          maxActiveWindows: 3,
        },
      },
    } as Parameters<typeof resolveRecoverQualityConfig>[0]);
    expect(cfg.kenlmBaselineTolerance).toBe(0.2);
    expect(cfg.maxActiveWindows).toBe(3);
    expect(cfg.recallFuzzyPinyinMaxSyllableDelta).toBe(2);
  });
});
