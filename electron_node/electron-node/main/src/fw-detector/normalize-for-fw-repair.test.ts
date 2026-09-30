import { describe, expect, it } from '@jest/globals';
import { normalizeForFwRepairInput } from './normalize-for-fw-repair';
import { resetOpenccConverterForTest } from './pinyin-ime-v2/normalize-for-ime-alignment';

describe('normalizeForFwRepairInput', () => {
  it('converts traditional CJK to simplified', () => {
    resetOpenccConverterForTest();
    const r = normalizeForFwRepairInput('點熱鐵');
    expect(r.repairText).toBe('点热铁');
    expect(r.scriptNormalized).toBe(true);
    expect(r.rawAsrText).toBe('點熱鐵');
  });

  it('is idempotent on simplified input', () => {
    resetOpenccConverterForTest();
    const once = normalizeForFwRepairInput('已经简化');
    const twice = normalizeForFwRepairInput(once.repairText);
    expect(twice.repairText).toBe('已经简化');
    expect(twice.scriptNormalized).toBe(false);
  });

  it('preserves ASCII letters and digits; NFKC may fold punctuation', () => {
    resetOpenccConverterForTest();
    const r = normalizeForFwRepairInput('Hello123，。');
    expect(r.repairText.includes('Hello123')).toBe(true);
    const twice = normalizeForFwRepairInput(r.repairText);
    expect(twice.repairText).toBe(r.repairText);
  });
});
