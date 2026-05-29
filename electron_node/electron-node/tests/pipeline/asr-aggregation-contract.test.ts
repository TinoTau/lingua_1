/**
 * P0-Guard Gate 1: FW 主链必须执行 AGGREGATION，不得绕过。
 */
import { runJobPipeline, ServicesBundle } from '../../main/src/pipeline/job-pipeline';
import { initJobContext } from '../../main/src/pipeline/context/job-context';
import { JobAssignMessage } from '@shared/protocols/messages';
import { inferPipelineMode } from '../../main/src/pipeline/pipeline-mode-config';

const executedSteps: string[] = [];

jest.mock('../../main/src/gpu-arbiter', () => ({
  withGpuLease: jest.fn((_t: string, fn: () => Promise<unknown>) => fn()),
}));

jest.mock('../../main/src/fw-detector/fw-mode', () => ({
  isFwDetectorEngineEnabled: jest.fn(() => true),
  isFwDetectorPipelineActive: jest.fn(() => true),
  getFwDetectorFeatureEnabled: jest.fn(() => true),
  getAsrEngine: jest.fn(() => 'fw_detector_v1'),
  FW_ASR_SERVICE_ID: 'faster-whisper-vad',
}));

jest.mock('../../main/src/node-config', () => {
  const actual = jest.requireActual('../../main/src/node-config');
  return {
    ...actual,
    isSemanticRepairEnabled: jest.fn(() => false),
    isLexiconRecallEnabled: jest.fn(() => false),
    getLexiconRecallSkipReason: jest.fn(() => 'disabled'),
  };
});

jest.mock('../../main/src/pipeline/pipeline-step-registry', () => {
  const actual = jest.requireActual('../../main/src/pipeline/pipeline-step-registry');
  return {
    ...actual,
    executeStep: jest.fn(async (step: string) => {
      executedSteps.push(step);
    }),
  };
});

jest.mock('../../main/src/session-runtime/session-finalize', () => ({
  beginSessionTurnProfile: jest.fn(),
  finalizeSessionTurn: jest.fn(),
}));

jest.mock('../../main/src/lexicon/replay-patch/patch-collector', () => ({
  collectReplayPatchProposal: jest.fn(),
}));

function createJob(overrides?: Partial<JobAssignMessage>): JobAssignMessage {
  return {
    job_id: 'guard-1',
    session_id: 'session-guard',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
    pipeline: { use_asr: true, use_nmt: false, use_tts: false },
    ...overrides,
  } as JobAssignMessage;
}

describe('P0-Guard Gate 1: ASR 不得绕过 AGGREGATION', () => {
  beforeEach(() => {
    executedSteps.length = 0;
  });

  it('FW mode steps 包含 ASR → FW_SPAN_DETECTOR → AGGREGATION', () => {
    const mode = inferPipelineMode(createJob());
    expect(mode.steps).toEqual(
      expect.arrayContaining(['ASR', 'FW_SPAN_DETECTOR', 'AGGREGATION'])
    );
    const asrIdx = mode.steps.indexOf('ASR');
    const fwIdx = mode.steps.indexOf('FW_SPAN_DETECTOR');
    const aggIdx = mode.steps.indexOf('AGGREGATION');
    expect(asrIdx).toBeLessThan(fwIdx);
    expect(fwIdx).toBeLessThan(aggIdx);
  });

  it('runJobPipeline 按序执行 ASR / FW_SPAN_DETECTOR / AGGREGATION', async () => {
    const job = createJob();
    const ctx = initJobContext(job);

    const services: ServicesBundle = { taskRouter: {} as never };
    await runJobPipeline({ job, services, ctx });

    expect(executedSteps).toContain('ASR');
    expect(executedSteps).toContain('FW_SPAN_DETECTOR');
    expect(executedSteps).toContain('AGGREGATION');
    const asrPos = executedSteps.indexOf('ASR');
    const fwPos = executedSteps.indexOf('FW_SPAN_DETECTOR');
    const aggPos = executedSteps.indexOf('AGGREGATION');
    expect(asrPos).toBeLessThan(fwPos);
    expect(aggPos).toBeGreaterThan(fwPos);
  });
});
