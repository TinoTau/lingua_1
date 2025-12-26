// 任务路由相关的类型定义

import { ServiceType } from '@shared/protocols/messages';

/**
 * 服务端点信息
 */
export interface ServiceEndpoint {
  serviceId: string;
  serviceType: ServiceType;
  baseUrl: string; // 例如: http://127.0.0.1:5008
  port: number;
  status: 'running' | 'stopped' | 'error';
}

/**
 * Segment 信息（包含时间戳）
 */
export interface SegmentInfo {
  text: string;
  start?: number;  // 开始时间（秒）
  end?: number;    // 结束时间（秒）
  no_speech_prob?: number;  // 无语音概率（可选）
}

/**
 * ASR 任务请求
 */
export interface ASRTask {
  audio: string; // base64 encoded audio
  audio_format: string; // 'pcm16', 'wav', 'opus'
  sample_rate: number;
  src_lang: string; // 'zh', 'en', 'auto', etc.
  enable_streaming?: boolean;
  context_text?: string;
  job_id?: string; // 任务 ID（用于取消任务）
  padding_ms?: number; // EDGE-4: 尾部静音 padding（毫秒），None 表示不添加 padding
  rerun_count?: number; // P0.5-SH-4: 当前重跑次数（用于限频）
  max_rerun_count?: number; // P0.5-SH-4: 最大重跑次数（默认 2）
  rerun_timeout_ms?: number; // P0.5-SH-4: 单次重跑超时（毫秒，默认 5000）
}

/**
 * ASR 任务结果
 */
export interface ASRResult {
  text: string;
  confidence?: number;
  language?: string;
  language_probability?: number;  // 新增：检测到的语言的概率（0.0-1.0）
  language_probabilities?: Record<string, number>;  // 新增：所有语言的概率信息（字典：语言代码 -> 概率）
  segments?: SegmentInfo[];  // 新增：Segment 元数据（包含时间戳）
  is_final?: boolean;
  // CONF-3: 坏段检测结果（可选，用于日志和后续重跑逻辑）
  badSegmentDetection?: {
    isBad: boolean;
    reasonCodes: string[];
    qualityScore: number;
  };
}

/**
 * NMT 任务请求
 */
export interface NMTTask {
  text: string;
  src_lang: string;
  tgt_lang: string;
  context_text?: string;
  job_id?: string; // 任务 ID（用于取消任务）
}

/**
 * NMT 任务结果
 */
export interface NMTResult {
  text: string;
  confidence?: number;
}

/**
 * TTS 任务请求
 */
export interface TTSTask {
  text: string;
  lang: string;
  voice_id?: string;
  speaker_id?: string;
  sample_rate?: number;
  job_id?: string; // 任务 ID（用于取消任务）
}

/**
 * TTS 任务结果
 */
export interface TTSResult {
  audio: string; // base64 encoded audio
  audio_format: string;
  sample_rate: number;
}

/**
 * TONE 任务请求
 */
export interface TONETask {
  audio: string; // base64 encoded audio
  audio_format: string;
  sample_rate: number;
  action: 'embed' | 'clone';
  speaker_id?: string;
  job_id?: string; // 任务 ID（用于取消任务）
}

/**
 * TONE 任务结果
 */
export interface TONEResult {
  embedding?: string; // base64 encoded embedding
  speaker_id?: string;
  audio?: string; // base64 encoded cloned audio
}

/**
 * 服务选择策略
 */
export type ServiceSelectionStrategy = 'round_robin' | 'least_connections' | 'random' | 'first_available';

