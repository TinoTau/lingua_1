/**
 * AggregatorStateTextProcessor 单元测试
 * 测试 v3 改造：不再输出空字符串作为丢弃信号
 */

import { AggregatorStateTextProcessor } from './aggregator-state-text-processor';
import { DedupConfig, DEFAULT_DEDUP_CONFIG } from './dedup';
import { TailCarryConfig } from './tail-carry';
import { UtteranceInfo } from './aggregator-decision';

describe('AggregatorStateTextProcessor', () => {
  let processor: AggregatorStateTextProcessor;
  const dedupConfig: DedupConfig = DEFAULT_DEDUP_CONFIG;
  const tailCarryConfig: TailCarryConfig = {
    tailLength: 20,
    minTailLength: 10,
  };

  beforeEach(() => {
    processor = new AggregatorStateTextProcessor(dedupConfig, tailCarryConfig);
  });

  describe('v3 改造：不再输出空字符串作为丢弃信号', () => {
    describe('tailBuffer 分支', () => {
      it('完全包含时应该保留原文，不返回空字符串', () => {
        const tailBuffer = '这是一句完整的话';
        const text = '完整的话';  // 完全被 tailBuffer 包含
        
        const result = processor.processText(
          'MERGE',
          text,
          { text: '上一句话', start: 0, end: 1.0, utteranceIndex: 0 },
          tailBuffer
        );

        // v3 改造：不再返回空字符串，应该保留原文
        expect(result.processedText).not.toBe('');
        expect(result.processedText).toBe(text);
        expect(result.deduped).toBe(false);
        expect(result.dedupChars).toBe(0);
      });

      it('短句（<=20字符）去重后为空时应该保留原文', () => {
        const tailBuffer = '这是第一句话';
        const text = '第一句话';  // 短句，去重后可能为空
        
        const result = processor.processText(
          'MERGE',
          text,
          { text: '上一句话', start: 0, end: 1.0, utteranceIndex: 0 },
          tailBuffer
        );

        // 短句保护：应该保留原文
        expect(result.processedText).not.toBe('');
        expect(result.processedText).toBe(text);
        expect(result.deduped).toBe(false);
      });

      it('正常去重时应该返回去重后的文本', () => {
        const tailBuffer = '这是第一句话';
        const text = '第一句话的后续内容';  // 有重叠"第一句话"
        
        const result = processor.processText(
          'MERGE',
          text,
          { text: '上一句话', start: 0, end: 1.0, utteranceIndex: 0 },
          tailBuffer
        );

        // 正常去重：应该返回去重后的文本（不是空字符串）
        expect(result.processedText).not.toBe('');
        expect(result.processedText).not.toBe(text);  // 应该被去重
        expect(result.deduped).toBe(true);
        expect(result.dedupChars).toBeGreaterThan(0);
      });
    });

    describe('lastTail 分支', () => {
      it('完全包含时应该保留原文，不返回空字符串', () => {
        const lastUtterance: UtteranceInfo = {
          text: '这是一句完整的话，包含了很多内容',
          start: 0,
          end: 2.0,
          utteranceIndex: 0,
        };
        const text = '完整的话';  // 完全被 lastUtterance 包含
        
        const result = processor.processText(
          'MERGE',
          text,
          lastUtterance,
          ''  // 无 tailBuffer
        );

        // v3 改造：不再返回空字符串，应该保留原文
        expect(result.processedText).not.toBe('');
        expect(result.processedText).toBe(text);
        expect(result.deduped).toBe(false);
        expect(result.dedupChars).toBe(0);
      });

      it('短句（<=20字符）去重后为空时应该保留原文', () => {
        const lastUtterance: UtteranceInfo = {
          text: '这是第一句话',
          start: 0,
          end: 1.0,
          utteranceIndex: 0,
        };
        const text = '第一句话';  // 短句，去重后可能为空
        
        const result = processor.processText(
          'MERGE',
          text,
          lastUtterance,
          ''  // 无 tailBuffer
        );

        // 短句保护：应该保留原文
        expect(result.processedText).not.toBe('');
        expect(result.processedText).toBe(text);
        expect(result.deduped).toBe(false);
      });

      it('正常去重时应该返回去重后的文本', () => {
        const lastUtterance: UtteranceInfo = {
          text: '这是第一句话',
          start: 0,
          end: 1.0,
          utteranceIndex: 0,
        };
        const text = '第一句话的后续内容';  // 有重叠"第一句话"
        
        const result = processor.processText(
          'MERGE',
          text,
          lastUtterance,
          ''  // 无 tailBuffer
        );

        // 正常去重：应该返回去重后的文本（不是空字符串）
        expect(result.processedText).not.toBe('');
        expect(result.processedText).not.toBe(text);  // 应该被去重
        expect(result.deduped).toBe(true);
        expect(result.dedupChars).toBeGreaterThan(0);
      });
    });

    describe('NEW_STREAM 动作', () => {
      it('NEW_STREAM 时应该返回原始文本', () => {
        const text = '这是新的一句话';
        
        const result = processor.processText(
          'NEW_STREAM',
          text,
          null,
          ''
        );

        // NEW_STREAM 不做去重，应该返回原始文本
        expect(result.processedText).toBe(text);
        expect(result.deduped).toBe(false);
        expect(result.dedupChars).toBe(0);
      });
    });

    describe('职责验证：只做内部 Trim，不做丢弃决策', () => {
      it('完全包含的文本应该保留原文，让 Gate 决定是否丢弃', () => {
        const tailBuffer = '这是一句完整的话';
        const text = '完整的话';  // 完全被包含
        
        const result = processor.processText(
          'MERGE',
          text,
          { text: '上一句话', start: 0, end: 1.0, utteranceIndex: 0 },
          tailBuffer
        );

        // 应该保留原文，不在此处丢弃
        expect(result.processedText).toBe(text);
        expect(result.deduped).toBe(false);
        
        // 注意：最终是否丢弃应该由 forward-merge gate 决定
        // 这里只做内部 Trim，不做丢弃决策
      });
    });
  });

  describe('基本功能', () => {
    it('应该正确处理无重叠的文本', () => {
      const lastUtterance: UtteranceInfo = {
        text: '这是第一句话',
        start: 0,
        end: 1.0,
        utteranceIndex: 0,
      };
      const text = '这是第二句话';  // 无重叠
      
      const result = processor.processText(
        'MERGE',
        text,
        lastUtterance,
        ''
      );

      expect(result.processedText).toBe(text);
      expect(result.deduped).toBe(false);
      expect(result.dedupChars).toBe(0);
    });

    it('应该正确处理 tailBuffer 清除', () => {
      const tailBuffer = '这是第一句话';
      const text = '这是第二句话';
      
      const result = processor.processText(
        'MERGE',
        text,
        { text: '上一句话', start: 0, end: 1.0, utteranceIndex: 0 },
        tailBuffer
      );

      // 使用 tailBuffer 后应该清除
      expect(result.tailBufferCleared).toBe(true);
    });
  });
});
