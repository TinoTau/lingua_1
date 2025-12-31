/* S2: CandidateProvider 单元测试 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { CandidateProvider, CandidateProviderContext } from './candidate-provider';
import { SecondaryDecodeWorker, SecondaryDecodeResult } from './secondary-decode-worker';
import { ASRTask, ASRResult } from '../task-router/types';
import { AudioRef } from './audio-ring-buffer';

// Mock SecondaryDecodeWorker
class MockSecondaryDecodeWorker {
  canDecodeResult: boolean = true;
  decodeResult: SecondaryDecodeResult | null = {
    text: 'secondary decode result',
    score: 0.95,
    latencyMs: 100,
  };

  canDecode(): boolean {
    return this.canDecodeResult;
  }

  async decode(audioRef: any, task: ASRTask): Promise<SecondaryDecodeResult | null> {
    return this.decodeResult;
  }
}

describe('CandidateProvider', () => {
  let provider: CandidateProvider;
  let mockWorker: MockSecondaryDecodeWorker;

  beforeEach(() => {
    provider = new CandidateProvider();
    mockWorker = new MockSecondaryDecodeWorker();
  });

  describe('provide', () => {
    it('should return primary candidate only when no secondary decode', async () => {
      const ctx: CandidateProviderContext = {
        primaryText: 'primary text',
        primaryResult: {
          text: 'primary text',
          language: 'zh',
          language_probability: 0.90,
        },
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
          job_id: 'test_job',
        },
      };

      const result = await provider.provide(ctx);

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].text).toBe('primary text');
      expect(result.candidates[0].source).toBe('primary');
      expect(result.candidates[0].score).toBe(0.90);
      expect(result.source).toBe('none');
    });

    it('should return secondary decode candidate when conditions met', async () => {
      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };

      const ctx: CandidateProviderContext = {
        primaryText: 'primary text',
        primaryResult: {
          text: 'primary text',
          language: 'zh',
          language_probability: 0.90,
        },
        audioRef,
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
          job_id: 'test_job',
        },
        shouldUseSecondaryDecode: true,
        secondaryDecodeWorker: mockWorker as any,
      };

      const result = await provider.provide(ctx);

      expect(result.candidates.length).toBe(2);
      expect(result.candidates[0].source).toBe('primary');
      expect(result.candidates[1].source).toBe('secondary_decode');
      expect(result.candidates[1].text).toBe('secondary decode result');
      expect(result.candidates[1].score).toBe(0.95);
      expect(result.source).toBe('secondary_decode');
    });

    it('should skip secondary decode if shouldUseSecondaryDecode is false', async () => {
      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };

      const ctx: CandidateProviderContext = {
        primaryText: 'primary text',
        primaryResult: {
          text: 'primary text',
          language: 'zh',
          language_probability: 0.90,
        },
        audioRef,
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
          job_id: 'test_job',
        },
        shouldUseSecondaryDecode: false,  // 不启用二次解码
        secondaryDecodeWorker: mockWorker as any,
      };

      const result = await provider.provide(ctx);

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].source).toBe('primary');
      expect(result.source).toBe('none');
    });

    it('should skip secondary decode if no audio ref', async () => {
      const ctx: CandidateProviderContext = {
        primaryText: 'primary text',
        primaryResult: {
          text: 'primary text',
          language: 'zh',
          language_probability: 0.90,
        },
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
          job_id: 'test_job',
        },
        shouldUseSecondaryDecode: true,
        secondaryDecodeWorker: mockWorker as any,
        // 没有 audioRef
      };

      const result = await provider.provide(ctx);

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].source).toBe('primary');
      expect(result.source).toBe('none');
    });

    it('should skip secondary decode if worker cannot decode', async () => {
      mockWorker.canDecodeResult = false;  // 模拟worker不可用

      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };

      const ctx: CandidateProviderContext = {
        primaryText: 'primary text',
        primaryResult: {
          text: 'primary text',
          language: 'zh',
          language_probability: 0.90,
        },
        audioRef,
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
          job_id: 'test_job',
        },
        shouldUseSecondaryDecode: true,
        secondaryDecodeWorker: mockWorker as any,
      };

      const result = await provider.provide(ctx);

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].source).toBe('primary');
      expect(result.source).toBe('none');
    });

    it('should handle secondary decode failure gracefully', async () => {
      mockWorker.decodeResult = null;  // 模拟解码失败

      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };

      const ctx: CandidateProviderContext = {
        primaryText: 'primary text',
        primaryResult: {
          text: 'primary text',
          language: 'zh',
          language_probability: 0.90,
        },
        audioRef,
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
          job_id: 'test_job',
        },
        shouldUseSecondaryDecode: true,
        secondaryDecodeWorker: mockWorker as any,
      };

      const result = await provider.provide(ctx);

      // 应该降级使用primary
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].source).toBe('primary');
      expect(result.source).toBe('none');
    });

    it('should handle secondary decode error gracefully', async () => {
      // 创建一个会抛出错误的worker
      const errorWorker = {
        canDecode: () => true,
        decode: async () => {
          throw new Error('Decode error');
        },
      };

      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };

      const ctx: CandidateProviderContext = {
        primaryText: 'primary text',
        primaryResult: {
          text: 'primary text',
          language: 'zh',
          language_probability: 0.90,
        },
        audioRef,
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
          job_id: 'test_job',
        },
        shouldUseSecondaryDecode: true,
        secondaryDecodeWorker: errorWorker as any,
      };

      const result = await provider.provide(ctx);

      // 应该降级使用primary
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].source).toBe('primary');
      expect(result.source).toBe('none');
    });
  });

  describe('supportsNBest', () => {
    it('should return false (faster-whisper does not support N-best)', () => {
      expect(provider.supportsNBest()).toBe(false);
    });
  });

  describe('hasAudioRef', () => {
    it('should return true when audio ref exists', () => {
      const ctx: CandidateProviderContext = {
        primaryText: 'test',
        primaryResult: { text: 'test', language: 'zh' },
        audioRef: {
          audio: Buffer.from('test').toString('base64'),
        },
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
        },
      };

      expect(provider.hasAudioRef(ctx)).toBe(true);
    });

    it('should return false when audio ref is missing', () => {
      const ctx: CandidateProviderContext = {
        primaryText: 'test',
        primaryResult: { text: 'test', language: 'zh' },
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
        },
      };

      expect(provider.hasAudioRef(ctx)).toBe(false);
    });

    it('should return false when audio is empty', () => {
      const ctx: CandidateProviderContext = {
        primaryText: 'test',
        primaryResult: { text: 'test', language: 'zh' },
        audioRef: {
          audio: '',  // 空音频
        },
        task: {
          audio: '',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
        },
      };

      expect(provider.hasAudioRef(ctx)).toBe(false);
    });
  });
});

