/**
 * AudioAggregator 类型定义
 */

import { JobAssignMessage } from '@shared/protocols/messages';

/**
 * 原始Job信息（记录每个job在聚合音频中的字节偏移范围）
 */
export interface OriginalJobInfo {
  jobId: string;
  startOffset: number;  // 在聚合音频中的起始字节偏移
  endOffset: number;    // 在聚合音频中的结束字节偏移
  utteranceIndex: number;
  expectedDurationMs?: number;  // 预期时长（毫秒），用于容器分配算法判断容器是否装满
}

/**
 * Job容器（用户可见文本单位）
 * 用于容器分配算法，确保最终输出文本段数 ≤ Job数量
 */
export interface JobContainer {
  jobId: string;           // 原始 jobId: "job0" | "job1" | ...
  expectedDurationMs: number;  // 预估时长，用于判断容器是否"装满"
  batches: Buffer[];       // 分配给该容器的batch数组
  currentDurationMs: number;   // 容器内已累积的时长
  utteranceIndex: number;  // 原始job的utteranceIndex
}

/**
 * 音频缓冲区状态
 */
export interface AudioBuffer {
  audioChunks: Buffer[];
  totalDurationMs: number;
  startTimeMs: number;
  lastChunkTimeMs: number;
  isManualCut: boolean;
  isPauseTriggered: boolean;
  isTimeoutTriggered: boolean;
  sessionId: string;
  utteranceIndex: number;
  // 流式切分新增字段
  /** 超时finalize的音频缓存，等待下一个job合并 */
  pendingTimeoutAudio?: Buffer;
  /** pendingTimeoutAudio创建时间（用于TTL检查） */
  pendingTimeoutAudioCreatedAt?: number;
  /** 超时finalize的job信息（用于originalJobIds分配） */
  pendingTimeoutJobInfo?: OriginalJobInfo[];
  /** 小片段缓存（<5秒），等待合并成≥5秒批次 */
  pendingSmallSegments: Buffer[];
  /** 小片段对应的job信息（用于originalJobIds分配） */
  pendingSmallSegmentsJobInfo: OriginalJobInfo[];
  /** 原始job信息映射（记录每个job在聚合音频中的字节偏移范围） */
  originalJobInfo: OriginalJobInfo[];
  /** 上一个pause finalize的短音频缓存（<1秒），用于合并错误切分的音频 */
  pendingPauseAudio?: Buffer;
  /** pendingPauseAudio创建时间（用于TTL检查） */
  pendingPauseAudioCreatedAt?: number;
  /** 上一个pause finalize的job信息（用于originalJobIds分配） */
  pendingPauseJobInfo?: OriginalJobInfo[];
}

/**
 * AudioAggregator处理结果
 */
export interface AudioChunkResult {
  /** 切分后的音频段数组（每个段都是base64编码的PCM16字符串） */
  audioSegments: string[];
  /** 每个ASR批次对应的原始job_id（容器分配算法） */
  originalJobIds?: string[];
  /** 原始job信息映射（用于获取原始job的utteranceIndex） */
  originalJobInfo?: OriginalJobInfo[];
  /** 是否应该返回空（继续缓冲） */
  shouldReturnEmpty: boolean;
  /** 是否是超时截断，需要等待下一个job */
  isTimeoutPending?: boolean;
}
