import { describe, expect, it } from '@jest/globals';
import { evaluateSpanDetectorHint } from './span-detector-hint';

describe('evaluateSpanDetectorHint', () => {
  it('2–5 音节 CJK span 产生 hint', () => {
    expect(evaluateSpanDetectorHint('美食').hasPinyinHint).toBe(true);
    expect(evaluateSpanDetectorHint('拿铁').hasPinyinHint).toBe(true);
    expect(evaluateSpanDetectorHint('蓝莓码份').hasPinyinHint).toBe(true);
  });

  it('单字或过长 span 不产生 hint', () => {
    expect(evaluateSpanDetectorHint('杯').hasPinyinHint).toBe(false);
    expect(evaluateSpanDetectorHint('一二三四五六').hasPinyinHint).toBe(false);
  });
});
