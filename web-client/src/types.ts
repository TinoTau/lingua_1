// 状态机状态定义
export enum SessionState {
  INPUT_READY = 'input_ready',
  INPUT_RECORDING = 'input_recording',
  WAITING_RESULT = 'waiting_result',
  PLAYING_TTS = 'playing_tts',
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
  text: string;
}

export interface AsrFinalMessage {
  type: 'asr_final';
  text: string;
}

export interface TranslationMessage {
  type: 'translation';
  text: string;
}

export interface TtsAudioMessage {
  type: 'tts_audio';
  seq: number;
  payload: string; // base64 encoded PCM16
}

export type ServerMessage = 
  | AsrPartialMessage 
  | AsrFinalMessage 
  | TranslationMessage 
  | TtsAudioMessage;

