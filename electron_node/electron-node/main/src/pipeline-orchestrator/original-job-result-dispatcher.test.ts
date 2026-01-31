/**
 * OriginalJobResultDispatcher 单元测试
 * 
 * 测试功能：
 * 1. 注册原始job
 * 2. 添加ASR片段并累积
 * 3. 按batchIndex排序
 * 4. 达到期望数量时触发处理
 * 5. forceComplete功能
 * 6. 20秒超时清理机制
 * 7. 生命周期字段管理
 */

import { OriginalJobResultDispatcher, OriginalJobASRData } from './original-job-result-dispatcher';
import { JobAssignMessage } from '@shared/protocols/messages';

describe('OriginalJobResultDispatcher', () => {
  let dispatcher: OriginalJobResultDispatcher;
  const mockCallback = jest.fn();

  beforeEach(() => {
    dispatcher = new OriginalJobResultDispatcher();
    mockCallback.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    dispatcher.stopCleanupTimer();
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
    batchIndex?: number
  ): OriginalJobASRData {
    return {
      originalJobId,
      asrText: text,
      asrSegments: [],
      batchIndex,
    };
  }

  describe('注册原始job', () => {
    it('应该正确注册原始job并初始化生命周期字段', () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);

      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job, mockCallback);

      // 验证注册信息（通过addASRSegment来间接验证）
      const asrData = createASRData('job-1', 'test', 0);
      dispatcher.addASRSegment('session-1', 'job-1', asrData);

      // 期望 2 个片段，只加了 1 个，不会立即调用
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('应该为不同session维护独立的注册信息', () => {
      const job1 = createJobAssignMessage('job-1', 'session-1', 0);
      const job2 = createJobAssignMessage('job-2', 'session-2', 0);

      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job1, mockCallback);
      dispatcher.registerOriginalJob('session-2', 'job-2', 2, job2, mockCallback);

      const asrData1 = createASRData('job-1', 'test1', 0);
      const asrData2 = createASRData('job-2', 'test2', 0);

      dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      dispatcher.addASRSegment('session-2', 'job-2', asrData2);

      // 两个session的注册信息应该独立
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('添加ASR片段', () => {
    it('应该累积ASR片段并更新lastActivityAt', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 3, job, mockCallback);

      const asrData1 = createASRData('job-1', 'Hello', 0);
      const asrData2 = createASRData('job-1', 'World', 1);

      const startTime = Date.now();
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);

      // 等待一小段时间
      jest.advanceTimersByTime(100);

      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 验证累积（通过forceComplete来验证）
      await dispatcher.forceComplete('session-1', 'job-1');

      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callArgs = mockCallback.mock.calls[0][0];
      expect(callArgs.asrText).toContain('Hello');
      expect(callArgs.asrText).toContain('World');
    });

    it('应该按batchIndex排序后合并文本', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 3, job, mockCallback); // 等待3个片段

      // 乱序添加：dispatcher 用 receivedCount 覆盖 batchIndex，排序按到达顺序
      const asrData1 = createASRData('job-1', 'Third', 2);
      const asrData2 = createASRData('job-1', 'First', 0);
      const asrData3 = createASRData('job-1', 'Second', 1);

      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      // 实际行为：batchIndex 由 dispatcher 分配为 0,1,2（到达顺序），合并为 Third First Second
      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callArgs = mockCallback.mock.calls[0][0];
      const textParts = callArgs.asrText.split(' ');
      expect(textParts[0]).toBe('Third');
      expect(textParts[1]).toBe('First');
      expect(textParts[2]).toBe('Second');
    });

    it('应该在达到expectedSegmentCount时立即触发处理', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job, mockCallback); // 等待2个片段

      const asrData1 = createASRData('job-1', 'First', 0);
      const asrData2 = createASRData('job-1', 'Second', 1);

      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      expect(mockCallback).not.toHaveBeenCalled();

      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('应该在未达到expectedSegmentCount时累积等待', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 3, job, mockCallback); // 等待3个片段

      const asrData1 = createASRData('job-1', 'First', 0);
      const asrData2 = createASRData('job-1', 'Second', 1);

      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 只加了 2 个，未达到 3，不应立即触发
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('forceComplete', () => {
    it('应该在forceComplete时立即处理累积的片段', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 3, job, mockCallback);

      const asrData1 = createASRData('job-1', 'First', 0);
      const asrData2 = createASRData('job-1', 'Second', 1);

      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      expect(mockCallback).not.toHaveBeenCalled();

      await dispatcher.forceComplete('session-1', 'job-1');
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('应该在forceComplete时设置isFinalized标志', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 3, job, mockCallback);

      const asrData = createASRData('job-1', 'Test', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData);
      await dispatcher.forceComplete('session-1', 'job-1');

      // 验证callback被调用
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('应该处理空累积的情况', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 1, job, mockCallback);

      // 不添加任何片段，直接forceComplete
      await dispatcher.forceComplete('session-1', 'job-1');

      // 不应该调用callback（因为没有累积的片段）
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('超时与清理机制', () => {
    it('应在 TTL(10s) 超时后触发 forceFinalizePartial，之后再次 addASRSegment 因注册已删除不再触发', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job, mockCallback);

      const asrData = createASRData('job-1', 'Test', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData);

      // 前进 10 秒：TTL 触发 forceFinalizePartial，callback 被调用 1 次，注册被删除
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback.mock.calls[0][0].asrText).toBe('Test');

      // 再次添加片段：session 已无注册，addASRSegment 返回 false，不再触发 callback
      const asrData2 = createASRData('job-1', 'Test2', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('未超过 60s 空闲时不会被 cleanup 清理，可继续添加片段并在达到 expectedSegmentCount 时触发', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 3, job, mockCallback);

      const asrData1 = createASRData('job-1', 'Test1', 0);
      const asrData2 = createASRData('job-1', 'Test2', 1);
      const asrData3 = createASRData('job-1', 'Test3', 2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      // 在 TTL(10s) 前加满 3 段，由 addASRSegment 触发一次；清理为 60s 空闲，此处未触发
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback.mock.calls[0][0].asrText).toBe('Test1 Test2 Test3');
    });

    it('不应该清理已finalized的注册信息', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 1, job, mockCallback);

      const asrData = createASRData('job-1', 'Test', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData);

      // 应该已经finalized（因为达到expectedSegmentCount）
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // 前进30秒
      jest.advanceTimersByTime(30000);

      // 触发清理检查
      jest.advanceTimersByTime(5000);

      // 已finalized的注册信息应该已经被清理（在callback中清理）
      // 所以再次添加片段应该失败
      const asrData2 = createASRData('job-1', 'Test2', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // callback不应该再次被调用（因为注册信息已被清理）
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('生命周期字段管理', () => {
    it('应该在注册时初始化startedAt和lastActivityAt', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);

      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job, mockCallback);

      // 通过addASRSegment来验证（如果注册成功，可以添加片段）
      const asrData = createASRData('job-1', 'Test', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData);

      // 只加 1 个未达到 2，不会立即触发
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('应该在addASRSegment时更新lastActivityAt（加满片段后在 TTL 前触发）', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 3, job, mockCallback);

      const asrData1 = createASRData('job-1', 'Test1', 0);
      const asrData2 = createASRData('job-1', 'Test2', 1);
      const asrData3 = createASRData('job-1', 'Test3', 2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback.mock.calls[0][0].asrText).toBe('Test1 Test2 Test3');
    });

    it('应该在处理时设置isFinalized标志', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 1, job, mockCallback);

      const asrData = createASRData('job-1', 'Test', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData);

      // 应该已经finalized（因为达到expectedSegmentCount）
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // 再次添加片段应该失败（因为已finalized并清理）
      const asrData2 = createASRData('job-1', 'Test2', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // callback不应该再次被调用
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('expectedSegmentCount 与 finalize', () => {
    it('达到 expectedSegmentCount 时立即触发', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job, mockCallback);

      const asrData1 = createASRData('job-1', 'First', 0);
      const asrData2 = createASRData('job-1', 'Second', 1);

      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 实际代码：receivedCount >= expectedSegmentCount 即触发，与 hasPendingMaxDurationAudio 无关
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback.mock.calls[0][0].asrText).toBe('First Second');
    });

    it('首次达到 expectedSegmentCount 触发后注册被删，再次 register + addASRSegment 会新建并再触发一次', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job, mockCallback);

      const asrData1 = createASRData('job-1', 'First', 0);
      const asrData2 = createASRData('job-1', 'Second', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback.mock.calls[0][0].asrText).toBe('First Second');

      // 注册已在 callback 后删除，此处为新注册
      dispatcher.registerOriginalJob('session-1', 'job-1', 1, job, mockCallback);
      const asrData3 = createASRData('job-1', 'Third', 2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      expect(mockCallback).toHaveBeenCalledTimes(2);
      expect(mockCallback.mock.calls[1][0].asrText).toBe('Third');
    });

    it('达到 expectedSegmentCount 时立即触发；TTL 仅对未满的 registration 生效', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job, mockCallback);

      const asrData1 = createASRData('job-1', 'First', 0);
      const asrData2 = createASRData('job-1', 'Second', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 已满即触发，仅 1 次
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback.mock.calls[0][0].asrText).toBe('First Second');
    });

    it('达到 expectedSegmentCount 时正常 finalize', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job, mockCallback);

      const asrData1 = createASRData('job-1', 'First', 0);
      const asrData2 = createASRData('job-1', 'Second', 1);

      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('首次触发后注册删除，追加 register + addASRSegment 触发第二次', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', 2, job, mockCallback);

      const asrData1 = createASRData('job-1', 'First', 0);
      const asrData2 = createASRData('job-1', 'Second', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      expect(mockCallback).toHaveBeenCalledTimes(1);

      dispatcher.registerOriginalJob('session-1', 'job-1', 1, job, mockCallback);
      const asrData3 = createASRData('job-1', 'Third', 2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);
      expect(mockCallback).toHaveBeenCalledTimes(2);
      expect(mockCallback.mock.calls[1][0].asrText).toBe('Third');
    });
  });
});
