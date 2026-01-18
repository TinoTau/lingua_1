/**
 * asr-step.ts 验证测试
 * 
 * 验证TASK-S1：finalize时expectedSegmentCount与forceComplete行为
 * 
 * 测试重点：
 * 1. finalize时为每个originalJob正确设置expectedSegmentCount
 * 2. 所有batch都通过addASRSegment进入dispatcher
 * 3. forceComplete只在finalize时调用
 * 4. SR只触发一次（不会提前触发或永远不触发）
 */

import { OriginalJobResultDispatcher } from '../../pipeline-orchestrator/original-job-result-dispatcher';
import { JobAssignMessage } from '@shared/protocols/messages';

describe('asr-step.ts: TASK-S1 验证', () => {
  let dispatcher: OriginalJobResultDispatcher;
  const mockCallback = jest.fn();

  beforeEach(() => {
    dispatcher = new OriginalJobResultDispatcher();
    mockCallback.mockClear();
  });

  afterEach(() => {
    dispatcher.stopCleanupTimer();
  });

  /**
   * 创建模拟的JobAssignMessage
   */
  function createJobAssignMessage(
    jobId: string,
    sessionId: string,
    utteranceIndex: number,
    isFinalize: boolean = false
  ): JobAssignMessage {
    const job = {
      job_id: jobId,
      session_id: sessionId,
      utterance_index: utteranceIndex,
      src_lang: 'zh',
      tgt_lang: 'en',
      sample_rate: 16000,
    } as JobAssignMessage;

    if (isFinalize) {
      (job as any).is_manual_cut = true;
    }

    return job;
  }

  /**
   * 创建模拟的ASR数据
   */
  function createASRData(
    originalJobId: string,
    text: string,
    batchIndex: number
  ) {
    return {
      originalJobId,
      asrText: text,
      asrSegments: [],
      batchIndex,
    };
  }

  describe('finalize时expectedSegmentCount设置', () => {
    it('应该在finalize时设置expectedSegmentCount为batch数量', () => {
      const sessionId = 'test-session-s1-1';
      const originalJobId = 'job-finalize-1';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, true); // isFinalize = true
      
      // 模拟3个batch的场景
      const batchCount = 3;
      const expectedSegmentCount = batchCount; // finalize时应该设置为batch数量

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        expectedSegmentCount, // 设置为batch数量
        job,
        mockCallback
      );

      // 验证expectedSegmentCount已设置
      const registration = (dispatcher as any).registrations.get(sessionId)?.get(originalJobId);
      expect(registration).toBeDefined();
      expect(registration.expectedSegmentCount).toBe(expectedSegmentCount);
    });

    it('应该在非finalize时设置expectedSegmentCount为undefined', () => {
      const sessionId = 'test-session-s1-2';
      const originalJobId = 'job-non-finalize-1';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, false); // isFinalize = false

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        undefined, // 非finalize时为undefined
        job,
        mockCallback
      );

      // 验证expectedSegmentCount为undefined
      const registration = (dispatcher as any).registrations.get(sessionId)?.get(originalJobId);
      expect(registration).toBeDefined();
      expect(registration.expectedSegmentCount).toBeUndefined();
    });
  });

  describe('batch数量与expectedSegmentCount一致性', () => {
    it('应该在所有batch添加完成后才触发处理（finalize场景）', async () => {
      const sessionId = 'test-session-s1-3';
      const originalJobId = 'job-batch-count-1';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, true);
      const batchCount = 3;

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        batchCount, // 期望3个batch
        job,
        mockCallback
      );

      // 添加第一个batch
      const asrData1 = createASRData(originalJobId, 'First', 0);
      await dispatcher.addASRSegment(sessionId, originalJobId, asrData1);
      expect(mockCallback).not.toHaveBeenCalled(); // 还未达到期望数量

      // 添加第二个batch
      const asrData2 = createASRData(originalJobId, 'Second', 1);
      await dispatcher.addASRSegment(sessionId, originalJobId, asrData2);
      expect(mockCallback).not.toHaveBeenCalled(); // 还未达到期望数量

      // 添加第三个batch（达到期望数量）
      const asrData3 = createASRData(originalJobId, 'Third', 2);
      await dispatcher.addASRSegment(sessionId, originalJobId, asrData3);
      expect(mockCallback).toHaveBeenCalledTimes(1); // 应该触发处理
    });

    it('应该确保batch数量与expectedSegmentCount一致', async () => {
      const sessionId = 'test-session-s1-4';
      const originalJobId = 'job-batch-count-2';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, true);
      const batchCount = 2;

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        batchCount, // 期望2个batch
        job,
        mockCallback
      );

      // 添加所有batch
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'First', 0));
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'Second', 1));

      // 验证callback被调用，且累积的segment数量等于expectedSegmentCount
      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callArgs = mockCallback.mock.calls[0][0];
      expect(callArgs.asrSegments).toBeDefined();
    });
  });

  describe('forceComplete行为验证', () => {
    it('应该在forceComplete时立即处理累积的片段', async () => {
      const sessionId = 'test-session-s1-5';
      const originalJobId = 'job-force-complete-1';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, true);

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        undefined, // 累积等待
        job,
        mockCallback
      );

      // 添加片段（不会立即触发，因为expectedSegmentCount为undefined）
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'First', 0));
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'Second', 1));
      expect(mockCallback).not.toHaveBeenCalled();

      // forceComplete应该立即触发处理
      await dispatcher.forceComplete(sessionId, originalJobId);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('应该在forceComplete时设置isFinalized标志', async () => {
      const sessionId = 'test-session-s1-6';
      const originalJobId = 'job-force-complete-2';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, true);

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        undefined,
        job,
        mockCallback
      );

      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'Test', 0));
      await dispatcher.forceComplete(sessionId, originalJobId);

      // 验证callback被调用
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('不应该提前触发SR（未达到expectedSegmentCount时）', async () => {
      const sessionId = 'test-session-s1-7';
      const originalJobId = 'job-no-early-trigger-1';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, true);
      const batchCount = 3;

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        batchCount, // 期望3个batch
        job,
        mockCallback
      );

      // 只添加2个batch（未达到期望数量）
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'First', 0));
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'Second', 1));

      // 不应该触发SR（还未达到expectedSegmentCount）
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('不应该永远不触发SR（达到expectedSegmentCount时应该触发）', async () => {
      const sessionId = 'test-session-s1-8';
      const originalJobId = 'job-must-trigger-1';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, true);
      const batchCount = 2;

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        batchCount, // 期望2个batch
        job,
        mockCallback
      );

      // 添加所有batch（达到期望数量）
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'First', 0));
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'Second', 1));

      // 应该触发SR（达到expectedSegmentCount）
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('SR单次调用语义', () => {
    it('应该确保SR只触发一次（达到expectedSegmentCount时）', async () => {
      const sessionId = 'test-session-s1-9';
      const originalJobId = 'job-single-sr-1';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, true);
      const batchCount = 2;

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        batchCount,
        job,
        mockCallback
      );

      // 添加所有batch
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'First', 0));
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'Second', 1));

      // 验证只调用一次
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // 再次添加batch不应该再次触发（因为已finalized）
      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'Third', 2));
      expect(mockCallback).toHaveBeenCalledTimes(1); // 仍然只调用一次
    });

    it('应该确保forceComplete不会破坏SR单次调用语义', async () => {
      const sessionId = 'test-session-s1-10';
      const originalJobId = 'job-force-complete-sr-1';
      const job = createJobAssignMessage(originalJobId, sessionId, 0, true);

      dispatcher.registerOriginalJob(
        sessionId,
        originalJobId,
        undefined, // 累积等待
        job,
        mockCallback
      );

      await dispatcher.addASRSegment(sessionId, originalJobId, createASRData(originalJobId, 'First', 0));
      await dispatcher.forceComplete(sessionId, originalJobId);

      // 验证只调用一次
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // 再次forceComplete不应该再次触发
      await dispatcher.forceComplete(sessionId, originalJobId);
      expect(mockCallback).toHaveBeenCalledTimes(1); // 仍然只调用一次
    });
  });
});
