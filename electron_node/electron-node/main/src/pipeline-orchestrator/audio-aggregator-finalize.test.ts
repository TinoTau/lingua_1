/**
 * AudioAggregator 单元测试 - finalize / 多 job / 多 session（R5 及后续）
 */

import { AudioAggregator } from './audio-aggregator';
import { decodeOpusToPcm16 } from '../utils/opus-codec';
import {
  DURATION_TOLERANCE_MS,
  bytesToMsPcm16LE,
  msToBytesPcm16LE,
  expectApprox,
  recordAsrSnapshot,
  getDebugSnapshot,
  clearDebugSnapshot,
  createMockPcm16Audio,
  createJobAssignMessage,
  JOB_IDS_TO_CLEAR,
  AsrCallSnapshot,
} from './audio-aggregator.test.helpers';

jest.mock('../utils/opus-codec', () => ({
  decodeOpusToPcm16: jest.fn(),
  encodePcm16ToOpusBuffer: jest.fn(),
  convertWavToOpus: jest.fn(),
}));

describe('AudioAggregator - finalize 与多 session', () => {
  let aggregator: AudioAggregator;
  const mockDecodeOpusToPcm16 = decodeOpusToPcm16 as jest.MockedFunction<typeof decodeOpusToPcm16>;

  jest.setTimeout(30000);

  const MIN_MS = 5000;
  const JOB1_MS = 9000;

  beforeEach(() => {
    aggregator = new AudioAggregator();
    jest.clearAllMocks();
    clearDebugSnapshot();
  });

  afterEach(() => {
    JOB_IDS_TO_CLEAR.forEach((id) => aggregator.clearBufferByKey(id));
  });

  it('R5: originalJobIds头部对齐应该可解释', async () => {
    const sessionId = 'test-session-integration-r5';
    const jobId = 'job-multi-batch';
    const audio1 = createMockPcm16Audio(8000, 16000, { withEnergyVariation: true, silenceRatio: 0.1 });
    const job1 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 0, audio1, {
      is_max_duration_triggered: true,
    });
    const result1 = await aggregator.processAudioChunk(job1);
    expect(result1.shouldReturnEmpty).toBe(true);

    const audio2 = createMockPcm16Audio(1000, 16000);
    const job2 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 1, audio2, {
      is_manual_cut: true,
    });
    const result = await aggregator.processAudioChunk(job2);
    recordAsrSnapshot(result);

    expect(result.shouldReturnEmpty).toBe(false);
    expect(result.audioSegments).toBeDefined();
    expect(result.audioSegments!.length).toBeGreaterThan(0);
    expect(result.originalJobIds).toBeDefined();
    if (result.originalJobIds && result.originalJobIds.length > 0) {
      expect(result.originalJobIds.every(id => id === result.originalJobIds![0])).toBe(true);
    }
    const snapshot = getDebugSnapshot();
    if (snapshot.lastAsrCall && result.originalJobIds) {
      expect(snapshot.lastAsrCall.ownerJobId).toBe(result.originalJobIds[0]);
      expect(snapshot.lastAsrCall.originalJobIds).toEqual(result.originalJobIds);
    }
  });

  it('pending_plus_manual_cut_merged_below_min_should_force_flush', async () => {
    const sessionId = 'test-session-pending-persist';
    const sameJobId = 'job-pending-same';
    const audio1 = createMockPcm16Audio(JOB1_MS, 16000, { withEnergyVariation: true, silenceRatio: 0.2 });
    const job1 = createJobAssignMessage(mockDecodeOpusToPcm16, sameJobId, sessionId, 0, audio1, {
      is_max_duration_triggered: true,
    });
    await aggregator.processAudioChunk(job1);

    const { buildBufferKey } = require('./audio-aggregator-buffer-key');
    const bufferKey = buildBufferKey(job1);
    const buffer1 = (aggregator as any).buffers?.get(bufferKey);
    expect(buffer1).toBeDefined();
    expect(buffer1!.audioChunks.length).toBeGreaterThan(0);
    const pendingDurationMs1 = buffer1!.totalDurationMs ?? 0;

    const JOB2_MS = Math.max(500, MIN_MS - pendingDurationMs1 - 200);
    const audio2 = createMockPcm16Audio(JOB2_MS, 16000);
    const job2 = createJobAssignMessage(mockDecodeOpusToPcm16, sameJobId, sessionId, 1, audio2, {
      is_manual_cut: true,
    });
    const result2 = await aggregator.processAudioChunk(job2);
    recordAsrSnapshot(result2);

    expect(result2.shouldReturnEmpty).toBe(false);
    expect((result2.audioSegments?.length ?? 0)).toBeGreaterThan(0);
    expect(getDebugSnapshot().asrCalls.length).toBeGreaterThanOrEqual(1);
    const buffer2 = (aggregator as any).buffers?.get(bufferKey);
    expect(buffer2?.pendingTimeoutAudio).toBeUndefined();
  });

  it('merged_duration_should_equal_pending_plus_incoming_within_tolerance', async () => {
    const sessionId = 'test-session-merged-duration';
    const sameJobId = 'job-merge-same';
    const audio1 = createMockPcm16Audio(JOB1_MS, 16000, { withEnergyVariation: true, silenceRatio: 0.2 });
    const job1 = createJobAssignMessage(mockDecodeOpusToPcm16, sameJobId, sessionId, 0, audio1, {
      is_max_duration_triggered: true,
    });
    await aggregator.processAudioChunk(job1);

    const { buildBufferKey } = require('./audio-aggregator-buffer-key');
    const bufferKey = buildBufferKey(job1);
    const buffer = (aggregator as any).buffers?.get(bufferKey);
    expect(buffer).toBeDefined();
    const pendingDurationMs = buffer!.totalDurationMs ?? 0;
    const pendingBytes = buffer!.audioChunks.reduce((s, c) => s + c.length, 0);

    const JOB2_MS = Math.max(500, MIN_MS - pendingDurationMs + 500);
    const audio2 = createMockPcm16Audio(JOB2_MS, 16000);
    const incomingDurationMs = bytesToMsPcm16LE(audio2.length);

    const job2 = createJobAssignMessage(mockDecodeOpusToPcm16, sameJobId, sessionId, 1, audio2, {
      is_manual_cut: true,
    });
    const result2 = await aggregator.processAudioChunk(job2);
    recordAsrSnapshot(result2);

    let mergedBytes = 0;
    if (result2.audioSegments && result2.audioSegments.length > 0) {
      for (const segmentBase64 of result2.audioSegments) {
        mergedBytes += Buffer.from(segmentBase64, 'base64').length;
      }
    }
    const mergedDurationMs = bytesToMsPcm16LE(mergedBytes);
    expectApprox(mergedDurationMs, pendingDurationMs + incomingDurationMs, DURATION_TOLERANCE_MS);
    const expectedMergedBytes = pendingBytes + audio2.length;
    const bytesDiff = Math.abs(mergedBytes - expectedMergedBytes);
    expect(bytesDiff).toBeLessThanOrEqual(msToBytesPcm16LE(DURATION_TOLERANCE_MS));
  });

  it('empty_finalize_should_only_happen_when_input_duration_is_zero_and_no_pending', async () => {
    const sessionId = 'test-session-empty-strict';
    const emptyAudio = Buffer.alloc(0);
    const jobA = createJobAssignMessage(mockDecodeOpusToPcm16, 'job-empty-a', sessionId, 0, emptyAudio, {
      is_manual_cut: true,
    });
    mockDecodeOpusToPcm16.mockResolvedValueOnce(Buffer.alloc(0));
    const resultA = await aggregator.processAudioChunk(jobA);
    recordAsrSnapshot(resultA);
    expect(resultA.shouldReturnEmpty).toBe(true);
    expect(resultA.reason).toBe('EMPTY_INPUT');
    expect(resultA.audioSegments).toEqual([]);

    const audioB = createMockPcm16Audio(5000, 16000, { withEnergyVariation: true, silenceRatio: 0.1 });
    const jobB = createJobAssignMessage(mockDecodeOpusToPcm16, 'job-empty-b', sessionId, 1, audioB, {
      is_manual_cut: true,
    });
    const resultB = await aggregator.processAudioChunk(jobB);
    recordAsrSnapshot(resultB);
    expect(resultB.shouldReturnEmpty).toBe(false);
    expect(resultB.audioSegments).toBeDefined();
    expect(resultB.audioSegments!.length).toBeGreaterThan(0);
    expect(resultB.reason).toBeDefined();
    expect(resultB.reason).not.toBe('EMPTY_INPUT');
  });

  it('multi_job_batch_should_be_explainable_and_must_not_empty_close_non_owner_jobs', async () => {
    const sessionId = 'test-session-multi-job';
    const jobId = 'job-multi-owner';
    const audio1 = createMockPcm16Audio(8000, 16000, { withEnergyVariation: true, silenceRatio: 0.1 });
    const job1 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 0, audio1, {
      is_max_duration_triggered: true,
    });
    const result1 = await aggregator.processAudioChunk(job1);
    expect(result1.shouldReturnEmpty).toBe(true);

    const audio2 = createMockPcm16Audio(1000, 16000);
    const job2 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 1, audio2, {
      is_manual_cut: true,
    });
    const result = await aggregator.processAudioChunk(job2);
    recordAsrSnapshot(result);

    expect(result.shouldReturnEmpty).toBe(false);
    expect(result.audioSegments).toBeDefined();
    expect(result.audioSegments!.length).toBeGreaterThan(0);
    expect(result.originalJobIds).toBeDefined();
    if (result.originalJobIds && result.originalJobIds.length > 0) {
      const ownerJobId = result.originalJobIds[0];
      expect(result.originalJobIds.every(id => id === ownerJobId)).toBe(true);
      const snapshot = getDebugSnapshot();
      if (snapshot.lastAsrCall) {
        expect(snapshot.lastAsrCall.ownerJobId).toBe(ownerJobId);
        expect(snapshot.lastAsrCall.originalJobIds).toEqual(result.originalJobIds);
      }
    }
  });

  describe('§4.2/§6.2 补充：多 session 交错与并发', () => {
    it('interleaved_sessions_should_not_cross_talk', async () => {
      const sessionA = 'test-session-interleave-a';
      const sessionB = 'test-session-interleave-b';
      const jobIdA = 'job-a';
      const jobIdB = 'job-b';
      const { buildBufferKey } = require('./audio-aggregator-buffer-key');

      const audioA1 = createMockPcm16Audio(JOB1_MS, 16000, { withEnergyVariation: true, silenceRatio: 0.2 });
      const audioB1 = createMockPcm16Audio(JOB1_MS, 16000, { withEnergyVariation: true, silenceRatio: 0.2 });
      const decodeQueue: Buffer[] = [audioA1, audioB1];
      mockDecodeOpusToPcm16.mockImplementation(() =>
        Promise.resolve(decodeQueue.shift() ?? Buffer.alloc(0))
      );

      const jobA1 = createJobAssignMessage(mockDecodeOpusToPcm16, jobIdA, sessionA, 0, audioA1, {
        is_max_duration_triggered: true,
      }, { skipMock: true });
      const jobB1 = createJobAssignMessage(mockDecodeOpusToPcm16, jobIdB, sessionB, 0, audioB1, {
        is_max_duration_triggered: true,
      }, { skipMock: true });

      await aggregator.processAudioChunk(jobA1);
      const bufA1 = (aggregator as any).buffers?.get(buildBufferKey(jobA1));
      expect(bufA1).toBeDefined();
      expect(bufA1!.audioChunks.length).toBeGreaterThan(0);
      const pendingA1 = bufA1!.totalDurationMs ?? 0;

      await aggregator.processAudioChunk(jobB1);
      const bufB1 = (aggregator as any).buffers?.get(buildBufferKey(jobB1));
      expect(bufB1).toBeDefined();
      expect(bufB1!.audioChunks.length).toBeGreaterThan(0);
      const pendingB1 = bufB1!.totalDurationMs ?? 0;

      const JOB2_MS = Math.max(500, MIN_MS - Math.min(pendingA1, pendingB1) - 200);
      const audioA2 = createMockPcm16Audio(JOB2_MS, 16000);
      const audioB2 = createMockPcm16Audio(JOB2_MS, 16000);
      decodeQueue.push(audioA2, audioB2);

      const jobA2 = createJobAssignMessage(mockDecodeOpusToPcm16, jobIdA, sessionA, 1, audioA2, {
        is_manual_cut: true,
      }, { skipMock: true });
      const jobB2 = createJobAssignMessage(mockDecodeOpusToPcm16, jobIdB, sessionB, 1, audioB2, {
        is_manual_cut: true,
      }, { skipMock: true });

      const resultA2 = await aggregator.processAudioChunk(jobA2);
      recordAsrSnapshot(resultA2, { sessionId: sessionA, jobId: jobA2.job_id });
      const resultB2 = await aggregator.processAudioChunk(jobB2);
      recordAsrSnapshot(resultB2, { sessionId: sessionB, jobId: jobB2.job_id });

      expect(resultA2.shouldReturnEmpty).toBe(false);
      expect(resultB2.shouldReturnEmpty).toBe(false);
      expect(getDebugSnapshot().asrCalls.length).toBeGreaterThanOrEqual(2);
      expect((aggregator as any).buffers?.get(buildBufferKey(jobA1))?.pendingTimeoutAudio).toBeUndefined();
      expect((aggregator as any).buffers?.get(buildBufferKey(jobB1))?.pendingTimeoutAudio).toBeUndefined();
    });

    it('concurrent_sessions_should_complete_without_contamination', async () => {
      const sessionA = 'test-session-concurrent-a';
      const sessionB = 'test-session-concurrent-b';
      const audio5s = createMockPcm16Audio(5000, 16000, { withEnergyVariation: true, silenceRatio: 0.1 });
      mockDecodeOpusToPcm16.mockResolvedValue(audio5s);

      const jobA = createJobAssignMessage(mockDecodeOpusToPcm16, 'job-concurrent-a', sessionA, 0, audio5s, {
        is_manual_cut: true,
      });
      const jobB = createJobAssignMessage(mockDecodeOpusToPcm16, 'job-concurrent-b', sessionB, 0, audio5s, {
        is_manual_cut: true,
      });

      const [resultA, resultB] = await Promise.all([
        aggregator.processAudioChunk(jobA),
        aggregator.processAudioChunk(jobB),
      ]);

      recordAsrSnapshot(resultA, { sessionId: sessionA, jobId: jobA.job_id });
      recordAsrSnapshot(resultB, { sessionId: sessionB, jobId: jobB.job_id });

      expect(resultA.shouldReturnEmpty).toBe(false);
      expect(resultA.audioSegments).toBeDefined();
      expect(resultA.audioSegments!.length).toBeGreaterThan(0);
      expect(resultB.shouldReturnEmpty).toBe(false);
      expect(resultB.audioSegments).toBeDefined();
      expect(resultB.audioSegments!.length).toBeGreaterThan(0);

      const snapshot = getDebugSnapshot();
      expect(snapshot.asrCalls.length).toBe(2);
      const bySession = snapshot.asrCalls.reduce<Record<string, AsrCallSnapshot>>((acc, s) => {
        if (s.sessionId) acc[s.sessionId] = s;
        return acc;
      }, {});
      expect(bySession[sessionA]?.jobId).toBe(jobA.job_id);
      expect(bySession[sessionB]?.jobId).toBe(jobB.job_id);
    });
  });
});
