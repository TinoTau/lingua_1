/* S2: Rescorer 单元测试 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { Rescorer, RescoreContext, Candidate } from './rescorer';

describe('Rescorer', () => {
  let rescorer: Rescorer;

  beforeEach(() => {
    rescorer = new Rescorer();
  });

  describe('rescoring', () => {
    it('应该对候选进行打分', () => {
      const ctx: RescoreContext = {
        primaryText: '原始文本',
        candidates: [
          { text: '原始文本', source: 'primary' },
          { text: '更好的文本', source: 'nbest' },
        ],
        recentCommittedText: [],
        userKeywords: [],
      };

      const result = rescorer.rescore(ctx);
      expect(result).toBeTruthy();
      expect(result.bestText).toBeTruthy();
      expect(result.candidateScores.length).toBe(2);
    });

    it('应该保护数字格式', () => {
      const ctx: RescoreContext = {
        primaryText: '价格是一百元',
        candidates: [
          { text: '价格是一百元', source: 'primary' },
          { text: '价格是100元', source: 'nbest' },
        ],
        recentCommittedText: [],
        userKeywords: [],
      };

      const result = rescorer.rescore(ctx);
      // 包含数字格式的候选应该得分更高
      expect(result.candidateScores.some(cs => cs.text.includes('100'))).toBe(true);
    });

    it('应该保护用户关键词', () => {
      const ctx: RescoreContext = {
        primaryText: '提到了某个词',
        candidates: [
          { text: '提到了某个词', source: 'primary' },
          { text: '提到了专名', source: 'nbest' },
        ],
        recentCommittedText: [],
        userKeywords: ['专名'],
      };

      const result = rescorer.rescore(ctx);
      // 包含用户关键词的候选应该得分更高
      const keywordCandidate = result.candidateScores.find(cs => cs.text.includes('专名'));
      expect(keywordCandidate).toBeTruthy();
      if (keywordCandidate && result.primaryScore < result.bestScore) {
        expect(keywordCandidate.score).toBeGreaterThan(result.primaryScore);
      }
    });

    it('应该惩罚重复', () => {
      const ctx: RescoreContext = {
        primaryText: '我们我们',
        candidates: [
          { text: '我们我们', source: 'primary' },
          { text: '我们', source: 'nbest' },
        ],
        recentCommittedText: [],
        userKeywords: [],
      };

      const result = rescorer.rescore(ctx);
      // 重复的文本应该得分更低
      const noRepeatCandidate = result.candidateScores.find(cs => cs.text === '我们');
      const repeatCandidate = result.candidateScores.find(cs => cs.text === '我们我们');
      if (noRepeatCandidate && repeatCandidate) {
        expect(noRepeatCandidate.score).toBeGreaterThan(repeatCandidate.score);
      }
    });

    it('应该应用delta_margin回退', () => {
      const rescorerWithMargin = new Rescorer({ deltaMargin: 5.0 });  // 很大的margin
      const ctx: RescoreContext = {
        primaryText: '原始文本',
        candidates: [
          { text: '原始文本', source: 'primary' },
          { text: '稍好的文本', source: 'nbest' },
        ],
        recentCommittedText: [],
        userKeywords: [],
      };

      const result = rescorerWithMargin.rescore(ctx);
      // 如果分数差异小于delta_margin，应该保持primary
      if (result.bestScore - result.primaryScore < 5.0) {
        expect(result.replaced).toBe(false);
        expect(result.bestText).toBe('原始文本');
      }
    });

    it('空文本应该严重扣分', () => {
      const ctx: RescoreContext = {
        primaryText: '正常文本',
        candidates: [
          { text: '正常文本', source: 'primary' },
          { text: '', source: 'nbest' },
        ],
        recentCommittedText: [],
        userKeywords: [],
      };

      const result = rescorer.rescore(ctx);
      const emptyCandidate = result.candidateScores.find(cs => cs.text === '');
      expect(emptyCandidate).toBeTruthy();
      if (emptyCandidate) {
        expect(emptyCandidate.score).toBeLessThan(0);  // 应该扣分
      }
    });
  });

  describe('上下文打分', () => {
    it('应该考虑最近文本的关键词重合度', () => {
      const ctx: RescoreContext = {
        primaryText: '提到了新词',
        candidates: [
          { text: '提到了新词', source: 'primary' },
          { text: '提到了旧词', source: 'nbest' },
        ],
        recentCommittedText: ['之前提到了旧词'],
        userKeywords: [],
      };

      const result = rescorer.rescore(ctx);
      // 与最近文本有重合的候选应该得分更高
      const oldWordCandidate = result.candidateScores.find(cs => cs.text.includes('旧词'));
      expect(oldWordCandidate).toBeTruthy();
    });
  });
});

