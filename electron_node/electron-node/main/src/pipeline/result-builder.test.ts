/**
 * ResultBuilder 单元测试
 * 验证 JobContext → JobResult 转换，以及 jobResult 容器（extra）字段
 */

import { buildJobResult } from './result-builder';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';

describe('ResultBuilder - JobResult 容器', () => {
  const baseJob: JobAssignMessage = {
    job_id: 'job-1',
    session_id: 'session-1',
    utterance_index: 0,
    audio: Buffer.from('test'),
    audio_format: 'opus',
    src_lang: 'zh',
    tgt_lang: 'en',
  } as JobAssignMessage;

  it('应正确映射 ctx 到 JobResult，无 extra 冗余字段', () => {
    const ctx: JobContext = {
      segmentForJobResult: '本段',
      repairedText: '本段',  // 仅用 repairedText 作 text_asr
      asrText: 'hello',
      translatedText: '你好',
      ttsAudio: 'base64audio',
      ttsFormat: 'opus',
    };

    const result = buildJobResult(baseJob, ctx);

    expect(result.text_asr).toBe('本段');
    expect(result.text_translated).toBe('你好');
    expect(result.tts_audio).toBe('base64audio');
    expect(result.tts_format).toBe('opus');
    expect(result.extra).toBeDefined();
    expect(result.extra?.audioBuffered).toBe(false);
    expect(result.extra?.pendingEmptyJobs).toBeUndefined();
    expect((result.extra as any)?.is_consolidated).toBeUndefined();
    expect((result.extra as any)?.consolidated_to_job_ids).toBeUndefined();
  });

  it('有 pendingEmptyJobs 时应写入 extra，供 node-agent 统一发送', () => {
    const ctx: JobContext = {
      asrText: 'hello',
    };
    (ctx as any).pendingEmptyJobs = [
      { job_id: 'job-625', utterance_index: 2 },
      { job_id: 'job-626', utterance_index: 3 },
    ];

    const result = buildJobResult(baseJob, ctx);

    expect(result.extra?.pendingEmptyJobs).toEqual([
      { job_id: 'job-625', utterance_index: 2 },
      { job_id: 'job-626', utterance_index: 3 },
    ]);
  });

  it('audioBuffered 时应写入 extra.audioBuffered', () => {
    const ctx: JobContext = { asrText: '' };
    (ctx as any).audioBuffered = true;

    const result = buildJobResult(baseJob, ctx);

    expect(result.extra?.audioBuffered).toBe(true);
  });

  it('text_asr 仅用 repairedText（聚合/语义修复产出；无兼容回退）', () => {
    const ctx: JobContext = {
      segmentForJobResult: '本段',
      repairedText: '语义修复后的本段',
      asrText: 'asr',
    };
    const result = buildJobResult(baseJob, ctx);
    expect(result.text_asr).toBe('语义修复后的本段');
  });

  it('无 repairedText 时 text_asr 为空（正常应由聚合或语义修复设置 repairedText）', () => {
    const ctx: JobContext = { segmentForJobResult: '本段', asrText: 'asr' };
    const result = buildJobResult(baseJob, ctx);
    expect(result.text_asr).toBe('');
  });

  describe('每个 jobResult 仅含本段文本（不含整 session 合并文）', () => {
    const sessionMergedText = '上一句内容。本段内容。'; // 模拟整段 session 合并文

    it('text_asr 仅来自 repairedText（本段），不得包含更长合并文', () => {
      const ctx: JobContext = {
        segmentForJobResult: '本段内容',
        repairedText: '本段内容',
        translatedText: 'segment only',
      };
      const result = buildJobResult(baseJob, ctx);
      expect(result.text_asr).toBe('本段内容');
      expect(result.text_asr).not.toBe(sessionMergedText);
      expect(result.text_asr).not.toContain('上一句内容');
    });

    it('text_translated 仅来自本段译文，长度与内容均不包含整 session', () => {
      const ctx: JobContext = {
        repairedText: '本段内容',
        translatedText: 'segment only',
      };
      const result = buildJobResult(baseJob, ctx);
      expect(result.text_translated).toBe('segment only');
      expect(result.text_translated).not.toContain('上一句');
      expect(result.text_translated?.length).toBeLessThanOrEqual(20);
    });

    it('当 repairedText 为本段时，result 全文均不出现整段 merged', () => {
      const segmentOnly = '当前这一句。';
      const ctx: JobContext = {
        segmentForJobResult: segmentOnly,
        repairedText: segmentOnly,
        translatedText: 'This sentence.',
      };
      const result = buildJobResult(baseJob, ctx);
      expect(result.text_asr).toBe(segmentOnly);
      expect(result.text_translated).toBe('This sentence.');
      expect(JSON.stringify(result)).not.toMatch(/上一句|合并长句|整段/s);
    });
  });
});
