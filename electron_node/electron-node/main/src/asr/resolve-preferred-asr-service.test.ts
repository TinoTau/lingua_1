import { describe, expect, it } from '@jest/globals';
import { resolvePreferredAsrServiceId } from './resolve-preferred-asr-service';

describe('resolvePreferredAsrServiceId', () => {
  it('auto 无 LID 时强制 asr-sherpa-lm', () => {
    expect(resolvePreferredAsrServiceId(undefined)).toBe('asr-sherpa-lm');
  });

  it('zh / yue 走 asr-sherpa-lm', () => {
    expect(resolvePreferredAsrServiceId('zh')).toBe('asr-sherpa-lm');
    expect(resolvePreferredAsrServiceId('yue')).toBe('asr-sherpa-lm');
    expect(resolvePreferredAsrServiceId('zh-CN')).toBe('asr-sherpa-lm');
  });

  it('en 走 asr-sherpa-en', () => {
    expect(resolvePreferredAsrServiceId('en')).toBe('asr-sherpa-en');
  });

  it('其他语言不设偏好', () => {
    expect(resolvePreferredAsrServiceId('ja')).toBeUndefined();
  });
});
