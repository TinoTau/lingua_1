import { beforeEach, describe, expect, it } from '@jest/globals';
import { enqueueIntentJob, resetIntentWorker } from './cpu-intent-llm-worker';
import {
  inferLexiconProfileDecision,
  resetIntentRunnerState,
  setIntentInferenceOverride,
} from './cpu-llm-model-runner';
import { resetLexiconProfileRegistryCache } from './profile-registry';
import { intentInferenceResult } from './intent-outcome';
import type { RollingTurn } from '../session-runtime/types';
import {
  forceIntentRuntimeMetricsForTest,
  getIntentRuntimeGlobalSnapshot,
  resetIntentRuntimeMetricsForTest,
} from './intent-runtime-metrics';
import { resetIntentRecoveryForTest } from './intent-recovery';
import { resetIntentWarmupForTest } from './intent-warmup';
import { setSkipFirstRunHealthCheck } from './cpu-llm-model-runner';
import { forceIntentRecoveryInProgressForTest } from './intent-recovery';

function turn(id: string): RollingTurn {
  return {
    turnId: id,
    timestamp: Date.now(),
    rawAsrText: '去机场',
    repairedText: '去机场',
    sourceLang: 'zh',
    targetLang: 'en',
    activeProfileAtTurn: 'general',
    recoverStats: { noTopkCandidate: 0, domainBoostApplied: 0 },
  };
}

describe('cpu-intent-llm-worker', () => {
  beforeEach(() => {
    resetIntentWorker();
    resetIntentRunnerState();
    resetLexiconProfileRegistryCache();
    setIntentInferenceOverride(null);
    resetIntentRuntimeMetricsForTest();
    forceIntentRuntimeMetricsForTest(true);
    resetIntentRecoveryForTest();
    resetIntentWarmupForTest();
    setSkipFirstRunHealthCheck(true);
  });

  it('returns mock CPU LLM decision via override', async () => {
    setIntentInferenceOverride(async () =>
      intentInferenceResult('profile_kept', {
        summary: 'travel session',
        primaryDomain: 'travel',
        secondaryDomains: [],
        confidence: 0.9,
        shouldSwitch: true,
        reason: ['airport'],
        effectiveFromTurn: 2,
      })
    );

    const result = await enqueueIntentJob({
      sessionId: 's1',
      turns: [turn('1')],
      currentPrimary: 'general',
      finalizedTurnCount: 1,
    });

    expect(result.decision?.primaryDomain).toBe('travel');
    expect(result.outcome).toBe('profile_kept');
  });

  it('timeout keeps current profile', async () => {
    setIntentInferenceOverride(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(intentInferenceResult('inference_timeout')), 9000);
        })
    );

    const result = await enqueueIntentJob({
      sessionId: 's2',
      turns: [turn('1')],
      currentPrimary: 'general',
      finalizedTurnCount: 1,
    });

    expect(result.decision).toBeNull();
    expect(result.outcome).toBe('inference_timeout');
  }, 10000);

  it('latest-only discards superseded pending job', async () => {
    let call = 0;
    setIntentInferenceOverride(async () => {
      call += 1;
      if (call === 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
      return intentInferenceResult('profile_kept', {
        summary: 'travel',
        primaryDomain: 'travel',
        secondaryDomains: [],
        confidence: 0.9,
        shouldSwitch: true,
        reason: ['airport'],
        effectiveFromTurn: 2,
      });
    });

    const first = enqueueIntentJob({
      sessionId: 's3',
      turns: [turn('1')],
      currentPrimary: 'general',
      finalizedTurnCount: 1,
    });
    await Promise.resolve();

    const superseded = enqueueIntentJob({
      sessionId: 's3',
      turns: [turn('2')],
      currentPrimary: 'general',
      finalizedTurnCount: 2,
    });
    const latest = enqueueIntentJob({
      sessionId: 's3',
      turns: [turn('3')],
      currentPrimary: 'general',
      finalizedTurnCount: 3,
    });

    const supersededResult = await superseded;
    expect(supersededResult.outcome).toBe('skipped_by_debounce');

    const firstResult = await first;
    expect(firstResult.decision?.primaryDomain).toBe('travel');

    const latestResult = await latest;
    expect(latestResult.decision?.primaryDomain).toBe('travel');

    const metrics = getIntentRuntimeGlobalSnapshot();
    expect(metrics.intentLatestOnlyReplaceCount).toBeGreaterThanOrEqual(1);
    expect(metrics.intentDroppedJobs).toBeGreaterThanOrEqual(1);
  });

  it('returns service_unreachable while global recovery in progress', async () => {
    forceIntentRecoveryInProgressForTest(true);
    const result = await enqueueIntentJob({
      sessionId: 's-rec',
      turns: [turn('1')],
      currentPrimary: 'general',
      finalizedTurnCount: 1,
    });
    expect(result.outcome).toBe('service_unreachable');
    forceIntentRecoveryInProgressForTest(false);
  });
});

describe('inferLexiconProfileDecision outcomes', () => {
  beforeEach(() => {
    resetIntentRunnerState();
    setIntentInferenceOverride(null);
  });

  it('override can return schema_invalid outcome', async () => {
    setIntentInferenceOverride(async () => intentInferenceResult('schema_invalid'));
    const result = await inferLexiconProfileDecision({
      sessionId: 'x',
      turns: [turn('1')],
      currentPrimary: 'general',
      finalizedTurnCount: 1,
    });
    expect(result.outcome).toBe('schema_invalid');
  });
});
