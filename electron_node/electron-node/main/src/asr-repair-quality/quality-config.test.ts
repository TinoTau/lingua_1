import { describe, it, expect } from '@jest/globals';
import { resolveAsrRepairQualityConfig, buildAsrRepairQualityConfigSnapshot } from './quality-config';

describe('asr-repair-quality quality-config', () => {
  it('defaults crossSegmentRecallEnabled to false', () => {
    const cfg = resolveAsrRepairQualityConfig(null);
    expect(cfg.crossSegmentRecallEnabled).toBe(false);
  });

  it('snapshot omits removed legacy recall flags', () => {
    const snap = buildAsrRepairQualityConfigSnapshot();
    expect(snap).not.toHaveProperty('observedRecallEnabled');
    expect(snap).not.toHaveProperty('nearPinyinEnabled');
  });
});
