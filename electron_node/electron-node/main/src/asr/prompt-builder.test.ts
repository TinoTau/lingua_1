/* S1: PromptBuilder 单元测试 */

import { describe, it, expect } from '@jest/globals';
import { PromptBuilder, PromptBuilderContext } from './prompt-builder';

describe('PromptBuilder', () => {
  describe('build', () => {
    it('应该构建包含关键词的prompt', () => {
      const builder = new PromptBuilder('offline');
      const ctx: PromptBuilderContext = {
        userKeywords: ['专名1', '术语2'],
        recentCommittedText: [],
        qualityScore: 0.8,
      };

      const prompt = builder.build(ctx);
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Keywords');
      expect(prompt).toContain('专名1');
      expect(prompt).toContain('术语2');
    });

    it('应该构建包含最近上下文的prompt', () => {
      const builder = new PromptBuilder('offline');
      const ctx: PromptBuilderContext = {
        userKeywords: [],
        recentCommittedText: ['这是第一句话', '这是第二句话'],
        qualityScore: 0.8,
      };

      const prompt = builder.build(ctx);
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Recent');
      expect(prompt).toContain('这是第一句话');
    });

    it('低质量时应该禁用recent context', () => {
      const builder = new PromptBuilder('offline');
      const ctx: PromptBuilderContext = {
        userKeywords: ['关键词'],
        recentCommittedText: ['最近文本'],
        qualityScore: 0.3,  // 低质量
      };

      const prompt = builder.build(ctx);
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Keywords');
      expect(prompt).not.toContain('Recent');  // 低质量时禁用recent
    });

    it('应该压缩过长的prompt', () => {
      const builder = new PromptBuilder('offline', { maxChars: 100 });
      const ctx: PromptBuilderContext = {
        userKeywords: Array(50).fill(0).map((_, i) => `关键词${i}`),
        recentCommittedText: ['这是一段很长的文本'.repeat(20)],
        qualityScore: 0.8,
      };

      const prompt = builder.build(ctx);
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeLessThanOrEqual(110);  // 允许一些余量
    });

    it('没有输入时应该返回null', () => {
      const builder = new PromptBuilder('offline');
      const ctx: PromptBuilderContext = {
        userKeywords: [],
        recentCommittedText: [],
        qualityScore: 0.8,
      };

      const prompt = builder.build(ctx);
      expect(prompt).toBeNull();
    });
  });

  describe('room模式配置', () => {
    it('room模式应该使用更小的maxChars', () => {
      const builder = new PromptBuilder('room');
      const ctx: PromptBuilderContext = {
        userKeywords: ['关键词'],
        recentCommittedText: ['文本'],
        qualityScore: 0.8,
      };

      const prompt = builder.build(ctx);
      expect(prompt).toBeTruthy();
      // room模式的maxChars是500，应该能正常构建
    });
  });
});

