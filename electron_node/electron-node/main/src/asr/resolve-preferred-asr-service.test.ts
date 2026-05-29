import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../fw-detector/fw-mode', () => ({
  isFwDetectorEngineEnabled: jest.fn(() => false),
}));

import { resolvePreferredAsrServiceId } from './resolve-preferred-asr-service';
import { isFwDetectorEngineEnabled } from '../fw-detector/fw-mode';

const mockFwEnabled = isFwDetectorEngineEnabled as jest.MockedFunction<
  typeof isFwDetectorEngineEnabled
>;

describe('resolvePreferredAsrServiceId', () => {
  it('FW 模式固定 faster-whisper-vad', () => {
    mockFwEnabled.mockReturnValue(true);
    expect(resolvePreferredAsrServiceId(undefined)).toBe('faster-whisper-vad');
    expect(resolvePreferredAsrServiceId('zh')).toBe('faster-whisper-vad');
    expect(resolvePreferredAsrServiceId('en')).toBe('faster-whisper-vad');
    mockFwEnabled.mockReturnValue(false);
  });

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
