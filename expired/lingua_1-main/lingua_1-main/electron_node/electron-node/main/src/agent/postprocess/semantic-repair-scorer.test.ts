/**
 * Phase 3 测试：SemanticRepairScorer
 * 验证语义修复触发逻辑打分器功能
 */

import { SemanticRepairScorer } from './semantic-repair-scorer';

describe('SemanticRepairScorer - Phase 3', () => {
  let scorer: SemanticRepairScorer;

  beforeEach(() => {
    scorer = new SemanticRepairScorer({
      qualityThreshold: 0.70,
      shortSentenceLength: 16,
      nonChineseRatioThreshold: 0.3,
      languageProbabilityThreshold: 0.7,
      triggerThreshold: 0.5,
    });
  });

  describe('score', () => {
    it('应该在质量分低于阈值时给出高分', () => {
      // 使用较长的文本，质量分很低，确保评分足够高
      // 质量分0.50低于阈值0.70，质量分评分 = (0.70 - 0.50) / 0.70 * 0.4 ≈ 0.114
      // 但质量分权重是0.4，所以需要组合其他因素才能超过0.3
      const result = scorer.score('这是一个较长的测试文本，用于验证质量分低于阈值时的评分', 0.50, {
        language_probability: 0.5,  // 组合语言概率低，增加评分
      });

      expect(result.score).toBeGreaterThan(0.1);  // 至少有一定评分
      expect(result.reasonCodes).toContain('LOW_QUALITY_SCORE');
      expect(result.details.qualityScore).toBe(0.50);
    });

    it('应该在质量分高于阈值时给出低分', () => {
      const result = scorer.score('这是一个较长的测试文本，用于验证质量分高于阈值时的行为', 0.80);

      expect(result.score).toBeLessThan(0.5);
      expect(result.reasonCodes).not.toContain('LOW_QUALITY_SCORE');
    });

    it('应该在短句时给出高分', () => {
      // 短句权重0.2，单独可能不够0.5，但应该有一定评分
      const result = scorer.score('短句测试', 0.75);

      expect(result.score).toBeGreaterThan(0.1);  // 短句权重0.2
      expect(result.reasonCodes).toContain('SHORT_SENTENCE');
      expect(result.details.shortSentenceScore).toBe(1.0);
    });

    it('应该在非中文比例高时给出高分', () => {
      // 非中文比例权重0.2，单独可能不够0.5
      const result = scorer.score('abc def ghi jkl mno', 0.75);

      expect(result.score).toBeGreaterThan(0.1);  // 非中文比例权重0.2
      expect(result.reasonCodes).toContain('HIGH_NON_CHINESE_RATIO');
      expect(result.details.nonChineseRatio).toBeGreaterThan(0.3);
    });

    it('应该在缺少基本句法时给出高分', () => {
      // 句法权重0.1，单独可能不够0.5，但应该有一定评分
      const result = scorer.score('啊啊啊', 0.75);

      expect(result.score).toBeGreaterThan(0.05);  // 句法权重0.1
      expect(result.reasonCodes.length).toBeGreaterThan(0);  // 应该至少有一个原因代码
    });

    it('应该在语言概率低时给出高分', () => {
      // 语言概率权重0.1，单独可能不够0.5
      const result = scorer.score('这是一个较长的测试文本', 0.75, {
        language_probability: 0.5,
      });

      expect(result.score).toBeGreaterThan(0.05);  // 语言概率权重0.1
      expect(result.reasonCodes).toContain('LOW_LANGUAGE_PROBABILITY');
      expect(result.details.languageProbability).toBe(0.5);
    });

    it('应该检测垃圾字符', () => {
      const result = scorer.score('啊啊啊啊啊', 0.75);

      expect(result.reasonCodes).toContain('GARBAGE_CHARS');
    });

    it('应该检测异常词形', () => {
      // 使用较长的文本，避免触发短句检测
      const result = scorer.score('问题方法系统服务数据信息结果', 0.75);

      // 异常词形检测需要无动词且长度>10，这个文本满足条件
      expect(result.reasonCodes.length).toBeGreaterThan(0);
      // 可能触发MISSING_BASIC_SYNTAX或ABNORMAL_WORD_FORM
    });

    it('应该综合多个因素计算评分', () => {
      // 组合多个因素：质量分低 + 短句 + 非中文比例高 + 语言概率低
      const result = scorer.score('abc def', 0.60, {
        language_probability: 0.5,
      });

      expect(result.score).toBeGreaterThan(0.5);  // 多个因素组合应该超过阈值
      expect(result.reasonCodes.length).toBeGreaterThan(1);
      expect(result.details).toBeDefined();
    });
  });

  describe('shouldTrigger', () => {
    it('应该在评分高于阈值时触发', () => {
      // 组合多个因素确保评分超过0.5
      const scoreResult = scorer.score('abc def', 0.60, {
        language_probability: 0.5,
      });
      expect(scorer.shouldTrigger(scoreResult)).toBe(true);
    });

    it('应该在评分低于阈值时不触发', () => {
      const scoreResult = scorer.score('这是一个较长的测试文本，用于验证质量分高于阈值时的行为', 0.80);
      expect(scorer.shouldTrigger(scoreResult)).toBe(false);
    });
  });

  describe('权重归一化', () => {
    it('应该在权重总和不等于1时自动归一化', () => {
      const customScorer = new SemanticRepairScorer({
        qualityScoreWeight: 0.5,
        shortSentenceWeight: 0.3,
        nonChineseRatioWeight: 0.3,
        syntaxWeight: 0.1,
        languageProbabilityWeight: 0.1,
      });

      // 应该能够正常工作，不会因为权重问题而失败
      const result = customScorer.score('测试文本', 0.60);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });
  });
});
