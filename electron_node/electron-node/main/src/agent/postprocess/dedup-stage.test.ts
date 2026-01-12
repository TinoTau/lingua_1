/**
 * DedupStage 单元测试
 */

import { DedupStage } from './dedup-stage';
import { JobAssignMessage } from '@shared/protocols/messages';

describe('DedupStage', () => {
  let dedupStage: DedupStage;

  beforeEach(() => {
    dedupStage = new DedupStage();
  });

  const createJob = (overrides?: Partial<JobAssignMessage>): JobAssignMessage => ({
    type: 'job_assign',
    job_id: 'test-job-1',
    attempt_id: 1,
    session_id: 'test-session',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
    dialect: null,
    pipeline: {
      use_asr: true,
      use_nmt: true,
      use_tts: true,
    },
    audio: 'base64_opus_audio_data',
    audio_format: 'opus',
    sample_rate: 16000,
    trace_id: 'test-trace',
    ...overrides,
  });

  describe('去重检查', () => {
    it('应该在首次处理时返回 shouldSend=true', () => {
      const job = createJob();
      const result = dedupStage.process(job, '你好世界', 'Hello World');

      expect(result.shouldSend).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('应该在 job_id 已标记为已发送时返回 shouldSend=false', () => {
      const job = createJob({ job_id: 'test-job-1' });
      
      // 首次处理
      dedupStage.process(job, '你好世界', 'Hello World');
      
      // 标记为已发送
      dedupStage.markJobIdAsSent('test-session', 'test-job-1');
      
      // 再次处理相同 job_id
      const result = dedupStage.process(job, '你好世界', 'Hello World');

      expect(result.shouldSend).toBe(false);
      expect(result.reason).toBe('duplicate_job_id');
    });

    it('应该允许不同 job_id 的处理', () => {
      const job1 = createJob({ job_id: 'test-job-1' });
      const job2 = createJob({ job_id: 'test-job-2' });
      
      // 处理第一个 job
      dedupStage.process(job1, '你好世界', 'Hello World');
      dedupStage.markJobIdAsSent('test-session', 'test-job-1');
      
      // 处理第二个 job（应该允许）
      const result = dedupStage.process(job2, '你好世界', 'Hello World');

      expect(result.shouldSend).toBe(true);
    });

    it('应该允许不同 session 的相同 job_id', () => {
      const job1 = createJob({ job_id: 'test-job-1', session_id: 'session-1' });
      const job2 = createJob({ job_id: 'test-job-1', session_id: 'session-2' });
      
      // 处理第一个 session 的 job
      dedupStage.process(job1, '你好世界', 'Hello World');
      dedupStage.markJobIdAsSent('session-1', 'test-job-1');
      
      // 处理第二个 session 的相同 job_id（应该允许）
      const result = dedupStage.process(job2, '你好世界', 'Hello World');

      expect(result.shouldSend).toBe(true);
    });
  });

  describe('Session 管理', () => {
    it('应该正确清理 session', () => {
      const job = createJob({ session_id: 'test-session' });
      
      // 处理并标记
      dedupStage.process(job, '你好世界', 'Hello World');
      dedupStage.markJobIdAsSent('test-session', 'test-job-1');
      
      // 清理 session
      dedupStage.removeSession('test-session');
      
      // 再次处理应该允许（因为已清理）
      const result = dedupStage.process(job, '你好世界', 'Hello World');

      expect(result.shouldSend).toBe(true);
    });

    it('应该只清理指定的 session', () => {
      const job1 = createJob({ session_id: 'session-1', job_id: 'job-1' });
      const job2 = createJob({ session_id: 'session-2', job_id: 'job-2' });
      
      // 处理两个 session
      dedupStage.process(job1, '你好世界', 'Hello World');
      dedupStage.markJobIdAsSent('session-1', 'job-1');
      
      dedupStage.process(job2, '你好世界', 'Hello World');
      dedupStage.markJobIdAsSent('session-2', 'job-2');
      
      // 只清理 session-1
      dedupStage.removeSession('session-1');
      
      // session-1 应该允许（已清理）
      const result1 = dedupStage.process(job1, '你好世界', 'Hello World');
      expect(result1.shouldSend).toBe(true);
      
      // session-2 应该被拒绝（未清理）
      const result2 = dedupStage.process(job2, '你好世界', 'Hello World');
      expect(result2.shouldSend).toBe(false);
    });
  });

  describe('边界情况', () => {
    it('应该在 session_id 为空时允许发送', () => {
      const job = createJob({ session_id: '' });
      const result = dedupStage.process(job, '你好世界', 'Hello World');

      expect(result.shouldSend).toBe(true);
    });

    it('应该在 session_id 为空格时允许发送', () => {
      const job = createJob({ session_id: '   ' });
      const result = dedupStage.process(job, '你好世界', 'Hello World');

      expect(result.shouldSend).toBe(true);
    });

    it('应该正确处理 markJobIdAsSent 的空参数', () => {
      // 不应该抛出错误
      expect(() => {
        dedupStage.markJobIdAsSent('', 'test-job-1');
        dedupStage.markJobIdAsSent('test-session', '');
        dedupStage.markJobIdAsSent('', '');
      }).not.toThrow();
    });

    it('应该正确处理空文本', () => {
      const job = createJob();
      const result = dedupStage.process(job, '', '');

      expect(result.shouldSend).toBe(true);
    });
  });

  describe('markJobIdAsSent', () => {
    it('应该正确标记 job_id 为已发送', () => {
      const job = createJob({ job_id: 'test-job-1' });
      
      // 首次处理
      const result1 = dedupStage.process(job, '你好世界', 'Hello World');
      expect(result1.shouldSend).toBe(true);
      
      // 标记为已发送
      dedupStage.markJobIdAsSent('test-session', 'test-job-1');
      
      // 再次处理应该被拒绝
      const result2 = dedupStage.process(job, '你好世界', 'Hello World');
      expect(result2.shouldSend).toBe(false);
    });

    it('应该支持多次标记相同的 job_id（幂等）', () => {
      const job = createJob({ job_id: 'test-job-1' });
      
      dedupStage.markJobIdAsSent('test-session', 'test-job-1');
      dedupStage.markJobIdAsSent('test-session', 'test-job-1');
      dedupStage.markJobIdAsSent('test-session', 'test-job-1');
      
      const result = dedupStage.process(job, '你好世界', 'Hello World');
      expect(result.shouldSend).toBe(false);
    });
  });
});
