/**
 * TranslationStage：节点端不传 context_text
 * 约定：节点端一律传 undefined，由 NMT 服务自行处理上下文。
 */

import { TranslationStage } from './translation-stage';
import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { AggregatorManager } from '../../aggregator/aggregator-manager';
import { getSequentialExecutor } from '../../sequential-executor/sequential-executor-factory';
import { withGpuLease } from '../../gpu-arbiter';

jest.mock('../../task-router/task-router');
jest.mock('../../sequential-executor/sequential-executor-factory');
jest.mock('../../gpu-arbiter');

describe('TranslationStage - context_text（节点端不传）', () => {
  let mockTaskRouter: jest.Mocked<TaskRouter>;
  let mockAggregatorManager: AggregatorManager | null;

  const createJob = (utteranceIndex = 0): JobAssignMessage =>
  ({
    job_id: 'job-1',
    session_id: 's-1',
    utterance_index: utteranceIndex,
    src_lang: 'zh',
    tgt_lang: 'en',
    trace_id: 'trace-1',
  } as JobAssignMessage);

  beforeEach(() => {
    mockTaskRouter = {
      routeNMTTask: jest.fn().mockResolvedValue({ text: 'Translated.' }),
    } as any;

    (getSequentialExecutor as jest.Mock).mockReturnValue({
      execute: (_s: string, _i: number, _t: string, fn: () => Promise<unknown>) => fn(),
    });
    (withGpuLease as jest.Mock).mockImplementation((_type: string, fn: () => Promise<unknown>) => fn());
  });

  it('无论是否有上一句，NMT 被调用时 context_text 均为 undefined', async () => {
    const getLastCommittedText = jest.fn().mockReturnValue('上一句原文。');
    mockAggregatorManager = {
      getLastCommittedText,
      setLastTranslatedText: jest.fn(),
    } as any;

    const stage = new TranslationStage(mockTaskRouter, mockAggregatorManager, {});
    await stage.process(createJob(1), '当前句');

    expect(mockTaskRouter.routeNMTTask).toHaveBeenCalledTimes(1);
    const task = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
    expect(task.text).toBe('当前句');
    expect(task.context_text).toBeUndefined();
  });

  it('无上一句时，NMT 被调用时 context_text 为 undefined', async () => {
    const getLastCommittedText = jest.fn().mockReturnValue(null);
    mockAggregatorManager = {
      getLastCommittedText,
      setLastTranslatedText: jest.fn(),
    } as any;

    const stage = new TranslationStage(mockTaskRouter, mockAggregatorManager, {});
    await stage.process(createJob(0), '当前句');

    const task = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
    expect(task.context_text).toBeUndefined();
  });

  it('aggregatorManager 为 null 时，context_text 为 undefined', async () => {
    mockAggregatorManager = null;
    const stage = new TranslationStage(mockTaskRouter, mockAggregatorManager, {});
    await stage.process(createJob(1), '当前句');

    const task = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
    expect(task.context_text).toBeUndefined();
  });
});

describe('TranslationStage - 模拟语义修复输出，验证 NMT 处理流程', () => {
  let mockTaskRouter: jest.Mocked<TaskRouter>;
  let mockAggregatorManager: AggregatorManager | null;

  const createJob = (utteranceIndex = 0): JobAssignMessage =>
  ({
    job_id: 'job-1',
    session_id: 's-1',
    utterance_index: utteranceIndex,
    src_lang: 'zh',
    tgt_lang: 'en',
    trace_id: 'trace-1',
  } as JobAssignMessage);

  const mockAggregator = (getLastCommittedText: () => string | null) => ({
    getLastCommittedText: jest.fn().mockImplementation(getLastCommittedText),
    setLastTranslatedText: jest.fn(),
  });

  beforeEach(() => {
    mockTaskRouter = {
      routeNMTTask: jest.fn(),
    } as any;

    (getSequentialExecutor as jest.Mock).mockReturnValue({
      execute: (_s: string, _i: number, _t: string, fn: () => Promise<unknown>) => fn(),
    });
    (withGpuLease as jest.Mock).mockImplementation((_type: string, fn: () => Promise<unknown>) => fn());
  });

  it('首句（无 context）：语义修复输出本段，NMT 仅收 text，返回即译文', async () => {
    const segmentFromAggregation = '我们开始进行一次语音识别稳定性测试';
    const nmtReturn = 'We start a voice recognition stability test.';
    mockTaskRouter.routeNMTTask.mockResolvedValue({ text: nmtReturn });
    mockAggregatorManager = mockAggregator(() => null) as any;

    const stage = new TranslationStage(mockTaskRouter, mockAggregatorManager, {});
    const result = await stage.process(createJob(0), segmentFromAggregation);

    expect(result.translatedText).toBe(nmtReturn);
    expect(mockTaskRouter.routeNMTTask).toHaveBeenCalledTimes(1);
    const task = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
    expect(task.text).toBe(segmentFromAggregation);
    expect(task.context_text).toBeUndefined();
    expect(task.src_lang).toBe('zh');
    expect(task.tgt_lang).toBe('en');
  });

  it('第二句：节点端不传 context_text，NMT 仅收 text，返回当前句译文', async () => {
    const segmentThisJob = '必要的时候提前结束本次识别';
    const nmtReturn = 'When necessary, end this recognition in advance.';
    mockTaskRouter.routeNMTTask.mockResolvedValue({ text: nmtReturn });
    mockAggregatorManager = mockAggregator(() => '上一句已提交') as any;

    const stage = new TranslationStage(mockTaskRouter, mockAggregatorManager, {});
    const result = await stage.process(createJob(1), segmentThisJob);

    expect(result.translatedText).toBe(nmtReturn);
    const task = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
    expect(task.text).toBe(segmentThisJob);
    expect(task.context_text).toBeUndefined();
  });

  it('语义修复输出为空时，不调用 NMT，返回空译文', async () => {
    mockAggregatorManager = mockAggregator(() => null) as any;
    const stage = new TranslationStage(mockTaskRouter, mockAggregatorManager, {});

    const resultEmpty = await stage.process(createJob(0), '');
    expect(resultEmpty.translatedText).toBe('');
    expect(mockTaskRouter.routeNMTTask).not.toHaveBeenCalled();

    (mockTaskRouter.routeNMTTask as jest.Mock).mockClear();
    const resultSpace = await stage.process(createJob(0), '   ');
    expect(resultSpace.translatedText).toBe('');
    expect(mockTaskRouter.routeNMTTask).not.toHaveBeenCalled();
  });

  it('NMT 返回值即 process 返回值，不做剪辑或去上文', async () => {
    const segment = '一句会尽量的连续地说的长一些中间只把留自然的呼吸节奏不做可以的';
    const nmtReturn = 'A sentence will try to say as long as possible, with only natural breathing rhythm.';
    mockTaskRouter.routeNMTTask.mockResolvedValue({ text: nmtReturn });
    mockAggregatorManager = mockAggregator(() => '上一段内容。') as any;

    const stage = new TranslationStage(mockTaskRouter, mockAggregatorManager, {});
    const result = await stage.process(createJob(1), segment);

    expect(result.translatedText).toBe(nmtReturn);
    expect(result.translatedText).not.toContain('上一段'); // 约定：NMT 只返回当前句译文
  });
});
