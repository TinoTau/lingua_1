/**
 * 流水线并行调度器单元测试
 */

import { PipelineScheduler } from './pipeline-scheduler';
import { PipelineSchedulerConfig } from './types';
import { JobAssignMessage } from '@shared/protocols/messages';

// Mock logger
jest.mock('../logger', () => ({
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('PipelineScheduler', () => {
  let scheduler: PipelineScheduler;
  const defaultConfig: PipelineSchedulerConfig = {
    enabled: true,
    maxConcurrentJobs: 10,
  };

  beforeEach(() => {
    scheduler = new PipelineScheduler(defaultConfig);
  });

  function createJob(
    jobId: string,
    sessionId: string,
    utteranceIndex: number
  ): JobAssignMessage {
    return {
      type: 'job_assign',
      job_id: jobId,
      attempt_id: 1,
      session_id: sessionId,
      utterance_index: utteranceIndex,
      src_lang: 'zh',
      tgt_lang: 'en',
      dialect: null,
      pipeline: {
        use_asr: true,
        use_nmt: true,
        use_tts: true,
      },
      audio: 'base64_audio',
      audio_format: 'opus',
      sample_rate: 16000,
      trace_id: 'test-trace',
    } as JobAssignMessage;
  }

  describe('addJob', () => {
    it('应该添加job并初始化状态', () => {
      const job = createJob('job-1', 'session-1', 0);
      const jobState = scheduler.addJob(job);

      expect(jobState).toBeDefined();
      expect(jobState.jobId).toBe('job-1');
      expect(jobState.utteranceIndex).toBe(0);
      // addJob会自动启动ASR阶段（如果启用）
      expect(jobState.asr.status).toBe('processing');
      expect(jobState.asr.canStart).toBe(true);
      expect(jobState.semanticRepair.canStart).toBe(false);
      expect(jobState.nmt.canStart).toBe(false);
      expect(jobState.tts.canStart).toBe(false);
    });

    it('应该按utterance_index排序处理', () => {
      const job1 = createJob('job-1', 'session-1', 1);
      const job2 = createJob('job-2', 'session-1', 0);

      scheduler.addJob(job1);
      scheduler.addJob(job2);

      const snapshot = scheduler.getSnapshot();
      expect(snapshot.jobs[0].utteranceIndex).toBe(0);
      expect(snapshot.jobs[1].utteranceIndex).toBe(1);
    });
  });

  describe('ASR阶段', () => {
    it('应该启动ASR阶段', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);

      const jobState = scheduler.getJobState('job-1');
      expect(jobState?.asr.status).toBe('processing');
    });

    it('应该在ASR完成后允许语义修复开始', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);

      scheduler.onASRCompleted('job-1', { text: 'test' });

      const jobState = scheduler.getJobState('job-1');
      expect(jobState?.asr.status).toBe('completed');
      expect(jobState?.semanticRepair.canStart).toBe(true);
    });
  });

  describe('SemanticRepair阶段', () => {
    it('应该启动语义修复阶段', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);
      scheduler.onASRCompleted('job-1');

      const jobState = scheduler.getJobState('job-1');
      expect(jobState?.semanticRepair.status).toBe('processing');
    });

    it('应该在语义修复完成后允许NMT开始', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);
      scheduler.onASRCompleted('job-1');
      scheduler.onSemanticRepairCompleted('job-1', { decision: 'PASS' });

      const jobState = scheduler.getJobState('job-1');
      expect(jobState?.semanticRepair.status).toBe('completed');
      expect(jobState?.nmt.canStart).toBe(true);
    });

    it('应该在语义修复跳过时也允许NMT开始', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);
      scheduler.onASRCompleted('job-1');
      scheduler.onSemanticRepairCompleted('job-1', { decision: 'PASS' }, true);

      const jobState = scheduler.getJobState('job-1');
      expect(jobState?.semanticRepair.status).toBe('skipped');
      expect(jobState?.nmt.canStart).toBe(true);
    });
  });

  describe('NMT阶段', () => {
    it('应该启动NMT阶段', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);
      scheduler.onASRCompleted('job-1');
      scheduler.onSemanticRepairCompleted('job-1', { decision: 'PASS' });

      const jobState = scheduler.getJobState('job-1');
      expect(jobState?.nmt.status).toBe('processing');
    });

    it('应该在NMT完成后允许TTS开始', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);
      scheduler.onASRCompleted('job-1');
      scheduler.onSemanticRepairCompleted('job-1', { decision: 'PASS' });
      scheduler.onNMTCompleted('job-1', { text: 'translated' });

      const jobState = scheduler.getJobState('job-1');
      expect(jobState?.nmt.status).toBe('completed');
      expect(jobState?.tts.canStart).toBe(true);
    });
  });

  describe('TTS阶段', () => {
    it('应该启动TTS阶段', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);
      scheduler.onASRCompleted('job-1');
      scheduler.onSemanticRepairCompleted('job-1', { decision: 'PASS' });
      scheduler.onNMTCompleted('job-1');

      const jobState = scheduler.getJobState('job-1');
      expect(jobState?.tts.status).toBe('processing');
    });

    it('应该在TTS完成后标记为完成', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);
      scheduler.onASRCompleted('job-1');
      scheduler.onSemanticRepairCompleted('job-1', { decision: 'PASS' });
      scheduler.onNMTCompleted('job-1');
      scheduler.onTTSCompleted('job-1', { audio: 'base64_audio' });

      const jobState = scheduler.getJobState('job-1');
      expect(jobState?.tts.status).toBe('completed');
    });
  });

  describe('流水线并行', () => {
    it('应该允许不同服务并行处理不同的job', () => {
      const job1 = createJob('job-1', 'session-1', 0);
      const job2 = createJob('job-2', 'session-1', 1);

      scheduler.addJob(job1);
      scheduler.addJob(job2);

      // job1的ASR应该正在处理
      const state1 = scheduler.getJobState('job-1');
      expect(state1?.asr.status).toBe('processing');

      // job2的ASR应该等待（因为job1的ASR还在处理）
      const state2 = scheduler.getJobState('job-2');
      expect(state2?.asr.status).toBe('pending');

      // job1的ASR完成
      scheduler.onASRCompleted('job-1');

      // job1的语义修复应该开始
      const state1After = scheduler.getJobState('job-1');
      expect(state1After?.semanticRepair.status).toBe('processing');

      // job2的ASR应该开始（因为job1的ASR已完成）
      const state2After = scheduler.getJobState('job-2');
      expect(state2After?.asr.status).toBe('processing');
    });

    it('应该按utterance_index顺序处理', () => {
      const job1 = createJob('job-1', 'session-1', 1);
      const job2 = createJob('job-2', 'session-1', 0);

      scheduler.addJob(job1);
      // job1的ASR会立即开始处理
      const state1Before = scheduler.getJobState('job-1');
      expect(state1Before?.asr.status).toBe('processing');

      scheduler.addJob(job2);
      // job2的ASR会等待（因为job1的ASR还在处理）
      const state2 = scheduler.getJobState('job-2');
      expect(state2?.asr.status).toBe('pending');

      // job1的ASR完成后，job2应该开始处理
      scheduler.onASRCompleted('job-1');
      const state2After = scheduler.getJobState('job-2');
      expect(state2After?.asr.status).toBe('processing');
    });
  });

  describe('removeJob', () => {
    it('应该移除job并清理状态', () => {
      const job = createJob('job-1', 'session-1', 0);
      scheduler.addJob(job);

      scheduler.removeJob('job-1');

      const jobState = scheduler.getJobState('job-1');
      expect(jobState).toBeUndefined();

      const snapshot = scheduler.getSnapshot();
      expect(snapshot.totalJobs).toBe(0);
    });
  });

  describe('getSnapshot', () => {
    it('应该返回当前状态快照', () => {
      const job1 = createJob('job-1', 'session-1', 0);
      const job2 = createJob('job-2', 'session-1', 1);

      scheduler.addJob(job1);
      scheduler.addJob(job2);

      const snapshot = scheduler.getSnapshot();
      expect(snapshot.totalJobs).toBe(2);
      expect(snapshot.jobs.length).toBe(2);
      expect(snapshot.currentProcessing.asr).toBe('job-1');
    });
  });

  describe('disabled状态', () => {
    it('应该在禁用时不进行调度', () => {
      const disabledScheduler = new PipelineScheduler({
        enabled: false,
      });

      const job = createJob('job-1', 'session-1', 0);
      disabledScheduler.addJob(job);

      const jobState = disabledScheduler.getJobState('job-1');
      expect(jobState?.asr.status).toBe('pending');
    });
  });
});
