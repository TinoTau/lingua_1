// 状态机状态定义
export enum SessionState {
  INPUT_READY = 'input_ready',
  INPUT_RECORDING = 'input_recording',
  WAITING_RESULT = 'waiting_result',
  PLAYING_TTS = 'playing_tts',
}

// 功能标志（可选模块开关）
export interface FeatureFlags {
  emotion_detection?: boolean;
  voice_style_detection?: boolean;
  speech_rate_detection?: boolean;
  speech_rate_control?: boolean;
  speaker_identification?: boolean;
  persona_adaptation?: boolean;
}

// 配置参数
export interface Config {
  silenceTimeoutMs: number; // 1000ms
  tailBufferMs: number; // 250ms
  groupTimeoutSec: number; // 30s
  schedulerUrl: string;
}

export const DEFAULT_CONFIG: Config = {
  silenceTimeoutMs: 1000,
  tailBufferMs: 250,
  groupTimeoutSec: 30,
  schedulerUrl: 'ws://localhost:8080/ws/session',
};

// WebSocket 消息类型
export interface AudioChunkMessage {
  type: 'audio_chunk';
  seq: number;
  is_final: boolean;
  payload?: string; // base64 encoded PCM16
}

export interface AsrPartialMessage {
  type: 'asr_partial';
  session_id: string;
  utterance_index: number;
  job_id: string;
  text: string;
  is_final: boolean;
}

// AsrFinalMessage 已合并到 AsrPartialMessage（通过 is_final 字段区分）
export type AsrFinalMessage = AsrPartialMessage;

export interface TranslationMessage {
  type: 'translation';
  text: string;
}

// TranslationResult 消息（来自 Scheduler）
export interface TranslationResultMessage {
  type: 'translation_result';
  session_id: string;
  utterance_index: number;
  job_id: string;
  text_asr: string;
  text_translated: string;
  tts_audio: string; // base64
  tts_format: string;
  extra?: any;
  trace_id: string;
  group_id?: string; // Utterance Group ID（可选）
  part_index?: number; // Group Part Index（可选）
}

export interface TtsAudioMessage {
  type: 'tts_audio';
  seq: number;
  payload: string; // base64 encoded PCM16
}

// SessionInitAck 消息（用于确认会话创建）
export interface SessionInitAckMessage {
  type: 'session_init_ack';
  session_id: string;
  assigned_node_id: string | null;
  message: string;
}

// 客户端发送的消息类型
export interface TtsPlayEndedMessage {
  type: 'tts_play_ended';
  session_id: string;
  trace_id: string;
  group_id: string;
  ts_end_ms: number;
}

export type ServerMessage = 
  | SessionInitAckMessage
  | AsrPartialMessage 
  | TranslationMessage
  | TranslationResultMessage
  | TtsAudioMessage;

