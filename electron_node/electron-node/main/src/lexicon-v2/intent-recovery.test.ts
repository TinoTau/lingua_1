import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  forceIntentRecoveryForTest,
  forceIntentRecoveryInProgressForTest,
  maybeScheduleIntentRecovery,
  resetIntentRecoveryForTest,
} from './intent-recovery';
import {
  forceIntentRuntimeMetricsForTest,
  getConsecutiveTimeoutFailures,
  recordIntentJobFinished,
  resetIntentRuntimeMetricsForTest,
} from './intent-runtime-metrics';
import { resetIntentHealthCache } from './intent-health-check';

describe('intent-recovery', () => {
  beforeEach(() => {
    resetIntentRecoveryForTest();
    resetIntentRuntimeMetricsForTest();
    forceIntentRuntimeMetricsForTest(true);
    forceIntentRecoveryForTest(true);
    resetIntentHealthCache();
    forceIntentRecoveryInProgressForTest(false);
  });

  it('schedules recovery on service_unreachable (async health refresh)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ model_loaded: true, status: 'ok' }),
      } as Response)
    );
    maybeScheduleIntentRecovery('service_unreachable');
    await new Promise((r) => setTimeout(r, 2500));
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockRestore();
  }, 10000);

  it('requires consecutive timeouts before recovery', () => {
    recordIntentJobFinished('inference_timeout', 100);
    expect(getConsecutiveTimeoutFailures()).toBe(1);
  });
});
