/**
 * TextForwardMergeManager 单元测试：utterance 流程完整性
 */

import { TextForwardMergeManager } from './text-forward-merge-manager';

describe('TextForwardMergeManager (utterance 流程完整性)', () => {
  let manager: TextForwardMergeManager;
  const sessionId = 'test-session-1';

  beforeEach(() => {
    manager = new TextForwardMergeManager();
    manager.clearAllPendingTexts();
  });

  describe('utterance 流程完整性', () => {
    it('应该正确处理完整的 utterance 流程：短文本 -> 中等文本 -> 合并', () => {
      const result1 = manager.processText(
        sessionId,
        '你好',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldDiscard).toBe(true);

      const result2 = manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-2',
        1,
        false
      );
      expect(result2.shouldWaitForMerge).toBe(true);
      expect(manager.getPendingText(sessionId)).toBe('这是第一句话');

      const result3 = manager.processText(
        sessionId,
        '这是第二句话',
        null,
        'job-3',
        2,
        false
      );
      expect(result3.shouldWaitForMerge).toBe(true);
      expect(typeof result3.deduped).toBe('boolean');
    });

    it('应该正确处理完整的 utterance 流程：中等文本 -> 超时 -> 发送', () => {
      const result1 = manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldWaitForMerge).toBe(true);

      jest.useFakeTimers();
      jest.advanceTimersByTime(3000);

      const result2 = manager.processText(
        sessionId,
        '',
        null,
        'job-2',
        1,
        false
      );
      expect(result2.shouldWaitForMerge).toBe(false);
      expect(result2.shouldSendToSemanticRepair).toBe(false);
      expect(result2.processedText).toBe('');
      expect(result2.shouldDiscard).toBe(true);

      jest.useRealTimers();
    });

    it('应该正确处理完整的 utterance 流程：中等文本 -> 手动发送', () => {
      const result1 = manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldWaitForMerge).toBe(true);

      const result2 = manager.processText(
        sessionId,
        '这是第二句话',
        null,
        'job-2',
        1,
        true
      );
      expect(result2.shouldWaitForMerge).toBe(false);
      expect(result2.shouldSendToSemanticRepair).toBe(true);
      expect(result2.processedText.length).toBeGreaterThan(0);
      expect(result2.processedText).toContain('这是第一句话');
    });

    it('应该正确处理去重逻辑', () => {
      const result1 = manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldWaitForMerge).toBe(true);

      const result2 = manager.processText(
        sessionId,
        '第一句话的后续内容',
        null,
        'job-2',
        1,
        false
      );
      expect(result2.deduped).toBe(true);
      expect(result2.processedText).toBe('');
      expect(result2.shouldWaitForMerge).toBe(true);
    });

    it('应该正确处理 previousText 去重', () => {
      const previousText = '这是第一句话';
      const currentText = '这是第一句话';

      const result = manager.processText(
        sessionId,
        currentText,
        previousText,
        'job-1',
        0,
        false
      );

      if (result.shouldDiscard) {
        expect(result.processedText).toBe('');
      } else if (result.shouldWaitForMerge) {
        const pendingText = manager.getPendingText(sessionId);
        if (pendingText) {
          expect(pendingText).toContain(previousText);
        }
      } else {
        expect(result.processedText).toContain(previousText);
      }
      expect(result.deduped).toBe(true);
    });

    it('应该正确处理多个会话的独立状态', () => {
      const sessionId2 = 'test-session-2';

      const result1 = manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldWaitForMerge).toBe(true);

      const result2 = manager.processText(
        sessionId2,
        '这是第二句话',
        null,
        'job-2',
        0,
        false
      );
      expect(result2.shouldWaitForMerge).toBe(true);

      expect(manager.getPendingText(sessionId)).toBe('这是第一句话');
      expect(manager.getPendingText(sessionId2)).toBe('这是第二句话');
    });

    it('应该正确清除待合并的文本', () => {
      manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(manager.getPendingText(sessionId)).toBe('这是第一句话');

      manager.clearPendingText(sessionId);
      expect(manager.getPendingText(sessionId)).toBeNull();
    });
  });
});
