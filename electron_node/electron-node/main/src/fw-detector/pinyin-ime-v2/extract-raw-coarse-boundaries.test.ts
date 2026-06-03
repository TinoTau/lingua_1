import { describe, expect, it } from '@jest/globals';
import { extractRawCoarseBoundaries } from './extract-raw-coarse-boundaries';

describe('extractRawCoarseBoundaries', () => {
  it('returns cjk_run for contiguous Chinese', () => {
    const bounds = extractRawCoarseBoundaries('你好世界');
    expect(bounds.some((b) => b.kind === 'cjk_run' && b.start === 0 && b.end === 4)).toBe(true);
  });

  it('detects punctuation boundary', () => {
    const bounds = extractRawCoarseBoundaries('你好，世界');
    expect(bounds.some((b) => b.kind === 'punctuation')).toBe(true);
  });
});
