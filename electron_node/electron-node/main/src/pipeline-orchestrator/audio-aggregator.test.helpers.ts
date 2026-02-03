/**
 * AudioAggregator 测试共享：常量、工具函数、快照记录
 * 供 audio-aggregator.test.ts 与 audio-aggregator-finalize.test.ts 使用
 */

import { JobAssignMessage } from '@shared/protocols/messages';

export const SAMPLE_RATE = 16000;
export const BYTES_PER_SAMPLE = 2;
export const DURATION_TOLERANCE_MS = 80;

export function bytesToMsPcm16LE(bytes: number, sampleRate: number = SAMPLE_RATE): number {
  return (bytes / BYTES_PER_SAMPLE / sampleRate) * 1000;
}

export function msToBytesPcm16LE(ms: number, sampleRate: number = SAMPLE_RATE): number {
  return Math.floor((ms / 1000) * sampleRate * BYTES_PER_SAMPLE);
}

export function samplesToMs(sampleCount: number, sampleRate: number = SAMPLE_RATE): number {
  return (sampleCount / sampleRate) * 1000;
}

export function expectApprox(actual: number, expected: number, tolerance: number = DURATION_TOLERANCE_MS): void {
  const diff = Math.abs(actual - expected);
  expect(diff).toBeLessThanOrEqual(tolerance);
}

export interface AsrCallSnapshot {
  ownerJobId?: string;
  originalJobIds?: string[];
  audioDurationMs?: number;
  audioBytes?: number;
  reason?: string;
  timestamp: number;
  sessionId?: string;
  jobId?: string;
  action: 'SEND' | 'HOLD';
}

const asrCallSnapshots: AsrCallSnapshot[] = [];

export function recordAsrSnapshot(result: any, meta?: { sessionId: string; jobId: string }): void {
  const action = result.shouldReturnEmpty || !result.audioSegments?.length ? 'HOLD' : 'SEND';
  if (action !== 'SEND' || !result.audioSegments?.length) return;
  let totalBytes = 0;
  for (const segmentBase64 of result.audioSegments) {
    const segmentAudio = Buffer.from(segmentBase64, 'base64');
    totalBytes += segmentAudio.length;
  }
  asrCallSnapshots.push({
    action: 'SEND',
    ownerJobId: result.originalJobIds?.[0],
    originalJobIds: result.originalJobIds,
    audioDurationMs: bytesToMsPcm16LE(totalBytes),
    audioBytes: totalBytes,
    reason: result.reason,
    timestamp: Date.now(),
    ...(meta && { sessionId: meta.sessionId, jobId: meta.jobId }),
  });
}

export function getDebugSnapshot(): { asrCalls: AsrCallSnapshot[]; lastAsrCall: AsrCallSnapshot | undefined } {
  return {
    asrCalls: [...asrCallSnapshots],
    lastAsrCall: asrCallSnapshots[asrCallSnapshots.length - 1],
  };
}

export function clearDebugSnapshot(): void {
  asrCallSnapshots.length = 0;
}

let deterministicSeed = 12345;
export function deterministicRandom(): number {
  deterministicSeed = ((deterministicSeed * 1664525 + 1013904223) >>> 0);
  return (deterministicSeed / 2147483647) * 2 - 1;
}

export function makePcm16BySamples(sampleCount: number, amplitude: number = 15000): Buffer {
  const buffer = Buffer.allocUnsafe(sampleCount * BYTES_PER_SAMPLE);
  const twoPiFreq = 2 * Math.PI * 440 / SAMPLE_RATE;
  for (let i = 0; i < sampleCount; i++) {
    const value = Math.sin(i * twoPiFreq) * amplitude;
    const finalValue = Math.max(-32768, Math.min(32767, value));
    buffer.writeInt16LE(Math.floor(finalValue), i * 2);
  }
  return buffer;
}

export function makePausePatternAudio(options: {
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
    for (let i = 0; i < speakSamples; i++) {
      const value = Math.sin((sampleIndex + i) * twoPiFreq) * 15000;
      const finalValue = Math.max(-32768, Math.min(32767, value));
      buffer.writeInt16LE(Math.floor(finalValue), (sampleIndex + i) * 2);
    }
    sampleIndex += speakSamples;
    for (let i = 0; i < pauseSamples; i++) {
      buffer.writeInt16LE(0, (sampleIndex + i) * 2);
    }
    sampleIndex += pauseSamples;
  }
  return {
    audio: buffer,
    totalMs: samplesToMs(totalSamples),
    expectedSegmentsMin: repeats,
  };
}

