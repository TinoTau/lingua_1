import { describe, expect, it } from '@jest/globals';
import {
  FORBIDDEN_WINDOW_CANDIDATE_SOURCES,
  isV3WindowCandidateSource,
  resolveWindowCandidateSource,
  V3_WINDOW_CANDIDATE_SOURCES,
} from './window-candidate-source';

describe('window-candidate-source', () => {
  it('allows V3 sources only', () => {
    for (const source of V3_WINDOW_CANDIDATE_SOURCES) {
      expect(isV3WindowCandidateSource(source)).toBe(true);
    }
    for (const forbidden of FORBIDDEN_WINDOW_CANDIDATE_SOURCES) {
      expect(isV3WindowCandidateSource(forbidden)).toBe(false);
    }
  });

  it('resolves alias vs canonical paths', () => {
    expect(resolveWindowCandidateSource({ viaPinyin: true })).toBe('lexicon_pinyin_topk');
    expect(resolveWindowCandidateSource({ viaPinyin: false })).toBe('canonical_exact');
    expect(resolveWindowCandidateSource({ matchedAlias: '别名', viaPinyin: true })).toBe('alias_pinyin');
    expect(resolveWindowCandidateSource({ matchedAlias: '别名', viaPinyin: false })).toBe('alias_exact');
  });
});
