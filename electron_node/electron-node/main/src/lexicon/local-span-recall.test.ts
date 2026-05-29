import { describe, expect, it } from '@jest/globals';
import type { LexiconRuntime } from './lexicon-runtime';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';
import { recallSpanTopK } from './local-span-recall';

describe('recallSpanTopK', () => {
  const runtime = {} as LexiconRuntime;
  const profile = defaultGeneralProfile();

  it('单音节 span 跳过 recall', () => {
    const r = recallSpanTopK(runtime, '热', profile, 3, 0.5, ['restaurant']);
    expect(r.hits).toEqual([]);
    expect(r.skippedReason).toBe('syllable_out_of_range');
  });

  it('空 span 跳过', () => {
    const r = recallSpanTopK(runtime, '  ', profile, 3, 0.5, ['restaurant']);
    expect(r.skippedReason).toBe('empty');
  });
});
