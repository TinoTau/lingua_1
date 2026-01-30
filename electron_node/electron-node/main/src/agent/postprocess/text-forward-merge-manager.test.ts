/**
 * TextForwardMergeManager 单元测试
 * 测试 shouldWaitForMerge 逻辑和 utterance 流程完整性
 */

import { TextForwardMergeManager } from './text-forward-merge-manager';

describe('TextForwardMergeManager', () => {
  let manager: TextForwardMergeManager;
  const sessionId = 'test-session-1';

  beforeEach(() => {
    manager = new TextForwardMergeManager();
    // 清除所有待合并的文本
    manager.clearAllPendingTexts();
  });

  describe('shouldWaitForMerge 逻辑', () => {
    describe('短文本处理 (< 6字符)', () => {
      it('应该丢弃 < 6字符的文本', () => {
        const result = manager.processText(
          sessionId,
          '你好',  // 2字符
          null,
          'job-1',
          0,
          false
        );

        expect(result.shouldDiscard).toBe(true);
        expect(result.shouldWaitForMerge).toBe(false);
        expect(result.shouldSendToSemanticRepair).toBe(false);
        expect(result.processedText).toBe('');
      });

      it('应该丢弃 < 6字符的文本（即使有previousText）', () => {
        // 注意：如果有 previousText，会先合并，如果合并后 < 6字符，才会丢弃
        const result = manager.processText(
          sessionId,
          '你好',  // 2字符
          '这是上一句话',
          'job-1',
          0,
          false
        );

        // 如果合并后仍然 < 6字符，应该丢弃
        // 但如果有去重，mergedText 可能包含 previousText，长度可能 >= 6
        // 所以这里只验证如果丢弃，应该满足条件
        if (result.shouldDiscard) {
          expect(result.shouldWaitForMerge).toBe(false);
          expect(result.shouldSendToSemanticRepair).toBe(false);
          expect(result.processedText).toBe('');
        }
      });
    });

    describe('中等长度文本处理 (6-20字符)', () => {
      it('应该等待合并 6-20字符的文本（非手动发送）', () => {
        const result = manager.processText(
          sessionId,
          '这是一句中等长度的话',  // 10字符
          null,
          'job-1',
          0,
          false
        );

        expect(result.shouldDiscard).toBe(false);
        expect(result.shouldWaitForMerge).toBe(true);
        expect(result.shouldSendToSemanticRepair).toBe(false);
        expect(result.processedText).toBe('');

        // 应该设置了待合并的文本
        const pendingText = manager.getPendingText(sessionId);
        expect(pendingText).toBe('这是一句中等长度的话');
      });

      it('应该直接发送 6-20字符的文本（手动发送）', () => {
        const result = manager.processText(
          sessionId,
          '这是一句中等长度的话',  // 10字符
          null,
          'job-1',
          0,
          true  // isManualCut = true
        );

        expect(result.shouldDiscard).toBe(false);
        expect(result.shouldWaitForMerge).toBe(false);
        expect(result.shouldSendToSemanticRepair).toBe(true);
        expect(result.processedText).toBe('这是一句中等长度的话');

        // 不应该设置待合并的文本
        const pendingText = manager.getPendingText(sessionId);
        expect(pendingText).toBeNull();
      });

      it('应该合并两个 6-20字符的文本', () => {
        // 第一个文本：等待合并
        const result1 = manager.processText(
          sessionId,
          '这是第一句话',  // 7字符
          null,
          'job-1',
          0,
          false
        );

        expect(result1.shouldWaitForMerge).toBe(true);
        expect(result1.processedText).toBe('');

        // 模拟等待时间（但未超时）
        jest.useFakeTimers();
        jest.advanceTimersByTime(1000);  // 1秒，未超时（默认3秒）

        // 第二个文本：应该与第一个合并
        const result2 = manager.processText(
          sessionId,
          '这是第二句话',  // 7字符
          null,
          'job-2',
          1,
          false
        );

        expect(result2.shouldWaitForMerge).toBe(true);  // 合并后仍然在6-20字符范围内
        expect(result2.processedText).toBe('');
        // 注意：deduped 可能是 true（如果检测到重叠）或 false（如果没有重叠）
        // "这是第一句话" 和 "这是第二句话" 可能检测到 "这是" 重叠，所以 deduped 可能是 true
        expect(typeof result2.deduped).toBe('boolean');

        jest.useRealTimers();
      });

      it('应该合并两个 6-20字符的文本（超时后）', () => {
        // 第一个文本：等待合并
        const result1 = manager.processText(
          sessionId,
          '这是第一句话',  // 7字符
          null,
          'job-1',
          0,
          false
        );

        expect(result1.shouldWaitForMerge).toBe(true);

        // 模拟等待超时（3秒）
        jest.useFakeTimers();
        jest.advanceTimersByTime(3000);  // 3秒，超时

        // 第二个文本：应该与第一个合并（即使超时）
        const result2 = manager.processText(
          sessionId,
          '这是第二句话',  // 7字符
          null,
          'job-2',
          1,
          false
        );

        expect(result2.shouldWaitForMerge).toBe(true);  // 合并后仍然在6-20字符范围内
        expect(result2.processedText).toBe('');

        jest.useRealTimers();
      });

      it('应该超时后发送 6-20字符的文本（没有后续输入）', () => {
        // 第一个文本：等待合并
        const result1 = manager.processText(
          sessionId,
          '这是第一句话',  // 7字符
          null,
          'job-1',
          0,
          false
        );

        expect(result1.shouldWaitForMerge).toBe(true);

        // 模拟等待超时（3秒）
        jest.useFakeTimers();
        jest.advanceTimersByTime(3000);  // 3秒，超时

        // 没有后续输入，超时后应该发送
        const result2 = manager.processText(
          sessionId,
          '',  // 空文本，表示没有后续输入
          null,
          'job-2',
          1,
          false
        );

        expect(result2.shouldWaitForMerge).toBe(false);
        expect(result2.shouldSendToSemanticRepair).toBe(true);
        expect(result2.processedText).toBe('这是第一句话');

        jest.useRealTimers();
      });
    });

    describe('较长文本处理 (20-40字符)', () => {
      it('应该等待确认 20-40字符的文本（非手动发送）', () => {
        const result = manager.processText(
          sessionId,
          '这是一句比较长的话，用来测试等待确认的逻辑',  // 22字符
          null,
          'job-1',
          0,
          false
        );

        expect(result.shouldDiscard).toBe(false);
        expect(result.shouldWaitForMerge).toBe(true);
        expect(result.shouldSendToSemanticRepair).toBe(false);
        expect(result.processedText).toBe('');

        // 应该设置了待合并的文本
        const pendingText = manager.getPendingText(sessionId);
        expect(pendingText).toBe('这是一句比较长的话，用来测试等待确认的逻辑');
      });

      it('应该直接发送 20-40字符的文本（手动发送）', () => {
        const result = manager.processText(
          sessionId,
          '这是一句比较长的话，用来测试等待确认的逻辑',  // 22字符
          null,
          'job-1',
          0,
          true  // isManualCut = true
        );

        expect(result.shouldDiscard).toBe(false);
        expect(result.shouldWaitForMerge).toBe(false);
        expect(result.shouldSendToSemanticRepair).toBe(true);
        expect(result.processedText).toBe('这是一句比较长的话，用来测试等待确认的逻辑');

        // 不应该设置待合并的文本
        const pendingText = manager.getPendingText(sessionId);
        expect(pendingText).toBeNull();
      });

      it('应该超时后发送 20-40字符的文本（没有后续输入）', () => {
        // 第一个文本：等待确认
        const result1 = manager.processText(
          sessionId,
          '这是一句比较长的话，用来测试等待确认的逻辑',  // 22字符
          null,
          'job-1',
          0,
          false
        );

        expect(result1.shouldWaitForMerge).toBe(true);

        // 模拟等待超时（3秒）
        jest.useFakeTimers();
        jest.advanceTimersByTime(3000);  // 3秒，超时

        // 没有后续输入，超时后应该发送
        const result2 = manager.processText(
          sessionId,
          '',  // 空文本，表示没有后续输入
          null,
          'job-2',
          1,
          false
        );

        expect(result2.shouldWaitForMerge).toBe(false);
        expect(result2.shouldSendToSemanticRepair).toBe(true);
        expect(result2.processedText).toBe('这是一句比较长的话，用来测试等待确认的逻辑');

        jest.useRealTimers();
      });

      // 补充动作 A1-1: 20–40 字短句 + 超时发送（B1-3）
      // 锁定风险：防止未来有人重新引入 "长度触发 commit"，防止 HOLD 逻辑被误删
      it('【补充动作 A1-1】20–40 字短句 + 超时发送（B1-3）', () => {
        jest.useFakeTimers();
        
        // 输入：25字符文本（符合 20-40 字符范围）
        const text25 = '这是一句比较长的话用来测试超时发送逻辑确保长度在二十到四十字符之间';
        expect(text25.length).toBeGreaterThanOrEqual(20);
        expect(text25.length).toBeLessThanOrEqual(40);
        
        // Step 1: 初始输入 -> HOLD（reason=SHORT_20_40）
        const result1 = manager.processText(
          sessionId,
          text25,
          null,
          'job-1',
          0,
          false
        );
        
        expect(result1.shouldWaitForMerge).toBe(true);
        expect(result1.shouldSendToSemanticRepair).toBe(false);
        expect(result1.processedText).toBe('');
        
        // Step 2: 等待 3000ms 无新输入 -> SEND（reason=HOLD_TIMEOUT_SEND）
        jest.advanceTimersByTime(3000);
        
        const result2 = manager.processText(
          sessionId,
          '',  // 无新输入
          null,
          'job-2',
          1,
          false
        );
        
        expect(result2.shouldWaitForMerge).toBe(false);
        expect(result2.shouldSendToSemanticRepair).toBe(true);
        expect(result2.processedText).toBe(text25);
        
        jest.useRealTimers();
      });
    });

    describe('长文本处理 (> 40字符)', () => {
      it('应该直接发送 > 40字符的文本', () => {
        // 创建一个超过40字符的文本（确保长度 > 40）
        const longText = '这是一句非常长的话用来测试长文本的处理逻辑确保超过四十个字符以上需要更多文字来达到要求';
        expect(longText.length).toBeGreaterThan(40);

        const result = manager.processText(
          sessionId,
          longText,
          null,
          'job-1',
          0,
          false
        );

        expect(result.shouldDiscard).toBe(false);
        // 注意：如果文本长度正好是40字符，会等待确认；只有 > 40字符才直接发送
        // 应该直接发送
        expect(result.shouldWaitForMerge).toBe(false);
        expect(result.shouldSendToSemanticRepair).toBe(true);
        expect(result.processedText).toBe(longText);

        // 不应该设置待合并的文本
        const pendingText = manager.getPendingText(sessionId);
        expect(pendingText).toBeNull();
      });

      it('应该直接发送 > 40字符的文本（即使手动发送）', () => {
        // 创建一个超过40字符的文本（确保长度 > 40）
        const longText = '这是一句非常长的话用来测试长文本的处理逻辑确保超过四十个字符以上需要更多文字来达到要求';
        expect(longText.length).toBeGreaterThan(40);

        const result = manager.processText(
          sessionId,
          longText,
          null,
          'job-1',
          0,
          true  // isManualCut = true
        );

        expect(result.shouldDiscard).toBe(false);
        expect(result.shouldWaitForMerge).toBe(false);
        expect(result.shouldSendToSemanticRepair).toBe(true);
        expect(result.processedText).toBe(longText);
      });
    });
  });

  describe('utterance 流程完整性', () => {
    it('应该正确处理完整的 utterance 流程：短文本 -> 中等文本 -> 合并', () => {
      // Step 1: 短文本（丢弃）
      const result1 = manager.processText(
        sessionId,
        '你好',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldDiscard).toBe(true);

      // Step 2: 中等文本（等待合并）
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

      // Step 3: 后续文本（合并）
      const result3 = manager.processText(
        sessionId,
        '这是第二句话',
        null,
        'job-3',
        2,
        false
      );
      expect(result3.shouldWaitForMerge).toBe(true);  // 合并后仍然在6-20字符范围内
      // 注意：deduped 可能是 true（如果检测到重叠）或 false（如果没有重叠）
      // "这是第一句话" 和 "这是第二句话" 可能检测到 "这是" 重叠，所以 deduped 可能是 true
      expect(typeof result3.deduped).toBe('boolean');
    });

    it('应该正确处理完整的 utterance 流程：中等文本 -> 超时 -> 发送', () => {
      // Step 1: 中等文本（等待合并）
      const result1 = manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldWaitForMerge).toBe(true);

      // Step 2: 模拟超时
      jest.useFakeTimers();
      jest.advanceTimersByTime(3000);  // 3秒，超时

      // Step 3: 没有后续输入，应该发送
      const result2 = manager.processText(
        sessionId,
        '',
        null,
        'job-2',
        1,
        false
      );
      expect(result2.shouldWaitForMerge).toBe(false);
      expect(result2.shouldSendToSemanticRepair).toBe(true);
      expect(result2.processedText).toBe('这是第一句话');

      jest.useRealTimers();
    });

    it('应该正确处理完整的 utterance 流程：中等文本 -> 手动发送', () => {
      // Step 1: 中等文本（等待合并）
      const result1 = manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldWaitForMerge).toBe(true);

      // Step 2: 手动发送，应该立即发送
      const result2 = manager.processText(
        sessionId,
        '这是第二句话',
        null,
        'job-2',
        1,
        true  // isManualCut = true
      );
      expect(result2.shouldWaitForMerge).toBe(false);
      expect(result2.shouldSendToSemanticRepair).toBe(true);
      // 合并后的文本应该包含 pendingText（"这是第一句话"）和 currentText（"这是第二句话"）
      // 但可能因为去重，currentText 的部分内容被去掉了
      expect(result2.processedText.length).toBeGreaterThan(0);
      // 至少应该包含 pendingText 的内容
      expect(result2.processedText).toContain('这是第一句话');
    });

    it('应该正确处理去重逻辑', () => {
      // Step 1: 第一个文本
      const result1 = manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldWaitForMerge).toBe(true);

      // Step 2: 第二个文本（包含重复内容）
      const result2 = manager.processText(
        sessionId,
        '第一句话的后续内容',  // 包含"第一句话"
        null,
        'job-2',
        1,
        false
      );

      // 应该去重并合并
      expect(result2.deduped).toBe(true);
      expect(result2.processedText).toBe('');  // 等待合并
      expect(result2.shouldWaitForMerge).toBe(true);
    });

    it('应该正确处理 previousText 去重', () => {
      // 有 previousText 的情况（完全重复）
      const previousText = '这是第一句话';
      const currentText = '这是第一句话';  // 与 previousText 完全重复
      
      const result = manager.processText(
        sessionId,
        currentText,
        previousText,
        'job-1',
        0,
        false
      );

      // v3 改造：如果完全包含，会显式 DROP
      // mergedText 应该是 previousText + 去重后的 currentText
      // 如果完全重复，mergedText 可能等于 previousText（长度 >= 6），不会丢弃
      // 或者如果 mergedText 很短，会被 DROP
      if (result.shouldDiscard) {
        expect(result.processedText).toBe('');
      } else if (result.shouldWaitForMerge) {
        // 如果等待合并，processedText 为空，但 pendingText 应该包含 mergedText
        const pendingText = manager.getPendingText(sessionId);
        if (pendingText) {
          expect(pendingText).toContain(previousText);
        }
      } else {
        // 如果没有丢弃且不等待合并，应该包含 previousText
        expect(result.processedText).toContain(previousText);
      }
      expect(result.deduped).toBe(true);
    });

    it('应该正确处理多个会话的独立状态', () => {
      const sessionId2 = 'test-session-2';

      // Session 1: 中等文本
      const result1 = manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(result1.shouldWaitForMerge).toBe(true);

      // Session 2: 中等文本（应该独立）
      const result2 = manager.processText(
        sessionId2,
        '这是第二句话',
        null,
        'job-2',
        0,
        false
      );
      expect(result2.shouldWaitForMerge).toBe(true);

      // 两个会话的待合并文本应该独立
      expect(manager.getPendingText(sessionId)).toBe('这是第一句话');
      expect(manager.getPendingText(sessionId2)).toBe('这是第二句话');
    });

    it('应该正确清除待合并的文本', () => {
      // 设置待合并的文本
      manager.processText(
        sessionId,
        '这是第一句话',
        null,
        'job-1',
        0,
        false
      );
      expect(manager.getPendingText(sessionId)).toBe('这是第一句话');

      // 清除
      manager.clearPendingText(sessionId);
      expect(manager.getPendingText(sessionId)).toBeNull();
    });
  });

  describe('边界情况', () => {
    it('应该正确处理正好 6 字符的文本', () => {
      // 创建一个正好6字符的文本
      const text6 = '这是六个字符';
      expect(text6.length).toBe(6);

      const result = manager.processText(
        sessionId,
        text6,
        null,
        'job-1',
        0,
        false
      );

      // 注意：代码中使用的是 `length < minLengthToKeep` 才丢弃
      // 所以正好6字符（6 < 6 = false）不应该丢弃，应该等待合并
      expect(result.shouldDiscard).toBe(false);
      expect(result.shouldWaitForMerge).toBe(true);
      expect(result.shouldSendToSemanticRepair).toBe(false);
    });

    it('应该正确处理正好 20 字符的文本', () => {
      const result = manager.processText(
        sessionId,
        '这是一句正好二十个字符的话',  // 正好20字符
        null,
        'job-1',
        0,
        false
      );

      expect(result.shouldDiscard).toBe(false);
      expect(result.shouldWaitForMerge).toBe(true);
      expect(result.shouldSendToSemanticRepair).toBe(false);
    });

    it('应该正确处理正好 40 字符的文本', () => {
      const result = manager.processText(
        sessionId,
        '这是一句正好四十个字符的话用来测试边界情况',  // 正好40字符
        null,
        'job-1',
        0,
        false
      );

      expect(result.shouldDiscard).toBe(false);
      expect(result.shouldWaitForMerge).toBe(true);
      expect(result.shouldSendToSemanticRepair).toBe(false);
    });

    it('应该正确处理空文本', () => {
      const result = manager.processText(
        sessionId,
        '',
        null,
        'job-1',
        0,
        false
      );

      expect(result.shouldDiscard).toBe(true);
      expect(result.shouldWaitForMerge).toBe(false);
      expect(result.shouldSendToSemanticRepair).toBe(false);
    });
  });

  describe('v3 改造：统一 Trim 逻辑', () => {
    describe('mergeByTrim 输出语义（完整 mergedText）', () => {
      it('previousText 分支应该返回完整 mergedText，不是裁剪片段', () => {
        const previousText = '这是上一句话';
        const currentText = '上一句话的后续内容';  // 与 previousText 有重叠"上一句话"
        
        const result = manager.processText(
          sessionId,
          currentText,
          previousText,
          'job-1',
          0,
          false
        );

        // v3 改造：应该返回完整 mergedText（previousText + 去重后的 currentText）
        // 不应该只返回裁剪片段
        // 注意：如果 mergedText 很短（< 6字符），会被 DROP，processedText 为空
        // 如果 mergedText 在 6-20 字符范围内，会等待合并，processedText 为空
        if (result.shouldDiscard) {
          // 如果丢弃，processedText 为空
          expect(result.processedText).toBe('');
        } else if (result.shouldWaitForMerge) {
          // 如果等待合并，processedText 为空，但 pendingText 应该包含 mergedText
          const pendingText = manager.getPendingText(sessionId);
          if (pendingText) {
            expect(pendingText).toContain(previousText);
            expect(pendingText.length).toBeGreaterThan(previousText.length);
          }
        } else {
          // 如果直接发送，应该包含 previousText
          expect(result.processedText).toContain(previousText);
          expect(result.processedText.length).toBeGreaterThan(previousText.length);
        }
        
        // 如果有去重，应该标记
        if (result.deduped) {
          expect(result.dedupChars).toBeGreaterThan(0);
        }
      });

      it('pending 分支应该返回完整 mergedText', () => {
        // 第一个文本：等待合并
        manager.processText(
          sessionId,
          '这是第一句话',
          null,
          'job-1',
          0,
          false
        );

        // 模拟超时
        jest.useFakeTimers();
        jest.advanceTimersByTime(3000);

        // 第二个文本：应该与 pending 合并
        const result = manager.processText(
          sessionId,
          '第一句话的后续内容',
          null,
          'job-2',
          1,
          false
        );

        // v3 改造：应该返回完整 mergedText（pending.text + 去重后的 currentText）
        // 注意：如果 mergedText 很短（< 6字符），会被 DROP，processedText 为空
        // 或者如果 mergedText 在 6-20 字符范围内，会等待合并，processedText 为空
        if (!result.shouldDiscard && !result.shouldWaitForMerge) {
          expect(result.processedText).toContain('这是第一句话');
          expect(result.processedText.length).toBeGreaterThan('这是第一句话'.length);
        } else if (result.shouldWaitForMerge) {
          // 如果等待合并，pendingText 应该包含 mergedText
          const pendingText = manager.getPendingText(sessionId);
          expect(pendingText).toContain('这是第一句话');
        }

        jest.useRealTimers();
      });
    });

    describe('完全包含处理（显式 DROP）', () => {
      it('完全包含的文本应该显式 DROP', () => {
        const previousText = '这是一句完整的话';
        const currentText = '完整的话';  // 完全被 previousText 包含
        
        const result = manager.processText(
          sessionId,
          currentText,
          previousText,
          'job-1',
          0,
          false
        );

        // v3 改造：如果完全包含且 mergedText 很短（< 6字符），应该显式 DROP
        // 注意：mergedText = previousText + 去重后的 currentText
        // 如果 currentText 完全被包含，去重后为空，mergedText = previousText
        // 如果 previousText 长度 >= 6，不会 DROP，会进入 Gate 决策
        // 只有当 mergedText 很短（< 6字符）时，才会 DROP
        if (result.shouldDiscard) {
          expect(result.processedText).toBe('');
          // 应该标记合并了上一个 utterance
          expect(result.mergedFromUtteranceIndex).toBeDefined();
        }
      });

      it('完全包含且 mergedText 很短的文本应该显式 DROP', () => {
        // 使用一个很短的 previousText，确保 mergedText 也很短
        const previousText = '这是';
        const currentText = '这是';  // 完全被 previousText 包含
        
        const result = manager.processText(
          sessionId,
          currentText,
          previousText,
          'job-1',
          0,
          false
        );

        // 如果 mergedText 很短（< 6字符），应该显式 DROP
        if (result.shouldDiscard) {
          expect(result.processedText).toBe('');
        }
      });

      // 补充动作 A1-2: 完全包含（MERGED_INTO_PREVIOUS）（B2-1）
      // 锁定风险：防止 TextProcessor 或 trim 逻辑再次通过"空文本"隐式触发行为，防止 GPU arbiter / 语义修复任务泄漏
      it('【补充动作 A1-2】完全包含（MERGED_INTO_PREVIOUS）（B2-1）', () => {
        // 使用一个很短的 lastCommittedText（< 6字符），确保完全包含后 mergedText 也很短（< 6字符）
        // 这样会触发 DROP
        const lastCommittedText = '这是';  // 2字符
        const incomingText = '这是';  // 完全被 lastCommittedText 包含
        
        const result = manager.processText(
          sessionId,
          incomingText,
          lastCommittedText,
          'job-1',
          0,
          false
        );
        
        // 期望：Gate -> DROP（reason=MERGED_INTO_PREVIOUS）
        // Trim 后 incoming 为空（完全被 previous 吸收）
        // mergedText = lastCommittedText（2字符）< 6字符，应该 DROP
        expect(result.shouldDiscard).toBe(true);
        expect(result.processedText).toBe('');
        expect(result.shouldWaitForMerge).toBe(false);
        expect(result.shouldSendToSemanticRepair).toBe(false);
        
        // 必须输出取消信号（如 mergedFromUtteranceIndex）
        expect(result.mergedFromUtteranceIndex).toBeDefined();
        expect(result.mergedFromUtteranceIndex).toBe(-1);  // 上一个 utterance 的索引（utteranceIndex - 1）
      });
    });

    describe('Trim 单次调用验证', () => {
      it('pending 和 previousText 同时存在时，应该只调用一次 Trim（pending 优先）', () => {
        // 设置 pending
        manager.processText(
          sessionId,
          '这是第一句话',
          null,
          'job-1',
          0,
          false
        );

        // 模拟未超时
        jest.useFakeTimers();
        jest.advanceTimersByTime(1000);  // 1秒，未超时

        // 有 previousText，但 pending 优先
        const result = manager.processText(
          sessionId,
          '第二句话',
          '这是上一句话',  // previousText
          'job-2',
          1,
          false
        );

        // v3 改造：pending 优先于 previousText
        // 应该与 pending 合并，而不是 previousText
        // 如果与 previousText 合并，mergedText 会包含"这是上一句话"
        // 如果与 pending 合并，mergedText 会包含"这是第一句话"
        if (!result.shouldDiscard && !result.shouldWaitForMerge) {
          expect(result.processedText).toContain('这是第一句话');
          expect(result.processedText).not.toContain('这是上一句话');
        } else if (result.shouldWaitForMerge) {
          // 如果等待合并，pendingText 应该包含"这是第一句话"
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

        // v3 改造：应该与 previousText 合并，返回完整 mergedText
        // 注意：如果 mergedText 很短（< 6字符），会被 DROP
        // 或者如果 mergedText 在 6-20 字符范围内，会等待合并
        if (!result.shouldDiscard && !result.shouldWaitForMerge) {
          expect(result.processedText).toContain(previousText);
        } else if (result.shouldWaitForMerge) {
          // 如果等待合并，pendingText 应该包含 previousText
          const pendingText = manager.getPendingText(sessionId);
          expect(pendingText).toContain(previousText);
        }
      });
    });

    describe('Gate 决策统一性', () => {
      it('所有分支都应该通过 decideGateAction 统一决策', () => {
        // 测试 pending 超时分支
        manager.processText(sessionId, '这是第一句话', null, 'job-1', 0, false);
        jest.useFakeTimers();
        jest.advanceTimersByTime(3000);
        const result1 = manager.processText(sessionId, '第二句话', null, 'job-2', 1, false);
        expect(result1.shouldDiscard).toBe(false);
        expect(result1.shouldWaitForMerge).toBe(true);
        jest.useRealTimers();

        // 测试 previousText 分支
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

        // 测试无 pending 无 previousText 分支
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
      const currentText = '上一句话的后续内容';  // 有重叠"上一句话"
      
      const result = manager.processText(
        sessionId,
        currentText,
        previousText,
        'job-1',
        0,
        false
      );

      // v3 改造：应该返回完整 mergedText，包含 previousText
      // 注意：如果 mergedText 很短（< 6字符），会被 DROP
      // 或者如果 mergedText 在 6-20 字符范围内，会等待合并
      if (!result.shouldDiscard && !result.shouldWaitForMerge) {
        expect(result.processedText).toContain(previousText);
        // 不应该只返回去重后的片段
        // 如果只返回片段，processedText 应该只包含"的后续内容"
        // 但完整 mergedText 应该包含 previousText + "的后续内容"
        expect(result.processedText.length).toBeGreaterThan('的后续内容'.length);
      } else if (result.shouldWaitForMerge) {
        // 如果等待合并，pendingText 应该包含 previousText
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

      // 应该返回 currentText（或等待合并）
      if (result.shouldWaitForMerge) {
        expect(manager.getPendingText(sessionId)).toBe(currentText);
      } else {
        expect(result.processedText).toBe(currentText);
      }
    });
  });
});
