/**
 * OriginalJobResultDispatcher 优化功能单元测试
 * 
 * 测试场景（基于决策部门反馈的 P0 优化）：
 * 1. expectedSegmentCount 一致性
 * 2. Registration TTL 兜底机制
 * 3. ASR 失败 segment 的核销策略
 * 4. Missing segment 计数
 */

import { OriginalJobResultDispatcher, OriginalJobASRData } from './original-job-result-dispatcher';
import { JobAssignMessage } from '@shared/protocols/messages';

describe('OriginalJobResultDispatcher 优化功能测试', () => {
  let dispatcher: OriginalJobResultDispatcher;
  const mockCallback = jest.fn();

  beforeEach(() => {
    dispatcher = new OriginalJobResultDispatcher();
    mockCallback.mockClear();
    jest.useFakeTimers();
  });

  afterEach(async () => {
    // 清理所有定时器（包括 cleanupIntervalId 和所有 registration 的 ttlTimerHandle）
    dispatcher.cleanupAllTimers();
    
    // 运行所有 pending 的定时器（在 fake timers 模式下）
    jest.runOnlyPendingTimers();
    
    // 切换回真实定时器
    jest.useRealTimers();
    
    // 等待所有异步操作完成
    await Promise.resolve();
  });

  /**
   * 创建模拟的JobAssignMessage
   */
  function createJobAssignMessage(
    jobId: string,
    sessionId: string,
    utteranceIndex: number
  ): JobAssignMessage {
    return {
      job_id: jobId,
      session_id: sessionId,
      utterance_index: utteranceIndex,
      src_lang: 'zh',
      tgt_lang: 'en',
      sample_rate: 16000,
    } as JobAssignMessage;
  }

  /**
   * 创建模拟的ASR数据
   */
  function createASRData(
    originalJobId: string,
    text: string,
    batchIndex?: number,
    missing?: boolean
  ): OriginalJobASRData {
    return {
      originalJobId,
      asrText: text,
      asrSegments: [],
      batchIndex,
      missing,
    };
  }

  describe('expectedSegmentCount 一致性', () => {
    it('应该强制使用明确的 expectedSegmentCount（不允许 undefined）', () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      const expectedSegmentCount = 3; // 明确的期望数量

      dispatcher.registerOriginalJob('session-1', 'job-1', expectedSegmentCount, job, mockCallback, false);

      // 添加第一个 segment
      const asrData1 = createASRData('job-1', 'text1', 0);
      dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      expect(mockCallback).not.toHaveBeenCalled();

      // 添加第二个 segment
      const asrData2 = createASRData('job-1', 'text2', 1);
      dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      expect(mockCallback).not.toHaveBeenCalled();

      // 添加第三个 segment（达到期望数量）
      const asrData3 = createASRData('job-1', 'text3', 2);
      dispatcher.addASRSegment('session-1', 'job-1', asrData3);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('应该正确计算 receivedCount 和 missingCount', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      const expectedSegmentCount = 3;

      dispatcher.registerOriginalJob('session-1', 'job-1', expectedSegmentCount, job, mockCallback, false);

      // 添加正常 segment
      const asrData1 = createASRData('job-1', 'text1', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);

      // 添加 missing segment
      const asrData2 = createASRData('job-1', '', 1, true);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 添加第三个 segment（达到期望数量）
      const asrData3 = createASRData('job-1', 'text3', 2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callbackArgs = mockCallback.mock.calls[0][0];
      expect(callbackArgs.asrText).toBe('text1 text3'); // missing segment 的文本被跳过
    });
  });

  describe('Registration TTL 兜底机制', () => {
    it('应该在 TTL 超时时强制 finalize partial', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      const expectedSegmentCount = 3;

      dispatcher.registerOriginalJob('session-1', 'job-1', expectedSegmentCount, job, mockCallback, false);

      // 只添加一个 segment（未达到期望数量）
      const asrData1 = createASRData('job-1', 'text1', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      expect(mockCallback).not.toHaveBeenCalled();

      // 快进时间到 TTL 超时（10秒）
      jest.advanceTimersByTime(10000);
      
      // 在 fake timers 下，需要手动触发 pending 的 Promise
      await Promise.resolve();
      
      // 应该触发 TTL 强制 finalize
      expect(mockCallback).toHaveBeenCalledTimes(1);
      
      const callbackArgs = mockCallback.mock.calls[0][0];
      expect(callbackArgs.asrText).toBe('text1'); // 部分结果
    }, 15000); // 增加超时时间

    it('应该在正常完成时清除 TTL 定时器', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      const expectedSegmentCount = 2;

      dispatcher.registerOriginalJob('session-1', 'job-1', expectedSegmentCount, job, mockCallback, false);

      // 添加第一个 segment
      const asrData1 = createASRData('job-1', 'text1', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);

      // 添加第二个 segment（正常完成）
      const asrData2 = createASRData('job-1', 'text2', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      
      // 等待异步操作完成
      await Promise.resolve();
      
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // 快进时间到 TTL 超时（不应该再次触发）
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
      expect(mockCallback).toHaveBeenCalledTimes(1); // 仍然只有一次
    }, 15000); // 增加超时时间
  });

  describe('ASR 失败 segment 的核销策略', () => {
    it('应该正确处理 missing segment 并计入 receivedCount', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      const expectedSegmentCount = 3;

      dispatcher.registerOriginalJob('session-1', 'job-1', expectedSegmentCount, job, mockCallback, false);

      // 添加正常 segment
      const asrData1 = createASRData('job-1', 'text1', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);

      // 添加 missing segment（ASR 失败）
      const asrData2 = createASRData('job-1', '', 1, true);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 添加第三个 segment（达到期望数量，应该触发）
      const asrData3 = createASRData('job-1', 'text3', 2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callbackArgs = mockCallback.mock.calls[0][0];
      // missing segment 的文本应该被跳过
      expect(callbackArgs.asrText).toBe('text1 text3');
    });

    it('应该允许所有 segment 都是 missing 的情况', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      const expectedSegmentCount = 2;

      dispatcher.registerOriginalJob('session-1', 'job-1', expectedSegmentCount, job, mockCallback, false);

      // 添加两个 missing segment
      const asrData1 = createASRData('job-1', '', 0, true);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);

      const asrData2 = createASRData('job-1', '', 1, true);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 应该触发（即使所有 segment 都是 missing）
      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callbackArgs = mockCallback.mock.calls[0][0];
      expect(callbackArgs.asrText).toBe(''); // 空文本
    });
  });

  describe('按 batchIndex 排序', () => {
    it('应该按 batchIndex 排序合并文本', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      const expectedSegmentCount = 3;

      dispatcher.registerOriginalJob('session-1', 'job-1', expectedSegmentCount, job, mockCallback, false);

      // 乱序添加 segment
      const asrData3 = createASRData('job-1', 'text3', 2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      const asrData1 = createASRData('job-1', 'text1', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);

      const asrData2 = createASRData('job-1', 'text2', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callbackArgs = mockCallback.mock.calls[0][0];
      // 应该按 batchIndex 排序：text1 text2 text3
      expect(callbackArgs.asrText).toBe('text1 text2 text3');
    });
  });
});
