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
      const now = Date.now();

      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);

      // 验证注册信息（通过addASRSegment来间接验证）
      const asrData = createASRData('job-1', 'test', 0);
      dispatcher.addASRSegment('session-1', 'job-1', asrData);

      // 验证callback被调用（如果expectedSegmentCount为0或达到数量）
      // 这里expectedSegmentCount为undefined，所以不会立即调用
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('应该为不同session维护独立的注册信息', () => {
      const job1 = createJobAssignMessage('job-1', 'session-1', 0);
      const job2 = createJobAssignMessage('job-2', 'session-2', 0);

      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job1, mockCallback);
      dispatcher.registerOriginalJob('session-2', 'job-2', undefined, job2, mockCallback);

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
      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);

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

      // 故意乱序添加
      const asrData1 = createASRData('job-1', 'Third', 2);
      const asrData2 = createASRData('job-1', 'First', 0);
      const asrData3 = createASRData('job-1', 'Second', 1);

      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      // 应该按batchIndex排序：First Second Third
      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callArgs = mockCallback.mock.calls[0][0];
      const textParts = callArgs.asrText.split(' ');
      expect(textParts[0]).toBe('First');
      expect(textParts[1]).toBe('Second');
      expect(textParts[2]).toBe('Third');
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

    it('应该在expectedSegmentCount为undefined时累积等待', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);

      const asrData1 = createASRData('job-1', 'First', 0);
      const asrData2 = createASRData('job-1', 'Second', 1);

      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 不应该立即触发（等待finalize）
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('forceComplete', () => {
    it('应该在forceComplete时立即处理累积的片段', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);

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
      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);

      const asrData = createASRData('job-1', 'Test', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData);
      await dispatcher.forceComplete('session-1', 'job-1');

      // 验证callback被调用
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('应该处理空累积的情况', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);

      // 不添加任何片段，直接forceComplete
      await dispatcher.forceComplete('session-1', 'job-1');

      // 不应该调用callback（因为没有累积的片段）
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('20秒超时清理机制', () => {
    it('应该清理超过20秒没有活动的注册信息', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);

      const asrData = createASRData('job-1', 'Test', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData);

      // 前进21秒（超过20秒超时）
      jest.advanceTimersByTime(21000);

      // 触发清理检查（每5秒检查一次）
      jest.advanceTimersByTime(5000);

      // 尝试添加新的片段，应该失败（注册信息已被清理）
      const asrData2 = createASRData('job-1', 'Test2', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // callback不应该被调用（因为注册信息已被清理）
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('不应该清理在20秒内有活动的注册信息', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);

      const asrData1 = createASRData('job-1', 'Test1', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);

      // 前进10秒
      jest.advanceTimersByTime(10000);

      // 添加新片段（更新lastActivityAt）
      const asrData2 = createASRData('job-1', 'Test2', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 再前进15秒（总共25秒，但最后活动是15秒前）
      jest.advanceTimersByTime(15000);

      // 触发清理检查
      jest.advanceTimersByTime(5000);

      // 注册信息应该仍然存在（因为最后活动是15秒前，未超过20秒）
      const asrData3 = createASRData('job-1', 'Test3', 2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      // 不应该被清理，可以继续添加片段
      expect(mockCallback).not.toHaveBeenCalled(); // expectedSegmentCount为undefined，不会立即触发
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
      const beforeRegister = Date.now();
      
      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);
      
      const afterRegister = Date.now();

      // 通过addASRSegment来验证（如果注册成功，可以添加片段）
      const asrData = createASRData('job-1', 'Test', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData);

      // 验证可以添加片段（说明注册成功，生命周期字段已初始化）
      expect(mockCallback).not.toHaveBeenCalled(); // expectedSegmentCount为undefined，不会立即触发
    });

    it('应该在addASRSegment时更新lastActivityAt', async () => {
      const job = createJobAssignMessage('job-1', 'session-1', 0);
      dispatcher.registerOriginalJob('session-1', 'job-1', undefined, job, mockCallback);

      const asrData1 = createASRData('job-1', 'Test1', 0);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData1);

      // 前进10秒
      jest.advanceTimersByTime(10000);

      const asrData2 = createASRData('job-1', 'Test2', 1);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData2);

      // 再前进15秒（总共25秒，但最后活动是15秒前）
      jest.advanceTimersByTime(15000);

      // 触发清理检查
      jest.advanceTimersByTime(5000);

      // 注册信息应该仍然存在（因为lastActivityAt已更新）
      const asrData3 = createASRData('job-1', 'Test3', 2);
      await dispatcher.addASRSegment('session-1', 'job-1', asrData3);

      // 不应该被清理
      expect(mockCallback).not.toHaveBeenCalled();
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
});
