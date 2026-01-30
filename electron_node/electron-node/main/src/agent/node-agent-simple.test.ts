/**
 * NodeAgent 单元测试（buildResultsToSend）
 * 单发送点：同一 job_id 只发一次；主结果 + 空容器核销去重。
 */

import { buildResultsToSend } from './node-agent-simple';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../inference/inference-service';

function makeJob(jobId: string, utteranceIndex: number): JobAssignMessage {
  return {
    job_id: jobId,
    session_id: 's1',
    utterance_index: utteranceIndex,
    audio: Buffer.from(''),
    audio_format: 'opus',
    src_lang: 'zh',
    tgt_lang: 'en',
  } as JobAssignMessage;
}

function makeFinalResult(extra?: Record<string, unknown>): JobResult {
  return {
    text_asr: 'asr',
    text_translated: 'trans',
    tts_audio: 'audio',
    should_send: true,
    extra: extra ?? {},
  } as JobResult;
}

describe('buildResultsToSend', () => {
  it('无 pendingEmptyJobs 时只返回主结果一项', () => {
    const job = makeJob('job-main', 0);
    const list = buildResultsToSend(job, {
      finalResult: makeFinalResult(),
      shouldSend: true,
    });
    expect(list).toHaveLength(1);
    expect(list[0].job.job_id).toBe('job-main');
  });

  it('pendingEmptyJobs 为不同 job_id 时追加空核销，每 job_id 一项', () => {
    const job = makeJob('job-main', 0);
    const list = buildResultsToSend(job, {
      finalResult: makeFinalResult({
        pendingEmptyJobs: [
          { job_id: 'job-empty-1', utterance_index: 1 },
          { job_id: 'job-empty-2', utterance_index: 2 },
        ],
      }),
      shouldSend: true,
    });
    expect(list).toHaveLength(3);
    expect(list.map((i) => i.job.job_id)).toEqual(['job-main', 'job-empty-1', 'job-empty-2']);
    expect(list[1].result.extra).toEqual({ reason: 'NO_TEXT_ASSIGNED' });
    expect(list[2].result.extra).toEqual({ reason: 'NO_TEXT_ASSIGNED' });
  });

  it('pendingEmptyJobs 包含主 job_id 时跳过，主 job 只出现一次', () => {
    const job = makeJob('job-main', 0);
    const list = buildResultsToSend(job, {
      finalResult: makeFinalResult({
        pendingEmptyJobs: [
          { job_id: 'job-main', utterance_index: 0 },
          { job_id: 'job-empty-1', utterance_index: 1 },
        ],
      }),
      shouldSend: true,
    });
    expect(list).toHaveLength(2);
    expect(list[0].job.job_id).toBe('job-main');
    expect(list[1].job.job_id).toBe('job-empty-1');
  });

  it('pendingEmptyJobs 内重复 job_id 时只保留第一次', () => {
    const job = makeJob('job-main', 0);
    const list = buildResultsToSend(job, {
      finalResult: makeFinalResult({
        pendingEmptyJobs: [
          { job_id: 'job-a', utterance_index: 1 },
          { job_id: 'job-a', utterance_index: 1 },
          { job_id: 'job-b', utterance_index: 2 },
        ],
      }),
      shouldSend: true,
    });
    expect(list).toHaveLength(3);
    expect(list.map((i) => i.job.job_id)).toEqual(['job-main', 'job-a', 'job-b']);
  });

  it('shouldSend 为 false 时不追加空核销', () => {
    const job = makeJob('job-main', 0);
    const list = buildResultsToSend(job, {
      finalResult: makeFinalResult({
        pendingEmptyJobs: [{ job_id: 'job-empty-1', utterance_index: 1 }],
      }),
      shouldSend: false,
    });
    expect(list).toHaveLength(1);
    expect(list[0].job.job_id).toBe('job-main');
  });

  it('返回列表中每个 job_id 仅出现一次，保证发送层不会重复发送', () => {
    const job = makeJob('job-main', 0);
    const list = buildResultsToSend(job, {
      finalResult: makeFinalResult({
        pendingEmptyJobs: [
          { job_id: 'job-a', utterance_index: 1 },
          { job_id: 'job-main', utterance_index: 0 },
          { job_id: 'job-a', utterance_index: 1 },
          { job_id: 'job-b', utterance_index: 2 },
        ],
      }),
      shouldSend: true,
    });
    const jobIds = list.map((i) => i.job.job_id);
    expect(jobIds).toHaveLength(new Set(jobIds).size);
    expect(jobIds).toEqual(['job-main', 'job-a', 'job-b']);
  });

  it('任意 buildResultsToSend 结果：模拟发送循环时每个 job_id 仅被发送一次', () => {
    const scenarios: Array<{ jobId: string; pending: Array<{ job_id: string; utterance_index: number }>; shouldSend: boolean }> = [
      { jobId: 'j0', pending: [], shouldSend: true },
      { jobId: 'j1', pending: [{ job_id: 'j2', utterance_index: 1 }], shouldSend: true },
      { jobId: 'j3', pending: [{ job_id: 'j3', utterance_index: 0 }, { job_id: 'j4', utterance_index: 1 }], shouldSend: true },
      { jobId: 'j5', pending: [{ job_id: 'j6', utterance_index: 1 }, { job_id: 'j6', utterance_index: 1 }, { job_id: 'j7', utterance_index: 2 }], shouldSend: true },
    ];
    for (const { jobId, pending, shouldSend } of scenarios) {
      const job = makeJob(jobId, 0);
      const list = buildResultsToSend(job, {
        finalResult: makeFinalResult(pending.length ? { pendingEmptyJobs: pending } : undefined),
        shouldSend,
      });
      const sendCountByJobId = list.reduce<Record<string, number>>((acc, item) => {
        acc[item.job.job_id] = (acc[item.job.job_id] ?? 0) + 1;
        return acc;
      }, {});
      const allOnce = Object.values(sendCountByJobId).every((c) => c === 1);
      expect(allOnce).toBe(true);
    }
  });
});
