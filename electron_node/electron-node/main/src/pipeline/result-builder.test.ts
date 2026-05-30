/**
 * ResultBuilder 单元测试
 */

jest.mock('../lexicon/lexicon-runtime-holder', () => ({
  ensureLexiconRuntimeLoaded: jest.fn(() => ({
    status: 'ok',
    manifestVersion: 'test-manifest',
  })),
}));

jest.mock('../fw-detector/fw-mode', () => ({
  isFwDetectorEngineEnabled: jest.fn(() => true),
}));

import { buildJobResult } from './result-builder';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';
import { isFwDetectorEngineEnabled } from '../fw-detector/fw-mode';

const mockIsFwEngine = isFwDetectorEngineEnabled as jest.MockedFunction<
  typeof isFwDetectorEngineEnabled
>;

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

  beforeEach(() => {
    mockIsFwEngine.mockReturnValue(true);
  });

  it('应正确映射 ctx 到 JobResult（FW 最小 extra）', () => {
    const ctx: JobContext = {
      segmentForJobResult: '本段',
      asrText: 'hello',
      translatedText: '你好',
      ttsAudio: 'base64audio',
      ttsFormat: 'opus',
      lexiconRuntimeStatus: 'ok',
      lexiconManifestVersion: 'test-manifest',
    };

    const result = buildJobResult(baseJob, ctx);

    expect(result.text_asr).toBe('本段');
    expect(result.text_translated).toBe('你好');
    expect(result.extra?.lexicon_runtime_status).toBe('ok');
    expect(result.extra?.sentence_repair).toBeUndefined();
    expect(result.extra?.window_candidates).toBeUndefined();
    expect(result.extra?.ctc_nbest_preserved).toBeUndefined();
  });

  it('text_asr 来自 segmentForJobResult', () => {
    const ctx: JobContext = {
      segmentForJobResult: '语义修复后的本段',
      asrText: 'asr',
    };
    const result = buildJobResult(baseJob, ctx);
    expect(result.text_asr).toBe('语义修复后的本段');
  });

  it('segmentForJobResult 为空时不 fallback asrText', () => {
    const ctx: JobContext = { asrText: 'asr fallback' };
    const result = buildJobResult(baseJob, ctx);
    expect(result.text_asr).toBe('');
  });

  it('Recover 模式有 sentenceRepairDecision 时写入 sentence_repair', () => {
    mockIsFwEngine.mockReturnValue(false);
    const ctx: JobContext = {
      segmentForJobResult: '我们要做候选生成',
      asrRepairApplied: true,
      sentenceRepairDecision: {
        text: '我们要做候选生成',
        hypothesisIndex: 0,
        baseText: '我们要做后选生城',
        replacements: [
          {
            windowId: 'h0-aw-4-8-x',
            hypothesisIndex: 0,
            from: '后选生城',
            to: '候选生成',
            start: 4,
            end: 8,
            hotwordId: 'hw-1',
            phoneticScore: 0.9,
            priorScore: 1,
            source: 'lexicon_pinyin_topk',
          },
        ],
        phoneticScore: 0.9,
        hotwordPrior: 1,
        combinedScore: 0.8,
      },
    };
    const result = buildJobResult(baseJob, ctx);
    expect(result.text_asr).toBe('我们要做候选生成');
    expect(result.extra?.sentence_repair?.executed).toBe(true);
  });

  it('text_asr 与 getTextForTranslation 同源', () => {
    const { getTextForTranslation } = require('./post-asr-routing');
    const ctx: JobContext = {
      segmentForJobResult: '段',
      asrText: 'asr',
    };
    expect(buildJobResult(baseJob, ctx).text_asr).toBe(getTextForTranslation(ctx));
  });
});
