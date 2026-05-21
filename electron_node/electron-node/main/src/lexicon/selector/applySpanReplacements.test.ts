import { applyReplacementsRightToLeft, spansOverlap } from './applySpanReplacements';

describe('spansOverlap', () => {
  it('detects overlap for half-open intervals', () => {
    expect(spansOverlap(0, 4, 2, 6)).toBe(true);
  });

  it('treats touching spans as non-overlap', () => {
    expect(spansOverlap(0, 4, 4, 8)).toBe(false);
  });
});

describe('applyReplacementsRightToLeft', () => {
  it('applies multiple replacements without offset drift', () => {
    const original = '今天我们讨论后选生城和上线计化流程安排';
    const result = applyReplacementsRightToLeft(original, [
      { start: 6, end: 10, to: '候选生成' },
      { start: 11, end: 15, to: '上线计划' },
    ]);
    expect(result).toBe('今天我们讨论候选生成和上线计划流程安排');
  });
});
