/**
 * 共享协议定义
 * 定义调度服务器、节点和客户端之间的消息格式
 */

// 会话消息类型
export interface SessionInitMessage {
  type: 'init_session';
  src_lang: string;
  tgt_lang: string;
  pairing_code?: string;
}

export interface SessionCreatedMessage {
  type: 'session_created';
  session_id: string;
}

export interface UtteranceMessage {
  type: 'utterance';
  session_id: string;
  utterance_index: number;
  manual_cut: boolean;
  src_lang: string;
  tgt_lang: string;
  audio: string; // base64 encoded
}

export interface TranslationResultMessage {
  type: 'translation_result';
  session_id: string;
  utterance_index: number;
  transcript: string;
  translation: string;
  audio: string; // base64 encoded TTS audio
}

// 节点消息类型
export interface NodeRegisterMessage {
  type: 'register';
  name: string;
  capabilities: {
    asr: boolean;
    nmt: boolean;
    tts: boolean;
  };
}

export interface NodeRegisteredMessage {
  type: 'registered';
  node_id: string;
}

export interface NodeHeartbeatMessage {
  type: 'heartbeat';
  node_id: string;
  cpu_usage: number;
  gpu_usage?: number;
  memory_usage: number;
  installed_models: string[];
  current_jobs: number;
}

export interface JobMessage {
  type: 'job';
  job_id: string;
  session_id: string;
  utterance_index: number;
  src_lang: string;
  tgt_lang: string;
  audio: string; // base64 encoded
}

export interface JobResultMessage {
  type: 'job_result';
  job_id: string;
  result: {
    transcript: string;
    translation: string;
    audio: string; // base64 encoded
  };
}

export interface JobErrorMessage {
  type: 'job_error';
  job_id: string;
  error: string;
}

// 配对消息类型
export interface RequestPairingCodeMessage {
  type: 'request_pairing_code';
}

export interface PairingCodeMessage {
  type: 'pairing_code';
  code: string;
}

// 联合类型
export type SessionMessage = 
  | SessionInitMessage
  | SessionCreatedMessage
  | UtteranceMessage
  | TranslationResultMessage;

export type NodeMessage =
  | NodeRegisterMessage
  | NodeRegisteredMessage
  | NodeHeartbeatMessage
  | JobMessage
  | JobResultMessage
  | JobErrorMessage
  | RequestPairingCodeMessage
  | PairingCodeMessage;

