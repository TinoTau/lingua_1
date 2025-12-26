/**
 * 单元测试：P0.5-SH-1 坏段触发条件封装
 */

import { describe, it, expect } from '@jest/globals';
import { shouldTriggerRerun, getTop2LanguagesForRerun, RerunTriggerCondition } from '../../main/src/task-router/rerun-trigger';
import { ASRResult, ASRTask } from '../../main/src/task-router/types';

describe('RerunTrigger - P0.5-SH-1: 坏段触发条件封装', () => {
  describe('shouldTriggerRerun', () => {
    it('应该触发重跑：满足所有条件', () => {
      const asrResult: ASRResult = {
        text: '测试',
        language: 'zh',
        language_probability: 0.50, // < 0.60
        language_probabilities: {
          zh: 0.50,
          en: 0.30,
          ja: 0.20,
        },
        badSegmentDetection: {
          isBad: true,
          reasonCodes: ['LOW_LANGUAGE_CONFIDENCE_50%'],
          qualityScore: 0.3,
        },
      };

      const task: ASRTask = {
        audio: 'base64_audio',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'auto',
        rerun_count: 0,
        max_rerun_count: 2,
      };

      const audioDurationMs = 2000; // >= 1500ms

      const result = shouldTriggerRerun(asrResult, audioDurationMs, task);

      expect(result.shouldRerun).toBe(true);
      expect(result.reason).toBeDefined();
    });

    it('不应该触发重跑：语言置信度 >= 0.60', () => {
      const asrResult: ASRResult = {
        text: '测试',
        language: 'zh',
        language_probability: 0.70, // >= 0.60
        language_probabilities: {
          zh: 0.70,
          en: 0.30,
        },
        badSegmentDetection: {
          isBad: true,
          reasonCodes: ['OTHER'],
          qualityScore: 0.5,
        },
      };

      const task: ASRTask = {
        audio: 'base64_audio',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'auto',
        rerun_count: 0,
      };

      const result = shouldTriggerRerun(asrResult, 2000, task);

      expect(result.shouldRerun).toBe(false);
      expect(result.reason).toContain('Language probability too high');
    });

    it('不应该触发重跑：音频时长 < 1500ms', () => {
      const asrResult: ASRResult = {
        text: '测试',
        language: 'zh',
        language_probability: 0.50,
        language_probabilities: {
          zh: 0.50,
          en: 0.50,
        },
        badSegmentDetection: {
          isBad: true,
          reasonCodes: ['LOW_LANGUAGE_CONFIDENCE_50%'],
          qualityScore: 0.3,
        },
      };

      const task: ASRTask = {
        audio: 'base64_audio',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'auto',
        rerun_count: 0,
      };

      const audioDurationMs = 1000; // < 1500ms

      const result = shouldTriggerRerun(asrResult, audioDurationMs, task);

      expect(result.shouldRerun).toBe(false);
      expect(result.reason).toContain('Audio duration too short');
    });

    it('不应该触发重跑：重跑次数 >= max_rerun_count', () => {
      const asrResult: ASRResult = {
        text: '测试',
        language: 'zh',
        language_probability: 0.50,
        language_probabilities: {
          zh: 0.50,
          en: 0.50,
        },
        badSegmentDetection: {
          isBad: true,
          reasonCodes: ['LOW_LANGUAGE_CONFIDENCE_50%'],
          qualityScore: 0.3,
        },
      };

      const task: ASRTask = {
        audio: 'base64_audio',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'auto',
        rerun_count: 2, // >= max_rerun_count (2)
        max_rerun_count: 2,
      };

      const result = shouldTriggerRerun(asrResult, 2000, task);

      expect(result.shouldRerun).toBe(false);
      expect(result.reason).toContain('Rerun count exceeded');
    });

    it('不应该触发重跑：不是坏段', () => {
      const asrResult: ASRResult = {
        text: '测试文本',
        language: 'zh',
        language_probability: 0.50,
        language_probabilities: {
          zh: 0.50,
          en: 0.50,
        },
        badSegmentDetection: {
          isBad: false, // 不是坏段
          reasonCodes: [],
          qualityScore: 0.8,
        },
      };

      const task: ASRTask = {
        audio: 'base64_audio',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'auto',
        rerun_count: 0,
      };

      const result = shouldTriggerRerun(asrResult, 2000, task);

      expect(result.shouldRerun).toBe(false);
    });

    it('不应该触发重跑：language_probabilities 不足 2 个', () => {
      const asrResult: ASRResult = {
        text: '测试',
        language: 'zh',
        language_probability: 0.50,
        language_probabilities: {
          zh: 1.0, // 只有一个语言
        },
        badSegmentDetection: {
          isBad: true,
          reasonCodes: ['LOW_LANGUAGE_CONFIDENCE_50%'],
          qualityScore: 0.3,
        },
      };

      const task: ASRTask = {
        audio: 'base64_audio',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'auto',
        rerun_count: 0,
      };

      const result = shouldTriggerRerun(asrResult, 2000, task);

      expect(result.shouldRerun).toBe(false);
      expect(result.reason).toContain('Insufficient language probabilities');
    });
  });

  describe('getTop2LanguagesForRerun', () => {
    it('应该返回 Top-2 语言（排除当前语言）', () => {
      const languageProbabilities = {
        zh: 0.50,
        en: 0.30,
        ja: 0.20,
      };
      const currentLanguage = 'zh';

      const result = getTop2LanguagesForRerun(languageProbabilities, currentLanguage);

      expect(result).toEqual(['en', 'ja']); // 排除 zh，按概率排序
    });

    it('应该返回 Top-2 语言（当前语言不在 Top-2 中）', () => {
      const languageProbabilities = {
        zh: 0.20,
        en: 0.50,
        ja: 0.30,
      };
      const currentLanguage = 'zh';

      const result = getTop2LanguagesForRerun(languageProbabilities, currentLanguage);

      expect(result).toEqual(['en', 'ja']); // 排除 zh
    });

    it('应该处理没有当前语言的情况', () => {
      const languageProbabilities = {
        zh: 0.50,
        en: 0.30,
        ja: 0.20,
      };

      const result = getTop2LanguagesForRerun(languageProbabilities, undefined);

      expect(result).toEqual(['zh', 'en']); // 按概率排序
    });

    it('应该处理只有一个语言的情况', () => {
      const languageProbabilities = {
        zh: 1.0,
      };
      const currentLanguage = 'zh';

      const result = getTop2LanguagesForRerun(languageProbabilities, currentLanguage);

      expect(result).toEqual([]); // 排除当前语言后没有其他语言
    });
  });
});

