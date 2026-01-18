/**
 * AggregatorStateContextManager 单元测试
 * 测试 getLastCommittedText 修复后的行为
 */

import { AggregatorStateContextManager, CommittedText } from '../main/src/aggregator/aggregator-state-context';

describe('AggregatorStateContextManager', () => {
  let contextManager: AggregatorStateContextManager;

  beforeEach(() => {
    contextManager = new AggregatorStateContextManager();
  });

  describe('getLastCommittedText', () => {
    it('应该返回null当没有已提交的文本时', () => {
      const result = contextManager.getLastCommittedText(1);
      expect(result).toBeNull();
    });

    it('应该返回null当当前是第一个utterance时', () => {
      contextManager.updateLastCommittedText(1, '原始文本', '修复后的文本1');
      const result = contextManager.getLastCommittedText(1);
      expect(result).toBeNull();
    });

    it('应该返回上一个utterance的文本', () => {
      contextManager.updateLastCommittedText(1, '原始文本1', '修复后的文本1');
      contextManager.updateLastCommittedText(2, '原始文本2', '修复后的文本2');
      
      const result = contextManager.getLastCommittedText(2);
      expect(result).toBe('修复后的文本1');
    });

    it('应该返回最近的上一个utterance的文本（跳过相同utteranceIndex）', () => {
      contextManager.updateLastCommittedText(1, '原始文本1', '修复后的文本1');
      contextManager.updateLastCommittedText(2, '原始文本2', '修复后的文本2');
      contextManager.updateLastCommittedText(4, '原始文本4', '修复后的文本4');
      
      const result = contextManager.getLastCommittedText(4);
      expect(result).toBe('修复后的文本2');
    });

    it('场景1：Job4为完整长句，Job7为其短片段 - 应该返回Job4的文本', () => {
      // Job 4: 完整长句（80字符）
      contextManager.updateLastCommittedText(
        4,
        '如果10秒同之后系统会不会因为超时或者进行判定而强行把这句话阶段从而导致前 判聚和后半聚在阶点端被拆',
        '如果10秒之后系统会不会因为超时或者进行判定而强行把这句话阶段从而导致前判聚和后半聚在阶点端被拆成两个不同的任务甚至出现上与意义上的不完整躲起来前后不连关的情况'
      );
      
      // Job 7: 短片段（6字符），是Job 4的一部分
      const result = contextManager.getLastCommittedText(7);
      
      // 应该返回Job 4的文本，而不是跳过它
      expect(result).toBe('如果10秒之后系统会不会因为超时或者进行判定而强行把这句话阶段从而导致前判聚和后半聚在阶点端被拆成两个不同的任务甚至出现上与意义上的不完整躲起来前后不连关的情况');
    });

    it('场景2：只有一条历史文本 - 应该永远使用那条文本作为context', () => {
      contextManager.updateLastCommittedText(1, '原始文本', '修复后的文本1');
      
      const result1 = contextManager.getLastCommittedText(2);
      expect(result1).toBe('修复后的文本1');
      
      const result2 = contextManager.getLastCommittedText(3);
      expect(result2).toBe('修复后的文本1');
      
      const result3 = contextManager.getLastCommittedText(10);
      expect(result3).toBe('修复后的文本1');
    });

    it('场景3：当前job为第一句 - 应该返回null', () => {
      contextManager.updateLastCommittedText(1, '原始文本', '修复后的文本1');
      
      const result = contextManager.getLastCommittedText(1);
      expect(result).toBeNull();
    });

    it('应该按utteranceIndex顺序选择，不关心文本内容', () => {
      // 添加多个文本，其中一些包含关系
      contextManager.updateLastCommittedText(1, '原始文本1', '短文本');
      contextManager.updateLastCommittedText(2, '原始文本2', '这是一个包含短文本的长文本');
      contextManager.updateLastCommittedText(3, '原始文本3', '另一个文本');
      
      // 即使当前文本是历史文本的子串，也应该返回最近的上一个文本
      const result = contextManager.getLastCommittedText(3);
      expect(result).toBe('这是一个包含短文本的长文本');
    });

    it('应该处理utteranceIndex不连续的情况', () => {
      contextManager.updateLastCommittedText(1, '原始文本1', '文本1');
      contextManager.updateLastCommittedText(5, '原始文本5', '文本5');
      contextManager.updateLastCommittedText(10, '原始文本10', '文本10');
      
      const result = contextManager.getLastCommittedText(10);
      expect(result).toBe('文本5');
    });

    it('应该更新相同utteranceIndex的文本', () => {
      contextManager.updateLastCommittedText(1, '原始文本1', '修复后的文本1');
      contextManager.updateLastCommittedText(1, '原始文本1', '再次修复后的文本1');
      
      const result = contextManager.getLastCommittedText(2);
      expect(result).toBe('再次修复后的文本1');
    });
  });

  describe('updateRecentCommittedText', () => {
    it('应该按utteranceIndex排序', () => {
      contextManager.updateRecentCommittedText('文本3', 3);
      contextManager.updateRecentCommittedText('文本1', 1);
      contextManager.updateRecentCommittedText('文本2', 2);
      
      const allTexts = contextManager.getAllCommittedTexts();
      expect(allTexts[0].utteranceIndex).toBe(1);
      expect(allTexts[1].utteranceIndex).toBe(2);
      expect(allTexts[2].utteranceIndex).toBe(3);
    });

    it('应该限制最多MAX_RECENT_COMMITS条', () => {
      for (let i = 0; i < 15; i++) {
        contextManager.updateRecentCommittedText(`文本${i}`, i);
      }
      
      const allTexts = contextManager.getAllCommittedTexts();
      expect(allTexts.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getRecentCommittedText', () => {
    it('应该返回文本数组，用于关键词提取', () => {
      contextManager.updateLastCommittedText(1, '原始文本1', '修复后的文本1');
      contextManager.updateLastCommittedText(2, '原始文本2', '修复后的文本2');
      
      const texts = contextManager.getRecentCommittedText();
      expect(texts).toEqual(['修复后的文本1', '修复后的文本2']);
    });
  });
});
