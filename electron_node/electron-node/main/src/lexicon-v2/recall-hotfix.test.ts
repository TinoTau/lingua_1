import { describe, expect, it } from '@jest/globals';
import { getLexiconRuntimeV2MergeCap } from './lexicon-runtime-v2-config';

describe('P3 hotfix merge cap defaults', () => {
  it('default merge cap is base(2)+domain(3)=5', () => {
    expect(getLexiconRuntimeV2MergeCap()).toBe(5);
  });
});
