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
}

/**
 * ASR 任务结果
 */
export interface ASRResult {
  text: string;
  confidence?: number;
  language?: string;
  is_final?: boolean;
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