export function createMockPcm16Audio(
  durationMs: number,
  sampleRate: number = 16000,
  options: { withEnergyVariation?: boolean; silenceRatio?: number; baseFreq?: number } = {}
): Buffer {
  const { withEnergyVariation = true, silenceRatio = 0.2, baseFreq = 440 } = options;
  const samples = Math.floor((durationMs / 1000) * sampleRate);
  if (samples === 0) return Buffer.alloc(0);
  const buffer = Buffer.allocUnsafe(samples * 2);
  const useBatchMode = samples > 10000;
  const twoPiFreq = 2 * Math.PI * baseFreq / sampleRate;

  if (useBatchMode) {
    const cycleSamples = Math.floor((2000 / 1000) * sampleRate);
    const soundSamples = Math.floor((1500 / 1000) * sampleRate);
    const silenceSamples = cycleSamples - soundSamples;
    for (let i = 0; i < samples; i++) {
      const cycleIndex = i % cycleSamples;
      if (cycleIndex < soundSamples) {
        const value = Math.sin(i * twoPiFreq) * 15000;
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.floor(value))), i * 2);
      } else {
        buffer.writeInt16LE(Math.floor(deterministicRandom() * 50), i * 2);
      }
    }
  } else {
    const segmentCount = Math.max(2, Math.floor(durationMs / 2000));
    const segmentSize = Math.floor(samples / segmentCount);
    const twoPi5 = 2 * Math.PI * 5 / sampleRate;
    const twoPi2 = 2 * Math.PI * 2 / sampleRate;
    let sampleIndex = 0;
    for (let seg = 0; seg < segmentCount && sampleIndex < samples; seg++) {
      const isSilence = seg % 2 === 1 && withEnergyVariation;
      const segmentEnd = Math.min(sampleIndex + segmentSize, samples);
      const segmentLength = segmentEnd - sampleIndex;
      for (let i = sampleIndex; i < segmentEnd; i++) {
        if (isSilence) {
          buffer.writeInt16LE(Math.floor(deterministicRandom() * 100), i * 2);
        } else {
          const positionInSegment = (i - sampleIndex) / segmentLength;
          const baseValue = Math.sin(i * twoPiFreq);
          const envelope = Math.sin(positionInSegment * Math.PI);
          const energyVariation = withEnergyVariation ? 0.7 + 0.3 * Math.sin(i * twoPi5) : 1.0;
          const amplitude = 12000 + 4000 * Math.sin(i * twoPi2);
          const value = baseValue * envelope * energyVariation * amplitude + deterministicRandom() * 200;
          buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.floor(value))), i * 2);
        }
      }
      sampleIndex = segmentEnd;
    }
    for (let i = sampleIndex; i < samples; i++) {
      buffer.writeInt16LE(Math.floor(deterministicRandom() * 100), i * 2);
    }
  }
  return buffer;
}

export function createJobAssignMessage(
  mockDecodeOpusToPcm16: { mockResolvedValue: (v: Buffer) => void },
  jobId: string,
  sessionId: string,
  utteranceIndex: number,
  audioBuffer: Buffer,
  flags: { is_manual_cut?: boolean; is_timeout_triggered?: boolean; is_max_duration_triggered?: boolean } = {},
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
    pipeline: { use_asr: true, use_nmt: true, use_tts: true },
    audio: audioBase64,
    audio_format: 'opus',
    sample_rate: 16000,
    trace_id: 'test-trace',
    ...flags,
  } as any;
}

export const JOB_IDS_TO_CLEAR = [
  'job-maxdur-1', 'job-manual-1', 'job-asr-failure', 'job-asr-failure-2',
  'job-empty', 'job-multi-batch', 'job-pending-1', 'job-pending-2',
  'job-merge-1', 'job-merge-2', 'job-empty-a', 'job-empty-b', 'job-multi-owner',
  'job-a1', 'job-b1', 'job-a2', 'job-b2', 'job-concurrent-a', 'job-concurrent-b',
  'job-r0', 'job-r1', 'job-r2', 'job-r3', 'job-r5', 'job-pending-same', 'job-merge-same',
];
