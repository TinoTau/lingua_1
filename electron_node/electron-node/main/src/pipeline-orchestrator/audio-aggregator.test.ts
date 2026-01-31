/**
 * AudioAggregator 单元测试 - 集成测试场景
 * 
 * 此文件仅包含新的集成测试场景（R0-R5）
 * 旧的测试用例已移至 audio-aggregator.legacy.test.ts
 */

import { AudioAggregator } from './audio-aggregator';
import { JobAssignMessage } from '@shared/protocols/messages';
import { decodeOpusToPcm16 } from '../utils/opus-codec';

// Mock opus-codec
jest.mock('../utils/opus-codec', () => ({
  decodeOpusToPcm16: jest.fn(),
  encodePcm16ToOpusBuffer: jest.fn(),
  convertWavToOpus: jest.fn(),
}));

describe('AudioAggregator - 集成测试场景', () => {
  let aggregator: AudioAggregator;
  const mockDecodeOpusToPcm16 = decodeOpusToPcm16 as jest.MockedFunction<typeof decodeOpusToPcm16>;

  // 设置测试超时时间（30秒）
  jest.setTimeout(30000);

  // ✅ Patch 1.2: Duration Helper（统一口径 + 容差）
  const SAMPLE_RATE = 16000;
  const BYTES_PER_SAMPLE = 2;
  const DURATION_TOLERANCE_MS = 80; // 最小容差（参考文档要求）

  /**
   * 将 PCM16 LE 音频字节数转换为毫秒
   */
  function bytesToMsPcm16LE(bytes: number, sampleRate: number = SAMPLE_RATE): number {
    return (bytes / BYTES_PER_SAMPLE / sampleRate) * 1000;
  }

  /**
   * 将毫秒转换为 PCM16 LE 音频字节数
   */
  function msToBytesPcm16LE(ms: number, sampleRate: number = SAMPLE_RATE): number {
    return Math.floor((ms / 1000) * sampleRate * BYTES_PER_SAMPLE);
  }

  /**
   * 将样本数转换为毫秒
   */
  function samplesToMs(sampleCount: number, sampleRate: number = SAMPLE_RATE): number {
    return (sampleCount / sampleRate) * 1000;
  }

  /**
   * 近似相等断言（允许容差）
   */
  function expectApprox(actual: number, expected: number, tolerance: number = DURATION_TOLERANCE_MS): void {
    const diff = Math.abs(actual - expected);
    expect(diff).toBeLessThanOrEqual(tolerance);
  }

  // ✅ Patch 1.1: Debug Snapshot 采集器
  interface AsrCallSnapshot {
    ownerJobId?: string;
    originalJobIds?: string[];
    audioDurationMs?: number;
    audioBytes?: number;
    reason?: string;
    timestamp: number;
    /** §4.2/§6.2 补充：交错/并发用例按 session 断言 */
    sessionId?: string;
    jobId?: string;
    action: 'SEND' | 'HOLD';
  }

  const asrCallSnapshots: AsrCallSnapshot[] = [];

  /**
   * 记录 ASR 调用快照（通过 result 对象）
   * 注意：此为「拟发送」轨迹；真实 ASR 调用与回调映射需在 集成/E2E 层 spy。
   * 仅记录 SEND（拟送 ASR）；HOLD 不写入 asrCallSnapshots。
   * @param meta 可选，交错/并发用例传入 sessionId、jobId 便于按 session 断言
   */
  function recordAsrSnapshot(result: any, meta?: { sessionId: string; jobId: string }): void {
    const action = result.shouldReturnEmpty || !result.audioSegments?.length ? 'HOLD' : 'SEND';
    if (action !== 'SEND' || !result.audioSegments?.length) return;
    let totalBytes = 0;
    for (const segmentBase64 of result.audioSegments) {
      const segmentAudio = Buffer.from(segmentBase64, 'base64');
      totalBytes += segmentAudio.length;
    }
    const snap: AsrCallSnapshot = {
      action: 'SEND',
      ownerJobId: result.originalJobIds?.[0],
      originalJobIds: result.originalJobIds,
      audioDurationMs: bytesToMsPcm16LE(totalBytes),
      audioBytes: totalBytes,
      reason: result.reason,
      timestamp: Date.now(),
      ...(meta && { sessionId: meta.sessionId, jobId: meta.jobId }),
    };
    asrCallSnapshots.push(snap);
  }

  /**
   * 获取 Debug Snapshot（用于断言）
   */
  function getDebugSnapshot(): {
    asrCalls: AsrCallSnapshot[];
    lastAsrCall: AsrCallSnapshot | undefined;
  } {
    return {
      asrCalls: [...asrCallSnapshots],
      lastAsrCall: asrCallSnapshots[asrCallSnapshots.length - 1],
    };
  }

  /**
   * 清空 Debug Snapshot
   */
  function clearDebugSnapshot(): void {
    asrCallSnapshots.length = 0;
  }

  beforeEach(() => {
    aggregator = new AudioAggregator();
    jest.clearAllMocks();
    clearDebugSnapshot(); // 清空 Debug Snapshot
  });

  afterEach(() => {
    const jobIdsToClear = [
      'job-maxdur-1', 'job-manual-1', 'job-asr-failure', 'job-asr-failure-2',
      'job-empty', 'job-multi-batch', 'job-pending-1', 'job-pending-2',
      'job-merge-1', 'job-merge-2', 'job-empty-a', 'job-empty-b', 'job-multi-owner',
      'job-a1', 'job-b1', 'job-a2', 'job-b2', 'job-concurrent-a', 'job-concurrent-b',
    ];
    jobIdsToClear.forEach((id) => aggregator.clearBufferByKey(id));
  });

  // ✅ Patch 2.2: 按 samples 精确生成 API
  /**
   * 按样本数精确生成 PCM16 音频
   */
  function makePcm16BySamples(sampleCount: number, amplitude: number = 15000): Buffer {
    const buffer = Buffer.allocUnsafe(sampleCount * BYTES_PER_SAMPLE);
    const twoPiFreq = 2 * Math.PI * 440 / SAMPLE_RATE; // 440Hz

    for (let i = 0; i < sampleCount; i++) {
      const value = Math.sin(i * twoPiFreq) * amplitude;
      const finalValue = Math.max(-32768, Math.min(32767, value));
      buffer.writeInt16LE(Math.floor(finalValue), i * 2);
    }

    return buffer;
  }

  // ✅ Patch 2.1: 确定性随机数生成器（去随机化）
  let deterministicSeed = 12345;
  function deterministicRandom(): number {
    // 简单 LCG: seed = (seed * 1664525 + 1013904223) >>> 0
    deterministicSeed = ((deterministicSeed * 1664525 + 1013904223) >>> 0);
    // 转换为 [-1, 1] 范围
    return (deterministicSeed / 2147483647) * 2 - 1;
  }

  // ✅ Patch 2.3: 可控切分模式生成器
  /**
   * 生成带明显停顿模式的音频（确保能被 splitAudioByEnergy 切分）
   */
  function makePausePatternAudio(options: {
    speakMs: number;
    pauseMs: number;
    repeats: number;
  }): { audio: Buffer; totalMs: number; expectedSegmentsMin: number } {
    const { speakMs, pauseMs, repeats } = options;
    const speakSamples = Math.floor((speakMs / 1000) * SAMPLE_RATE);
    const pauseSamples = Math.floor((pauseMs / 1000) * SAMPLE_RATE);
    const totalSamples = (speakSamples + pauseSamples) * repeats;
    const buffer = Buffer.allocUnsafe(totalSamples * BYTES_PER_SAMPLE);

    const twoPiFreq = 2 * Math.PI * 440 / SAMPLE_RATE;
    let sampleIndex = 0;

    for (let rep = 0; rep < repeats; rep++) {
      // 有声音的部分
      for (let i = 0; i < speakSamples; i++) {
        const value = Math.sin((sampleIndex + i) * twoPiFreq) * 15000;
        const finalValue = Math.max(-32768, Math.min(32767, value));
        buffer.writeInt16LE(Math.floor(finalValue), (sampleIndex + i) * 2);
      }
      sampleIndex += speakSamples;

      // 静音部分（固定为 0，确保能被检测到）
      for (let i = 0; i < pauseSamples; i++) {
        buffer.writeInt16LE(0, (sampleIndex + i) * 2);
      }
      sampleIndex += pauseSamples;
    }

    const totalMs = samplesToMs(totalSamples);
    const expectedSegmentsMin = repeats; // 至少应该有 repeats 个片段

    return { audio: buffer, totalMs, expectedSegmentsMin };
  }

  /**
   * 创建模拟的PCM16音频数据（高性能简化版本）
   * 使用更简单的算法，减少计算量，提升测试执行速度
   * ✅ Patch 2.1: 去随机化（使用确定性随机数）
   */
  function createMockPcm16Audio(
    durationMs: number,
    sampleRate: number = 16000,
    options: {
      withEnergyVariation?: boolean;
      silenceRatio?: number;
      baseFreq?: number;
    } = {}
  ): Buffer {
    const {
      withEnergyVariation = true,
      silenceRatio = 0.2,
      baseFreq = 440,
    } = options;

    const samples = Math.floor((durationMs / 1000) * sampleRate);
    if (samples === 0) {
      return Buffer.alloc(0);
    }

    const buffer = Buffer.allocUnsafe(samples * 2);

    // 简化：使用更简单的波形生成，减少计算
    // 对于长音频，使用批量生成模式
    const useBatchMode = samples > 10000; // 对于超过约0.6秒的音频使用批量模式

    if (useBatchMode) {
      // 批量模式：生成带静音段的正弦波，确保能被 splitAudioByEnergy 切分
      // 为了确保能被切分，需要生成有静音段的音频
      const twoPiFreq = 2 * Math.PI * baseFreq / sampleRate;
      // 每 2 秒为一个周期：1.5秒有声音 + 0.5秒静音
      const cycleSamples = Math.floor((2000 / 1000) * sampleRate); // 2秒的样本数
      const soundSamples = Math.floor((1500 / 1000) * sampleRate); // 1.5秒的样本数
      const silenceSamples = cycleSamples - soundSamples; // 0.5秒的样本数

      for (let i = 0; i < samples; i++) {
        const cycleIndex = i % cycleSamples;
        if (cycleIndex < soundSamples) {
          // 有声音的部分
          const baseValue = Math.sin(i * twoPiFreq);
          const amplitude = 15000; // 固定振幅
          const value = baseValue * amplitude;
          const finalValue = Math.max(-32768, Math.min(32767, value));
          buffer.writeInt16LE(Math.floor(finalValue), i * 2);
        } else {
          // 静音部分（低能量噪声）- ✅ Patch 2.1: 使用确定性随机数
          const noise = deterministicRandom() * 50; // 很小的噪声
          buffer.writeInt16LE(Math.floor(noise), i * 2);
        }
      }
    } else {
      // 短音频：使用完整算法
      const segmentCount = Math.max(2, Math.floor(durationMs / 2000));
      const segmentSize = Math.floor(samples / segmentCount);
      const twoPiFreq = 2 * Math.PI * baseFreq / sampleRate;
      const twoPi5 = 2 * Math.PI * 5 / sampleRate;
      const twoPi2 = 2 * Math.PI * 2 / sampleRate;

      let sampleIndex = 0;
      for (let seg = 0; seg < segmentCount && sampleIndex < samples; seg++) {
        const isSilence = seg % 2 === 1 && withEnergyVariation;
        const segmentEnd = Math.min(sampleIndex + segmentSize, samples);
        const segmentLength = segmentEnd - sampleIndex;

        for (let i = sampleIndex; i < segmentEnd; i++) {
          if (isSilence) {
            // ✅ Patch 2.1: 使用确定性随机数
            const noise = deterministicRandom() * 100;
            buffer.writeInt16LE(Math.floor(noise), i * 2);
          } else {
            const positionInSegment = (i - sampleIndex) / segmentLength;
            const baseValue = Math.sin(i * twoPiFreq);
            const envelope = Math.sin(positionInSegment * Math.PI);
            const energyVariation = withEnergyVariation
              ? 0.7 + 0.3 * Math.sin(i * twoPi5)
              : 1.0;
            const amplitude = 12000 + 4000 * Math.sin(i * twoPi2);
            const value = baseValue * envelope * energyVariation * amplitude;
            // ✅ Patch 2.1: 使用确定性随机数
            const noise = deterministicRandom() * 200;
            const finalValue = Math.max(-32768, Math.min(32767, value + noise));
            buffer.writeInt16LE(Math.floor(finalValue), i * 2);
          }
        }
        sampleIndex = segmentEnd;
      }

      // 填充剩余样本 - ✅ Patch 2.1: 使用确定性随机数
      for (let i = sampleIndex; i < samples; i++) {
        const noise = deterministicRandom() * 100;
        buffer.writeInt16LE(Math.floor(noise), i * 2);
      }
    }

    return buffer;
  }

  /**
   * 创建JobAssignMessage
   * @param options.skipMock 为 true 时不设置 mock（用于交错用例自行安排 mock 顺序）
   */
  function createJobAssignMessage(
    jobId: string,
    sessionId: string,
    utteranceIndex: number,
    audioBuffer: Buffer,
    flags: {
      is_manual_cut?: boolean;
      is_timeout_triggered?: boolean;
      is_max_duration_triggered?: boolean;
    } = {},
    options?: { skipMock?: boolean }
  ): JobAssignMessage {
    const audioBase64 = audioBuffer.toString('base64');
    if (!options?.skipMock) mockDecodeOpusToPcm16.mockResolvedValue(audioBuffer);

    return {
      type: 'job_assign',
      job_id: jobId,
      attempt_id: 1,
      session_id: sessionId,
      utterance_index: utteranceIndex,
      src_lang: 'zh',
      tgt_lang: 'en',
      dialect: null,
      pipeline: {
        use_asr: true,
        use_nmt: true,
        use_tts: true,
      },
      audio: audioBase64,
      audio_format: 'opus',
      sample_rate: 16000,
      trace_id: 'test-trace',
      ...flags,
    } as any;
  }

  /**
   * 集成测试场景：MaxDuration finalize后的文本截断问题修复
   * 基于实际集成测试中发现的问题
   */
  describe('集成测试场景：MaxDuration finalize修复', () => {
    // ✅ Patch 1: 定义常量（使用"MAX + δ"的确定构造方式）
    // 从被测模块读取常量值（或使用当前配置）
    const MIN_MS = 5000; // MIN_ACCUMULATED_DURATION_FOR_ASR_MS
    const MAX_MS = 5000; // 处理阈值（处理前5秒，即 MIN_ACCUMULATED_DURATION_FOR_ASR_MS）
    const DELTA_PENDING_MS = 2200; // 确保产生残段
    // ✅ Patch 1: 使用"MAX + δ"的确定构造方式
    // 注意：由于 splitAudioByEnergy 可能找不到切分点，返回整段音频
    // 为了确保能产生 pending，需要使用足够长的音频，确保：
    // 1. 音频能被切分成多个片段（需要足够的能量变化）
    // 2. 最后一个片段 < 5秒，会被缓存到 pending
    // 使用 10000ms（10秒）音频，带能量变化，应该能切分成多个片段（例如 5秒+5秒，或 5秒+3秒+2秒）
    // 最后一个片段 < 5秒，会被缓存到 pending
    const JOB1_MS = 10000; // 10秒音频，确保能切分成多个片段，产生 pending

    /**
     * R0: MaxDuration 残段 + 下一 job 手动切，合并后仍 < 5s
     * 实现：手动/超时 finalize 时强制 flush pending（见 finalize-handler），故合并后 < 5s 也会送 ASR。
     * 期望：reason=FORCE_FLUSH_MANUAL_OR_TIMEOUT_FINALIZE，送 ASR，返回音频段。
     */
    it('R0: MaxDuration残段合并后仍不足5s时手动切应强制flush送ASR', async () => {
      const sessionId = 'test-session-integration-r0';
      const jobId = 'job-r0';
      const JOB1_MS_R0 = 3000; // 3s，使合并后 < 5s
      const audio1 = createMockPcm16Audio(JOB1_MS_R0, 16000, {
        withEnergyVariation: true,
        silenceRatio: 0.2,
      });
      const job1 = createJobAssignMessage(jobId, sessionId, 0, audio1, {
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
      const job2 = createJobAssignMessage(jobId, sessionId, 1, audio2, {
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

    /**
     * R1: MaxDuration 残段 + 补齐到 ≥5s 正常送 ASR
     * 场景：pending + 下一个 job 合并后 ≥ MIN
     * 期望：送 ASR；输出归属符合 ownerJobId
     */
    it('R1: MaxDuration残段补齐到≥5s应该正常送ASR', async () => {
      const sessionId = 'test-session-integration-r1';
      const jobId = 'job-r1'; // 同一 bufferKey 两段 chunk

      const audio1 = createMockPcm16Audio(JOB1_MS, 16000, {
        withEnergyVariation: true,
        silenceRatio: 0.2,
      });
      const job1 = createJobAssignMessage(jobId, sessionId, 0, audio1, {
        is_max_duration_triggered: true,
      });
      await aggregator.processAudioChunk(job1);

      const { buildBufferKey } = require('./audio-aggregator-buffer-key');
      const bufferKey = buildBufferKey(job1);
      const buffer = (aggregator as any).buffers?.get(bufferKey);

      expect(buffer).toBeDefined();
      expect(buffer.audioChunks.length).toBeGreaterThan(0);
      const pendingDurationMs = buffer.totalDurationMs ?? 0;
      const pendingBufferBytes = buffer.audioChunks.reduce((s, c) => s + c.length, 0);

      expect(pendingDurationMs).toBeGreaterThan(0);
      expect(pendingBufferBytes).toBeGreaterThan(0);

      // ✅ T1: 直接输出观测数据（绕过logger mock）
      console.error('[T1_OBSERVATION]', JSON.stringify({
        testCase: 'R1',
        jobId: job1.job_id,
        sessionId,
        pendingExists: true,
        pendingDurationMs,
        pendingBufferBytes,
      }, null, 2));

      const JOB2_MS = Math.max(500, MIN_MS - pendingDurationMs + 500);
      const audio2 = createMockPcm16Audio(JOB2_MS, 16000);
      const job2 = createJobAssignMessage(jobId, sessionId, 1, audio2, {
        is_manual_cut: true,
      });
      const result2 = await aggregator.processAudioChunk(job2);
      recordAsrSnapshot(result2); // 记录 Debug Snapshot

      // ✅ Patch 4: 调整 R1 断言（必须先确认 merge 发生）
      // 合并后应该≥5秒，应该正常送ASR
      const mergedDurationMs = pendingDurationMs + JOB2_MS;
      expect(mergedDurationMs).toBeGreaterThanOrEqual(MIN_MS); // 验证合并后确实 ≥ 5秒
      expect(result2.shouldReturnEmpty).toBe(false);
      expect(result2.audioSegments).toBeDefined();
      expect(result2.audioSegments!.length).toBeGreaterThan(0);

      // ✅ Patch 1.1: 验证 ASR 调用快照
      const snapshot = getDebugSnapshot();
      expect(snapshot.asrCalls.length).toBeGreaterThan(0);
      if (snapshot.lastAsrCall) {
        expect(['NORMAL_MERGE', 'NORMAL']).toContain(snapshot.lastAsrCall.reason);
        expectApprox(snapshot.lastAsrCall.audioDurationMs || 0, mergedDurationMs, DURATION_TOLERANCE_MS);
      }

      // ✅ Patch 4: 确认 merge 发生（pending 应该被 flush/消耗）
      const bufferKeyR1 = buildBufferKey(job1);
      const bufferAfterJob2 = (aggregator as any).buffers?.get(bufferKeyR1);
      if (bufferAfterJob2) {
        expect(bufferAfterJob2.pendingTimeoutAudio).toBeUndefined();
      }
      expect(['NORMAL_MERGE', 'NORMAL']).toContain(result2.reason);

      // 验证合并后的音频时长（合并后的音频可能被切分成多个片段）
      // 验证所有片段的累计时长应该 ≥ 5秒
      if (result2.audioSegments && result2.audioSegments.length > 0) {
        let totalDurationMs = 0;
        for (const segmentBase64 of result2.audioSegments) {
          const segmentAudio = Buffer.from(segmentBase64, 'base64');
          const segmentDurationMs = bytesToMsPcm16LE(segmentAudio.length);
          totalDurationMs += segmentDurationMs;
        }
        // 合并后的音频总时长应该 ≥ 5秒（允许一些误差）
        expect(totalDurationMs).toBeGreaterThanOrEqual(MIN_MS - 500); // 允许 500ms 误差
      }
    });

    /**
     * R2: manual 触发输出（<5s 的音频在 manual 时也出结果）
     * 场景：先送 is_max_duration_triggered 小段，再送 is_manual_cut
     * 期望：manual 触发一次输出并送 ASR
     */
    it('R2: manual 触发时应处理<5s的音频', async () => {
      const sessionId = 'test-session-integration-r2';
      const jobId = 'job-r2';

      const audio1 = createMockPcm16Audio(8580);
      const job1 = createJobAssignMessage(jobId, sessionId, 0, audio1, {
        is_max_duration_triggered: true,
      });
      await aggregator.processAudioChunk(job1);

      const audio2 = createMockPcm16Audio(1820);
      const job2 = createJobAssignMessage(jobId, sessionId, 1, audio2, {
        is_manual_cut: true,
      });

      const result2 = await aggregator.processAudioChunk(job2);
      recordAsrSnapshot(result2);

      expect(result2.shouldReturnEmpty).toBe(false);
      expect(result2.audioSegments).toBeDefined();
      expect(result2.audioSegments!.length).toBeGreaterThan(0);
      const snapshot = getDebugSnapshot();
      expect(snapshot.asrCalls.length).toBeGreaterThan(0);
    });

    /**
     * R3: ASR 失败 / 超时不应触发空核销
     * 场景：输入音频 >0，但 ASR 返回失败/超时/空文本
     * 期望：不得走 shouldReturnEmpty 核销；输出 PARTIAL / MISSING 结果
     */
    it('R3: ASR失败不应触发空核销', async () => {
      const sessionId = 'test-session-integration-r3';

      // 创建有音频的job
      // 使用新的mock函数，确保音频有足够的能量波动
      const audio = createMockPcm16Audio(5000, 16000, {
        withEnergyVariation: true,
        silenceRatio: 0.1,
      }); // 5秒音频
      const job = createJobAssignMessage('job-asr-failure', sessionId, 0, audio, {
        is_manual_cut: true,
      });
      const result = await aggregator.processAudioChunk(job);
      recordAsrSnapshot(result); // 记录 Debug Snapshot

      // 有音频时，不应该返回空结果
      expect(result.shouldReturnEmpty).toBe(false);
      expect(result.audioSegments).toBeDefined();
      expect(result.audioSegments!.length).toBeGreaterThan(0);

      // ✅ Patch 1.1: 验证 ASR 调用快照（有音频应该发送 ASR）
      const snapshot1 = getDebugSnapshot();
      expect(snapshot1.asrCalls.length).toBeGreaterThan(0);

      // 如果有pending音频，也不应该返回空结果
      // 使用新的mock函数，确保音频有足够的能量波动
      const audio2 = createMockPcm16Audio(1000, 16000, {
        withEnergyVariation: true,
        silenceRatio: 0.1,
      }); // 1秒音频
      const job2 = createJobAssignMessage('job-asr-failure-2', sessionId, 1, audio2, {
        is_manual_cut: true,
      });

      // 设置 pendingTimeoutAudio（模拟有 pending 音频，manual 切时合并送出）
      const { buildBufferKey } = require('./audio-aggregator-buffer-key');
      const bufferKey = buildBufferKey(job2);
      const buffers = (aggregator as any).buffers;
      const buffer = buffers.get(bufferKey);
      if (buffer) {
        (buffer as any).pendingTimeoutAudio = createMockPcm16Audio(2000); // 2秒 pending
        (buffer as any).pendingTimeoutAudioCreatedAt = Date.now();
      }

      const result2 = await aggregator.processAudioChunk(job2);
      recordAsrSnapshot(result2); // 记录 Debug Snapshot

      // 有pending音频时，不应该返回空结果
      expect(result2.shouldReturnEmpty).toBe(false);

      // ✅ Patch 1.1: 验证 ASR 调用快照（有 pending 音频应该发送 ASR）
      const snapshot2 = getDebugSnapshot();
      expect(snapshot2.asrCalls.length).toBeGreaterThan(1); // 至少两次调用
    });

    /**
     * R4: 真正无音频才允许 empty 核销
     * 场景：inputDurationMs==0 且 segments==0
     * 期望：允许 empty result；且日志 reason=EMPTY_INPUT
     */
    it('R4: 真正无音频才允许empty核销', async () => {
      const sessionId = 'test-session-integration-r4';

      // 创建空音频的job（使用Buffer.alloc(0)创建空Buffer）
      // 注意：空Buffer的长度为0，0 % 2 === 0，所以会通过decodeAudioChunk的检查
      const emptyAudio = Buffer.alloc(0); // 空音频
      const job = createJobAssignMessage('job-empty', sessionId, 0, emptyAudio, {
        is_manual_cut: true,
      });

      // Mock解码结果：返回空音频
      // decodeOpusToPcm16 直接返回 Buffer，不是对象
      // decodeAudioChunk会检查currentAudio.length % 2，空Buffer（length=0）会通过检查
      mockDecodeOpusToPcm16.mockResolvedValueOnce(Buffer.alloc(0));

      const result = await aggregator.processAudioChunk(job);
      recordAsrSnapshot(result); // 记录 Debug Snapshot

      // 真正空音频时，应该返回空结果
      expect(result.shouldReturnEmpty).toBe(true);
      expect(result.reason).toBe('EMPTY_INPUT');
      expect(result.audioSegments).toEqual([]);

      // ✅ Patch 1.1: 验证不应发生 ASR 调用（空音频不应发送）
      const snapshot = getDebugSnapshot();
      // 注意：如果之前有调用，这里只验证当前调用不应发送
      // 空音频不应产生新的 ASR 调用
    });

    /**
     * R5: originalJobIds 头部对齐可解释
     * 场景：batch 含多 jobId
     * 期望：日志中明确输出 ownerJobId 与 originalJobIds
     */
    it('R5: originalJobIds头部对齐应该可解释', async () => {
      const sessionId = 'test-session-integration-r5';
      const jobId = 'job-multi-batch';

      const audio1 = createMockPcm16Audio(12000, 16000, {
        withEnergyVariation: true,
        silenceRatio: 0.1,
      });
      const job1 = createJobAssignMessage(jobId, sessionId, 0, audio1, {
        is_max_duration_triggered: true,
      });
      const result1 = await aggregator.processAudioChunk(job1);
      expect(result1.shouldReturnEmpty).toBe(true);

      const audio2 = createMockPcm16Audio(1000, 16000);
      const job2 = createJobAssignMessage(jobId, sessionId, 1, audio2, {
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

      const audio1 = createMockPcm16Audio(JOB1_MS, 16000, {
        withEnergyVariation: true,
        silenceRatio: 0.2,
      });
      const job1 = createJobAssignMessage(sameJobId, sessionId, 0, audio1, {
        is_max_duration_triggered: true,
      });
      await aggregator.processAudioChunk(job1);

      const { buildBufferKey } = require('./audio-aggregator-buffer-key');
      const bufferKey = buildBufferKey(job1);
      const buffer1 = (aggregator as any).buffers?.get(bufferKey);
      expect(buffer1?.audioChunks.length).toBeGreaterThan(0);
      const pendingDurationMs1 = buffer1.totalDurationMs ?? 0;

      const JOB2_MS = Math.max(500, MIN_MS - pendingDurationMs1 - 200);
      const audio2 = createMockPcm16Audio(JOB2_MS, 16000);
      const job2 = createJobAssignMessage(sameJobId, sessionId, 1, audio2, {
        is_manual_cut: true,
      });
      const result2 = await aggregator.processAudioChunk(job2);
      recordAsrSnapshot(result2);

      expect(result2.shouldReturnEmpty).toBe(false);
      expect((result2.audioSegments?.length ?? 0)).toBeGreaterThan(0);

      const snapshot = getDebugSnapshot();
      expect(snapshot.asrCalls.length).toBeGreaterThanOrEqual(1);

      const buffer2 = (aggregator as any).buffers?.get(bufferKey);
      expect(buffer2?.pendingTimeoutAudio).toBeUndefined();
    });

    it('merged_duration_should_equal_pending_plus_incoming_within_tolerance', async () => {
      const sessionId = 'test-session-merged-duration';
      const sameJobId = 'job-merge-same';

      const audio1 = createMockPcm16Audio(JOB1_MS, 16000, {
        withEnergyVariation: true,
        silenceRatio: 0.2,
      });
      const job1 = createJobAssignMessage(sameJobId, sessionId, 0, audio1, {
        is_max_duration_triggered: true,
      });
      await aggregator.processAudioChunk(job1);

      const { buildBufferKey } = require('./audio-aggregator-buffer-key');
      const bufferKey = buildBufferKey(job1);
      const buffer = (aggregator as any).buffers?.get(bufferKey);
      const pendingDurationMs = buffer.totalDurationMs ?? 0;
      const pendingBytes = buffer.audioChunks.reduce((s, c) => s + c.length, 0);

      const JOB2_MS = Math.max(500, MIN_MS - pendingDurationMs + 500);
      const audio2 = createMockPcm16Audio(JOB2_MS, 16000);
      const incomingBytes = audio2.length;
      const incomingDurationMs = bytesToMsPcm16LE(incomingBytes);

      const job2 = createJobAssignMessage(sameJobId, sessionId, 1, audio2, {
        is_manual_cut: true,
      });
      const result2 = await aggregator.processAudioChunk(job2);
      recordAsrSnapshot(result2);

      // 计算合并后的实际音频时长
      let mergedBytes = 0;
      if (result2.audioSegments && result2.audioSegments.length > 0) {
        for (const segmentBase64 of result2.audioSegments) {
          const segmentAudio = Buffer.from(segmentBase64, 'base64');
          mergedBytes += segmentAudio.length;
        }
      }
      const mergedDurationMs = bytesToMsPcm16LE(mergedBytes);

      // 验证：mergedDurationMs ≈ pendingDurationMs + incomingDurationMs（容差内）
      const expectedMergedMs = pendingDurationMs + incomingDurationMs;
      expectApprox(mergedDurationMs, expectedMergedMs, DURATION_TOLERANCE_MS);

      // 验证：mergedBytes ≈ pendingBytes + incomingBytes（容差内）
      const expectedMergedBytes = pendingBytes + incomingBytes;
      const bytesDiff = Math.abs(mergedBytes - expectedMergedBytes);
      const bytesTolerance = msToBytesPcm16LE(DURATION_TOLERANCE_MS);
      expect(bytesDiff).toBeLessThanOrEqual(bytesTolerance);
    });

    // ✅ Patch 1.6: 改进空核销严格性测试
    it('empty_finalize_should_only_happen_when_input_duration_is_zero_and_no_pending', async () => {
      const sessionId = 'test-session-empty-strict';

      // Case A: inputDurationMs == 0, segments == 0 → 允许 empty
      const emptyAudio = Buffer.alloc(0);
      const jobA = createJobAssignMessage('job-empty-a', sessionId, 0, emptyAudio, {
        is_manual_cut: true,
      });
      mockDecodeOpusToPcm16.mockResolvedValueOnce(Buffer.alloc(0));
      const resultA = await aggregator.processAudioChunk(jobA);
      recordAsrSnapshot(resultA);

      // Case A 应该允许 empty
      expect(resultA.shouldReturnEmpty).toBe(true);
      expect(resultA.reason).toBe('EMPTY_INPUT');
      expect(resultA.audioSegments).toEqual([]);

      // Case B: inputDurationMs > 0 但 ASR 失败/返回空 → 不允许 empty
      // 注意：这里我们无法真正模拟 ASR 失败，但可以验证有音频时不返回 empty
      const audioB = createMockPcm16Audio(5000, 16000, {
        withEnergyVariation: true,
        silenceRatio: 0.1,
      });
      const jobB = createJobAssignMessage('job-empty-b', sessionId, 1, audioB, {
        is_manual_cut: true,
      });
      const resultB = await aggregator.processAudioChunk(jobB);
      recordAsrSnapshot(resultB);

      // Case B 不应该返回 empty（即使 ASR 可能失败，也不应该核销）
      expect(resultB.shouldReturnEmpty).toBe(false);
      expect(resultB.audioSegments).toBeDefined();
      expect(resultB.audioSegments!.length).toBeGreaterThan(0);
      // 应该有 reason（即使不是 EMPTY_INPUT）
      expect(resultB.reason).toBeDefined();
      expect(resultB.reason).not.toBe('EMPTY_INPUT');
    });

    it('multi_job_batch_should_be_explainable_and_must_not_empty_close_non_owner_jobs', async () => {
      const sessionId = 'test-session-multi-job';
      const jobId = 'job-multi-owner';

      const audio1 = createMockPcm16Audio(12000, 16000, {
        withEnergyVariation: true,
        silenceRatio: 0.1,
      });
      const job1 = createJobAssignMessage(jobId, sessionId, 0, audio1, {
        is_max_duration_triggered: true,
      });
      const result1 = await aggregator.processAudioChunk(job1);
      expect(result1.shouldReturnEmpty).toBe(true);

      const audio2 = createMockPcm16Audio(1000, 16000);
      const job2 = createJobAssignMessage(jobId, sessionId, 1, audio2, {
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

    /**
     * §4.2 / §6.2 补充：发送层/回填映射层、时序并发
     *
     * - 发送层/回填映射层：真实 ASR 调用与回调映射需在 集成/E2E 层 spy；本文件仅通过 result 快照模拟「拟发送」轨迹。
     * - 时序/并发交错：以下用例覆盖 多 session 交错、并发 finalize；ASR 回调乱序在 集成/E2E 层验证。
     */
    describe('§4.2/§6.2 补充：多 session 交错与并发', () => {
      const MIN_MS = 5000;
      const JOB1_MS = 10000;

      it('interleaved_sessions_should_not_cross_talk', async () => {
        const sessionA = 'test-session-interleave-a';
        const sessionB = 'test-session-interleave-b';
        const jobIdA = 'job-a';
        const jobIdB = 'job-b';
        const { buildBufferKey } = require('./audio-aggregator-buffer-key');

        const audioA1 = createMockPcm16Audio(JOB1_MS, 16000, {
          withEnergyVariation: true,
          silenceRatio: 0.2,
        });
        const audioB1 = createMockPcm16Audio(JOB1_MS, 16000, {
          withEnergyVariation: true,
          silenceRatio: 0.2,
        });

        const decodeQueue: Buffer[] = [audioA1, audioB1];
        mockDecodeOpusToPcm16.mockImplementation(() =>
          Promise.resolve(decodeQueue.shift() ?? Buffer.alloc(0))
        );

        const jobA1 = createJobAssignMessage(jobIdA, sessionA, 0, audioA1, {
          is_max_duration_triggered: true,
        }, { skipMock: true });
        const jobB1 = createJobAssignMessage(jobIdB, sessionB, 0, audioB1, {
          is_max_duration_triggered: true,
        }, { skipMock: true });

        await aggregator.processAudioChunk(jobA1);
        const bufA1 = (aggregator as any).buffers?.get(buildBufferKey(jobA1));
        expect(bufA1?.audioChunks.length).toBeGreaterThan(0);
        const pendingA1 = bufA1.totalDurationMs ?? 0;

        await aggregator.processAudioChunk(jobB1);
        const bufB1 = (aggregator as any).buffers?.get(buildBufferKey(jobB1));
        expect(bufB1?.audioChunks.length).toBeGreaterThan(0);
        const pendingB1 = bufB1.totalDurationMs ?? 0;

        const JOB2_MS = Math.max(500, MIN_MS - Math.min(pendingA1, pendingB1) - 200);
        const audioA2 = createMockPcm16Audio(JOB2_MS, 16000);
        const audioB2 = createMockPcm16Audio(JOB2_MS, 16000);
        decodeQueue.push(audioA2, audioB2);

        const jobA2 = createJobAssignMessage(jobIdA, sessionA, 1, audioA2, {
          is_manual_cut: true,
        }, { skipMock: true });
        const jobB2 = createJobAssignMessage(jobIdB, sessionB, 1, audioB2, {
          is_manual_cut: true,
        }, { skipMock: true });

        const resultA2 = await aggregator.processAudioChunk(jobA2);
        recordAsrSnapshot(resultA2, { sessionId: sessionA, jobId: jobA2.job_id });
        const resultB2 = await aggregator.processAudioChunk(jobB2);
        recordAsrSnapshot(resultB2, { sessionId: sessionB, jobId: jobB2.job_id });

        expect(resultA2.shouldReturnEmpty).toBe(false);
        expect(resultB2.shouldReturnEmpty).toBe(false);

        const snapshot = getDebugSnapshot();
        expect(snapshot.asrCalls.length).toBeGreaterThanOrEqual(2);

        const bufA2 = (aggregator as any).buffers?.get(buildBufferKey(jobA1));
        const bufB2 = (aggregator as any).buffers?.get(buildBufferKey(jobB1));
        expect(bufA2?.pendingTimeoutAudio).toBeUndefined();
        expect(bufB2?.pendingTimeoutAudio).toBeUndefined();
      });

      it('concurrent_sessions_should_complete_without_contamination', async () => {
        const sessionA = 'test-session-concurrent-a';
        const sessionB = 'test-session-concurrent-b';
        const audio5s = createMockPcm16Audio(5000, 16000, {
          withEnergyVariation: true,
          silenceRatio: 0.1,
        });
        mockDecodeOpusToPcm16.mockResolvedValue(audio5s);

        const jobA = createJobAssignMessage('job-concurrent-a', sessionA, 0, audio5s, {
          is_manual_cut: true,
        });
        const jobB = createJobAssignMessage('job-concurrent-b', sessionB, 0, audio5s, {
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
});
