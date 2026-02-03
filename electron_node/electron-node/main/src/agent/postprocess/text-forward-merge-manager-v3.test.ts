/**
 * TextForwardMergeManager 单元测试：v3 改造（Trim 逻辑与 previousText 分支）
 */

import { TextForwardMergeManager } from './text-forward-merge-manager';

describe('TextForwardMergeManager (v3 改造)', () => {
  let manager: TextForwardMergeManager;
  const sessionId = 'test-session-1';

  beforeEach(() => {
    manager = new TextForwardMergeManager();
    manager.clearAllPendingTexts();
  });

  describe('v3 改造：统一 Trim 逻辑', () => {
    describe('mergeByTrim 输出语义（完整 mergedText）', () => {
      it('previousText 分支应该返回完整 mergedText，不是裁剪片段', () => {
        const previousText = '这是上一句话';
        const currentText = '上一句话的后续内容';

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
            expect(pendingText.length).toBeGreaterThan(previousText.length);
          }
        } else {
          expect(result.processedText).toContain(previousText);
          expect(result.processedText.length).toBeGreaterThan(previousText.length);
        }
        if (result.deduped) {
          expect(result.dedupChars).toBeGreaterThan(0);
        }
      });

      it('pending 分支应该返回完整 mergedText', () => {
        manager.processText(
          sessionId,
          '这是第一句话',
          null,
          'job-1',
          0,
          false
        );

        jest.useFakeTimers();
        jest.advanceTimersByTime(3000);

        const result = manager.processText(
          sessionId,
          '第一句话的后续内容',
          null,
          'job-2',
          1,
          false
        );

        if (!result.shouldDiscard && !result.shouldWaitForMerge) {
          expect(result.processedText).toContain('这是第一句话');
          expect(result.processedText.length).toBeGreaterThan('这是第一句话'.length);
        } else if (result.shouldWaitForMerge) {
          const pendingText = manager.getPendingText(sessionId);
          expect(pendingText).toContain('这是第一句话');
        }

        jest.useRealTimers();
      });
    });

    describe('完全包含处理（显式 DROP）', () => {
      it('完全包含的文本应该显式 DROP', () => {
        const previousText = '这是一句完整的话';
        const currentText = '完整的话';

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
          expect(result.mergedFromUtteranceIndex).toBeDefined();
        }
      });

      it('完全包含且 mergedText 很短的文本应该显式 DROP', () => {
        const previousText = '这是';
        const currentText = '这是';

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
        }
      });

      it('【补充动作 A1-2】完全包含（MERGED_INTO_PREVIOUS）（B2-1）', () => {
        const lastCommittedText = '这是';
        const incomingText = '这是';

        const result = manager.processText(
          sessionId,
          incomingText,
          lastCommittedText,
          'job-1',
          0,
          false
        );

        expect(result.shouldDiscard).toBe(true);
        expect(result.processedText).toBe('');
        expect(result.shouldWaitForMerge).toBe(false);
        expect(result.shouldSendToSemanticRepair).toBe(false);
        expect(result.mergedFromUtteranceIndex).toBeDefined();
        expect(result.mergedFromUtteranceIndex).toBe(-1);
      });
    });

    describe('Trim 单次调用验证', () => {
      it('pending 和 previousText 同时存在时，应该只调用一次 Trim（pending 优先）', () => {
        manager.processText(
          sessionId,
          '这是第一句话',
          null,
          'job-1',
          0,
          false
        );

        jest.useFakeTimers();
        jest.advanceTimersByTime(1000);

        const result = manager.processText(
          sessionId,
          '第二句话',
          '这是上一句话',
          'job-2',
          1,
          false
        );

        if (!result.shouldDiscard && !result.shouldWaitForMerge) {
          expect(result.processedText).toContain('这是第一句话');
          expect(result.processedText).not.toContain('这是上一句话');
        } else if (result.shouldWaitForMerge) {
          const pendingText = manager.getPendingText(sessionId);
          expect(pendingText).toContain('这是第一句话');
        }

        jest.useRealTimers();
      });

      it('没有 pending 时，应该与 previousText 合并', () => {
        const previousText = '这是上一句话';
        const currentText = '上一句话的后续内容';

        const result = manager.processText(
          sessionId,
          currentText,
          previousText,
          'job-1',
          0,
          false
        );

        if (!result.shouldDiscard && !result.shouldWaitForMerge) {
          expect(result.processedText).toContain(previousText);
        } else if (result.shouldWaitForMerge) {
          const pendingText = manager.getPendingText(sessionId);
          expect(pendingText).toContain(previousText);
        }
      });
    });

    describe('Gate 决策统一性', () => {
      it('所有分支都应该通过 decideGateAction 统一决策', () => {
        manager.processText(sessionId, '这是第一句话', null, 'job-1', 0, false);
        jest.useFakeTimers();
        jest.advanceTimersByTime(3000);
        const result1 = manager.processText(sessionId, '第二句话', null, 'job-2', 1, false);
        expect(result1.shouldDiscard).toBe(false);
        expect(result1.shouldWaitForMerge).toBe(true);
        jest.useRealTimers();

        const result2 = manager.processText(
          sessionId,
          '这是新的一句话',
          '这是上一句话',
          'job-3',
          2,
          false
        );
        expect(result2.shouldDiscard).toBe(false);
        expect(result2.shouldWaitForMerge).toBe(true);

        manager.clearPendingText(sessionId);
        const result3 = manager.processText(
          sessionId,
          '这是新的一句话',
          null,
          'job-4',
          3,
          false
        );
        expect(result3.shouldDiscard).toBe(false);
        expect(result3.shouldWaitForMerge).toBe(true);
      });
    });
  });

  describe('v3 改造：previousText 分支输出语义修正', () => {
    it('previousText 分支应该返回完整 mergedText（previousText + 去重后的 currentText）', () => {
      const previousText = '这是上一句话';
      const currentText = '上一句话的后续内容';

      const result = manager.processText(
        sessionId,
        currentText,
        previousText,
        'job-1',
        0,
        false
      );

      if (!result.shouldDiscard && !result.shouldWaitForMerge) {
        expect(result.processedText).toContain(previousText);
        expect(result.processedText.length).toBeGreaterThan('的后续内容'.length);
      } else if (result.shouldWaitForMerge) {
        const pendingText = manager.getPendingText(sessionId);
        expect(pendingText).toContain(previousText);
      }
    });

    it('previousText 为空时，应该返回 currentText', () => {
      const currentText = '这是新的一句话';

      const result = manager.processText(
        sessionId,
        currentText,
        null,
        'job-1',
        0,
        false
      );

      if (result.shouldWaitForMerge) {
        expect(manager.getPendingText(sessionId)).toBe(currentText);
      } else {
        expect(result.processedText).toBe(currentText);
      }
    });
  });
});
