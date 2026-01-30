/**
 * JobContext - 流水线上唯一上下文结构
 * 存放所有中间结果
 */

import { ASRResult } from '../../task-router/types';

export interface JobContext {
  // 音频相关
  audio?: Buffer;
  audioFormat?: 'pcm16' | 'opus';

  // ASR 相关
  asrText?: string;
  asrSegments?: any[];
  asrResult?: ASRResult;
  languageProbabilities?: Record<string, number>;
  qualityScore?: number;

  // 聚合相关
  segmentForJobResult?: string;  // 本 job 的本段；语义修复只读此字段，产出 repairedText → text_asr / NMT
  aggregationAction?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  aggregationChanged?: boolean;
  isLastInMergedGroup?: boolean;
  shouldSendToSemanticRepair?: boolean;  // 是否应该发送给语义修复
  aggregationMetrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
  };
  lastCommittedText?: string | null;  // 上一个已提交的文本（用于 Trim 操作，避免重复获取，null表示没有上一个已提交的文本）

  // 语义修复相关
  repairedText?: string;
  semanticDecision?: 'PASS' | 'REPAIR' | 'REJECT';
  semanticRepairApplied?: boolean;
  semanticRepairConfidence?: number;

  // 去重相关
  shouldSend?: boolean;
  dedupReason?: string;

  // 翻译相关
  translatedText?: string;
  /** 动态确定的目标语言（双向模式使用） */
  detectedTargetLang?: string;
  /** 动态检测到的源语言（双向模式使用） */
  detectedSourceLang?: string;

  // TTS 相关
  ttsAudio?: string; // base64
  ttsFormat?: string; // opus/wav

  // TONE 相关
  toneResult?: any;
  toneAudio?: string;
  toneFormat?: string;

  // 其他
  rerunCount?: number;
}

/**
 * 初始化 JobContext
 */
export function initJobContext(job: any): JobContext {
  return {
    // 从 job 中提取音频（如果需要）
    audio: job.audio ? Buffer.from(job.audio, 'base64') : undefined,
    audioFormat: job.audio_format as 'pcm16' | 'opus',
  };
}
