/* S2: NeedRescoreDetector 单元测试 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { NeedRescoreDetector, NeedRescoreContext } from './need-rescore';

describe('NeedRescoreDetector', () => {
  let detector: NeedRescoreDetector;

  beforeEach(() => {
    detector = new NeedRescoreDetector();
  });

  describe('短句条件', () => {
    it('应该检测CJK短句', () => {
      const ctx: NeedRescoreContext = {
        commitText: '短句',
        mode: 'offline',
      };

      const result = detector.detect(ctx);
      expect(result.needRescore).toBe(true);
      expect(result.reasons).toContain('short_utterance');
    });

    it('应该检测EN短句', () => {
      const ctx: NeedRescoreContext = {
        commitText: 'short text',
        mode: 'offline',
      };

      const result = detector.detect(ctx);
      expect(result.needRescore).toBe(true);
      expect(result.reasons).toContain('short_utterance');
    });

    it('长句不应该触发', () => {
      const ctx: NeedRescoreContext = {
        commitText: '这是一段比较长的文本，应该不会触发短句条件',
        mode: 'offline',
      };

      const result = detector.detect(ctx);
      // 如果没有其他条件，不应该触发
      expect(result.needRescore).toBe(false);
    });
  });

  describe('低质量条件', () => {
    it('offline模式应该使用0.45阈值', () => {
      const ctx: NeedRescoreContext = {
        commitText: '测试文本',
        qualityScore: 0.4,  // 低于0.45
        mode: 'offline',
      };

      const result = detector.detect(ctx);
      expect(result.needRescore).toBe(true);
      expect(result.reasons).toContain('low_quality');
    });

    it('room模式应该使用0.50阈值', () => {
      const ctx: NeedRescoreContext = {
        commitText: '测试文本',
        qualityScore: 0.48,  // 低于0.50但高于0.45
        mode: 'room',
      };

      const result = detector.detect(ctx);
      expect(result.needRescore).toBe(true);
      expect(result.reasons).toContain('low_quality');
    });

    it('高质量不应该触发', () => {
      const ctx: NeedRescoreContext = {
        commitText: '测试文本',
        qualityScore: 0.8,
        mode: 'offline',
      };

      const result = detector.detect(ctx);
      expect(result.reasons).not.toContain('low_quality');
    });
  });

  describe('高风险特征', () => {
    it('应该检测数字', () => {
      const ctx: NeedRescoreContext = {
        commitText: '价格是100元',
        mode: 'offline',
      };

      const result = detector.detect(ctx);
      expect(result.needRescore).toBe(true);
      expect(result.reasons).toContain('risk_features');
    });

    it('应该检测用户关键词命中', () => {
      const ctx: NeedRescoreContext = {
        commitText: '提到了专名',
        userKeywords: ['专名'],
        mode: 'offline',
      };

      const result = detector.detect(ctx);
      expect(result.needRescore).toBe(true);
      expect(result.reasons).toContain('risk_features');
    });

    it('应该检测dedup异常', () => {
      const ctx: NeedRescoreContext = {
        commitText: '测试文本',
        dedupCharsRemoved: 15,  // 超过10
        mode: 'offline',
      };

      const result = detector.detect(ctx);
      expect(result.needRescore).toBe(true);
      expect(result.reasons).toContain('risk_features');
    });
  });

  describe('跳过条件', () => {
    it('长文本且高质量应该跳过', () => {
      const ctx: NeedRescoreContext = {
        commitText: '这是一段非常长的文本，包含了很多内容，应该不会触发rescoring',
        qualityScore: 0.9,
        mode: 'offline',
      };

      const result = detector.detect(ctx);
      expect(result.needRescore).toBe(false);
    });
  });
});

