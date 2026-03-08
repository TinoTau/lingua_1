/**
 * LID 入口校验单元测试（candidates 由调度下发，仅校验格式）
 */

import { validateLidCandidates, normalizeLidCandidates } from './lid-validate';

describe('validateLidCandidates', () => {
  it('接受长度为 2 的语言码数组（任意语种对）', () => {
    expect(() => validateLidCandidates(['fr', 'de'])).not.toThrow();
    expect(() => validateLidCandidates(['ja', 'ko'])).not.toThrow();
    expect(() => validateLidCandidates(['zh', 'en'])).not.toThrow();
    expect(() => validateLidCandidates(['en', 'zh'])).not.toThrow();
  });

  it('拒绝非数组', () => {
    expect(() => validateLidCandidates(null as any)).toThrow('LID_INVALID_CANDIDATES');
    expect(() => validateLidCandidates('zh,en' as any)).toThrow('LID_INVALID_CANDIDATES');
  });

  it('拒绝长度不为 2', () => {
    expect(() => validateLidCandidates(['zh'])).toThrow('LID_INVALID_CANDIDATES');
    expect(() => validateLidCandidates(['zh', 'en', 'ja'])).toThrow('LID_INVALID_CANDIDATES');
    expect(() => validateLidCandidates([])).toThrow('LID_INVALID_CANDIDATES');
  });

  it('拒绝非字符串或空字符串元素', () => {
    expect(() => validateLidCandidates([1, 'en'] as any)).toThrow('LID_INVALID_CANDIDATES');
    expect(() => validateLidCandidates(['', 'en'])).toThrow('LID_INVALID_CANDIDATES');
  });
});

describe('normalizeLidCandidates', () => {
  it('规范化为小写主语言码并保持顺序', () => {
    expect(normalizeLidCandidates(['fr-FR', 'de-DE'])).toEqual(['fr', 'de']);
    expect(normalizeLidCandidates(['zh-CN', 'en-US'])).toEqual(['zh', 'en']);
    expect(normalizeLidCandidates(['en', 'zh'])).toEqual(['en', 'zh']);
  });
});
