/**
 * AudioAggregator 单元测试 - 集成测试场景（R0-R4）
 * 更多用例见 audio-aggregator-finalize.test.ts
 */

import { AudioAggregator } from './audio-aggregator';
import { decodeOpusToPcm16 } from '../utils/opus-codec';
import {
  SAMPLE_RATE,
  DURATION_TOLERANCE_MS,
  bytesToMsPcm16LE,
  expectApprox,
  recordAsrSnapshot,
  getDebugSnapshot,
  clearDebugSnapshot,
  createMockPcm16Audio,
  createJobAssignMessage,
  JOB_IDS_TO_CLEAR,
} from './audio-aggregator.test.helpers';

jest.mock('../utils/opus-codec', () => ({
  decodeOpusToPcm16: jest.fn(),
  encodePcm16ToOpusBuffer: jest.fn(),
  convertWavToOpus: jest.fn(),
}));

describe('AudioAggregator - 集成测试场景', () => {
  let aggregator: AudioAggregator;
  const mockDecodeOpusToPcm16 = decodeOpusToPcm16 as jest.MockedFunction<typeof decodeOpusToPcm16>;

  jest.setTimeout(30000);

  beforeEach(() => {
    aggregator = new AudioAggregator();
    jest.clearAllMocks();
    clearDebugSnapshot();
  });

  afterEach(() => {
    JOB_IDS_TO_CLEAR.forEach((id) => aggregator.clearBufferByKey(id));
  });

  describe('集成测试场景：MaxDuration finalize修复', () => {
    const MIN_MS = 5000;
    const MAX_MS = 5000;
    const DELTA_PENDING_MS = 2200;
    const JOB1_MS = 9000;

    it('R0: MaxDuration残段合并后仍不足5s时手动切应强制flush送ASR', async () => {
      const sessionId = 'test-session-integration-r0';
      const jobId = 'job-r0';
      const JOB1_MS_R0 = 3000;
      const audio1 = createMockPcm16Audio(JOB1_MS_R0, 16000, { withEnergyVariation: true, silenceRatio: 0.2 });
      const job1 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 0, audio1, {
        is_max_duration_triggered: true,
      });
      await aggregator.processAudioChunk(job1);

      const { buildBufferKey } = require('./audio-aggregator-buffer-key');
      const bufferKey = buildBufferKey(job1);
      const buffer = (aggregator as any).buffers?.get(bufferKey);
      expect(buffer).toBeDefined();
      expect(buffer.audioChunks.length).toBeGreaterThan(0);
      const pendingDurationMs = buffer.totalDurationMs ?? 0;

      const JOB2_MS = Math.max(500, MIN_MS - pendingDurationMs - 200);
      const audio2 = createMockPcm16Audio(JOB2_MS, 16000);
      const job2 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 1, audio2, {
        is_manual_cut: true,
      });
      const result2 = await aggregator.processAudioChunk(job2);
      recordAsrSnapshot(result2);

      const mergedDurationMs = pendingDurationMs + JOB2_MS;
      expect(mergedDurationMs).toBeLessThan(MIN_MS);
      expect(result2.shouldReturnEmpty).toBe(false);
      expect(result2.audioSegments?.length ?? 0).toBeGreaterThan(0);
      const snapshot = getDebugSnapshot();
      expect(snapshot.asrCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('R1: MaxDuration残段补齐到≥5s应该正常送ASR', async () => {
      const sessionId = 'test-session-integration-r1';
      const jobId = 'job-r1';
      const audio1 = createMockPcm16Audio(JOB1_MS, 16000, { withEnergyVariation: true, silenceRatio: 0.2 });
      const job1 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 0, audio1, {
        is_max_duration_triggered: true,
      });
      await aggregator.processAudioChunk(job1);

      const { buildBufferKey } = require('./audio-aggregator-buffer-key');
      const bufferKey = buildBufferKey(job1);
      const buffer = (aggregator as any).buffers?.get(bufferKey);
      expect(buffer).toBeDefined();
      expect(buffer.audioChunks.length).toBeGreaterThan(0);
      const pendingDurationMs = buffer.totalDurationMs ?? 0;
      expect(pendingDurationMs).toBeGreaterThan(0);

      const JOB2_MS = Math.max(500, MIN_MS - pendingDurationMs + 500);
      const audio2 = createMockPcm16Audio(JOB2_MS, 16000);
      const job2 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 1, audio2, {
        is_manual_cut: true,
      });
      const result2 = await aggregator.processAudioChunk(job2);
      recordAsrSnapshot(result2);

      const mergedDurationMs = pendingDurationMs + JOB2_MS;
      expect(mergedDurationMs).toBeGreaterThanOrEqual(MIN_MS);
      expect(result2.shouldReturnEmpty).toBe(false);
      expect(result2.audioSegments).toBeDefined();
      expect(result2.audioSegments!.length).toBeGreaterThan(0);

      const snapshot = getDebugSnapshot();
      expect(snapshot.asrCalls.length).toBeGreaterThan(0);
      if (snapshot.lastAsrCall) {
        expect(['NORMAL_MERGE', 'NORMAL']).toContain(snapshot.lastAsrCall.reason);
        expectApprox(snapshot.lastAsrCall.audioDurationMs || 0, mergedDurationMs, DURATION_TOLERANCE_MS);
      }
      const bufferAfterJob2 = (aggregator as any).buffers?.get(bufferKey);
      if (bufferAfterJob2) {
        expect(bufferAfterJob2.pendingTimeoutAudio).toBeUndefined();
      }
      expect(['NORMAL_MERGE', 'NORMAL']).toContain(result2.reason);
      if (result2.audioSegments && result2.audioSegments.length > 0) {
        let totalDurationMs = 0;
        for (const segmentBase64 of result2.audioSegments) {
          const segmentAudio = Buffer.from(segmentBase64, 'base64');
          totalDurationMs += bytesToMsPcm16LE(segmentAudio.length);
        }
        expect(totalDurationMs).toBeGreaterThanOrEqual(MIN_MS - 500);
      }
    });

    it('R2: manual 触发时应处理<5s的音频', async () => {
      const sessionId = 'test-session-integration-r2';
      const jobId = 'job-r2';
      const audio1 = createMockPcm16Audio(8580);
      const job1 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 0, audio1, {
        is_max_duration_triggered: true,
      });
      await aggregator.processAudioChunk(job1);

      const audio2 = createMockPcm16Audio(1820);
      const job2 = createJobAssignMessage(mockDecodeOpusToPcm16, jobId, sessionId, 1, audio2, {
        is_manual_cut: true,
      });
      const result2 = await aggregator.processAudioChunk(job2);
      recordAsrSnapshot(result2);

      expect(result2.shouldReturnEmpty).toBe(false);
      expect(result2.audioSegments).toBeDefined();
      expect(result2.audioSegments!.length).toBeGreaterThan(0);
      expect(getDebugSnapshot().asrCalls.length).toBeGreaterThan(0);
    });

    it('R3: ASR失败不应触发空核销', async () => {
      const sessionId = 'test-session-integration-r3';
      const audio = createMockPcm16Audio(5000, 16000, { withEnergyVariation: true, silenceRatio: 0.1 });
      const job = createJobAssignMessage(mockDecodeOpusToPcm16, 'job-asr-failure', sessionId, 0, audio, {
        is_manual_cut: true,
      });
      const result = await aggregator.processAudioChunk(job);
      recordAsrSnapshot(result);

      expect(result.shouldReturnEmpty).toBe(false);
      expect(result.audioSegments).toBeDefined();
      expect(result.audioSegments!.length).toBeGreaterThan(0);
      expect(getDebugSnapshot().asrCalls.length).toBeGreaterThan(0);

      const audio2 = createMockPcm16Audio(1000, 16000, { withEnergyVariation: true, silenceRatio: 0.1 });
      const job2 = createJobAssignMessage(mockDecodeOpusToPcm16, 'job-asr-failure-2', sessionId, 1, audio2, {
        is_manual_cut: true,
      });
      const { buildBufferKey } = require('./audio-aggregator-buffer-key');
      const bufferKey = buildBufferKey(job2);
      const buffers = (aggregator as any).buffers;
      const buffer = buffers.get(bufferKey);
      if (buffer) {
        (buffer as any).pendingTimeoutAudio = createMockPcm16Audio(2000);
        (buffer as any).pendingTimeoutAudioCreatedAt = Date.now();
      }

      const result2 = await aggregator.processAudioChunk(job2);
      recordAsrSnapshot(result2);
      expect(result2.shouldReturnEmpty).toBe(false);
    });

    it('R4: 真正无音频才允许empty核销', async () => {
      const sessionId = 'test-session-integration-r4';
      const emptyAudio = Buffer.alloc(0);
      const job = createJobAssignMessage(mockDecodeOpusToPcm16, 'job-empty', sessionId, 0, emptyAudio, {
        is_manual_cut: true,
      });
      mockDecodeOpusToPcm16.mockResolvedValueOnce(Buffer.alloc(0));
      const result = await aggregator.processAudioChunk(job);
      recordAsrSnapshot(result);
      expect(result.shouldReturnEmpty).toBe(true);
      expect(result.reason).toBe('EMPTY_INPUT');
      expect(result.audioSegments).toEqual([]);
    });
  });
});
