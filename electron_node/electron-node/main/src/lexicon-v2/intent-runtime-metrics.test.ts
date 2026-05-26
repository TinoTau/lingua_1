import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  buildIntentRuntimeDiagnosticsExtra,
  forceIntentRuntimeMetricsForTest,
  getIntentRuntimeGlobalSnapshot,
  recordIntentJobFinished,
  recordPendingJobReplaced,
  recordIntentQueueDepth,
  resetIntentRuntimeMetricsForTest,
} from './intent-runtime-metrics';

describe('intent-runtime-metrics', () => {
  beforeEach(() => {
    resetIntentRuntimeMetricsForTest();
    forceIntentRuntimeMetricsForTest(true);
  });

  it('maps success and failure outcomes', () => {
    recordIntentJobFinished('profile_updated', 100);
    recordIntentJobFinished('inference_timeout', 200);
    recordIntentJobFinished('skipped_by_debounce', 0);

    const s = getIntentRuntimeGlobalSnapshot();
    expect(s.intentSuccessCount).toBe(1);
    expect(s.intentFailureCount).toBe(1);
    expect(s.intentTimeoutCount).toBe(1);
    expect(s.intentLastLatencyMs).toBe(200);
    expect(s.intentLatencyMs).toBe(200);
  });

  it('counts latest-only replace and queue depth cap', () => {
    recordPendingJobReplaced();
    recordIntentQueueDepth(3, true);

    const s = getIntentRuntimeGlobalSnapshot();
    expect(s.intentLatestOnlyReplaceCount).toBe(1);
    expect(s.intentDroppedJobs).toBe(1);
    expect(s.intentQueueDepth).toBe(2);
    expect(s.llmWorkerBusy).toBe(true);
  });

  it('exports intentRuntime.* namespace in extra', () => {
    recordIntentJobFinished('profile_kept', 50);
    const extra = buildIntentRuntimeDiagnosticsExtra();
    expect(extra['intentRuntime.intentLastLatencyMs']).toBe(50);
    expect(extra['intentRuntime.intentSuccessCount']).toBe(1);
  });
});
