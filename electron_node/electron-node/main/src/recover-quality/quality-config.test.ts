import { describe, it, expect } from '@jest/globals';
import { resolveRecoverQualityConfig, buildRecoverQualityConfigSnapshot } from './quality-config';

describe('recover-quality quality-config', () => {
  it('defaults crossSegmentRecallEnabled to false', () => {
    const cfg = resolveRecoverQualityConfig(null);
    expect(cfg.crossSegmentRecallEnabled).toBe(false);
  });

  it('snapshot omits removed legacy recall flags', () => {
    const snap = buildRecoverQualityConfigSnapshot();
    expect(snap).not.toHaveProperty('observedRecallEnabled');
    expect(snap).not.toHaveProperty('nearPinyinEnabled');
  });
});
