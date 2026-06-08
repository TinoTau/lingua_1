import { describe, expect, it } from '@jest/globals';
import {
  alignVariantWindowText,
  buildFuzzyPinyinVariants,
  FUZZY_FUNCTION_SYLLABLES,
} from './fuzzy-pinyin-key-builder';

describe('buildFuzzyPinyinVariants', () => {
  it('钟贝少 → exact + trim_tail zhong|bei', () => {
    const variants = buildFuzzyPinyinVariants(['zhong', 'bei', 'shao']);
    const keys = variants.map((v) => v.syllables.join('|'));
    expect(keys).toContain('zhong|bei|shao');
    expect(keys).toContain('zhong|bei');
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it('有蓝美马分 → strip function syllable you', () => {
    expect(FUZZY_FUNCTION_SYLLABLES.has('you')).toBe(true);
    const variants = buildFuzzyPinyinVariants(['you', 'lan', 'mei', 'ma', 'fen']);
    const keys = variants.map((v) => v.syllables.join('|'));
    expect(keys).toContain('lan|mei|ma|fen');
  });

  it('2 syllables → exact only', () => {
    const variants = buildFuzzyPinyinVariants(['zhong', 'bei']);
    expect(variants).toHaveLength(1);
    expect(variants[0]!.kind).toBe('exact');
  });
});

describe('alignVariantWindowText', () => {
  it('trim_tail keeps prefix chars', () => {
    const variants = buildFuzzyPinyinVariants(['zhong', 'bei', 'shao']);
    const tail = variants.find((v) => v.kind === 'trim_tail')!;
    expect(alignVariantWindowText('钟贝少', tail)).toBe('钟贝');
  });
});
