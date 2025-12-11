// shared/protocols/messages.ts
// WebSocket 消息协议 TypeScript 接口定义（与 docs/PROTOCOLS.md 对应）

export type Platform = 'android' | 'ios' | 'web';
export type NodePlatform = 'windows' | 'linux' | 'macos';

export interface FeatureFlags {
  emotion_detection?: boolean;
  voice_style_detection?: boolean;
  speech_rate_detection?: boolean;
  speech_rate_control?: boolean;
  speaker_identification?: boolean;
  persona_adaptation?: boolean;
}

export interface ResourceUsage {
  cpu_percent: number;
  gpu_percent?: number;
  gpu_mem_percent?: number;
  mem_percent: number;
  running_jobs: number;
}

export interface InstalledModel {
  model_id: string;
  kind: 'asr' | 'nmt' | 'tts' | 'emotion' | 'other';
  src_lang: string | null;
  tgt_lang: string | null;
  dialect: string | null;
  version: string;
  enabled?: boolean;
}

// ===== 移动端 ↔ 调度服务器 =====

export interface SessionInitMessage {
  type: 'session_init';
  client_version: string;
  platform: Platform;
  src_lang: string;
  tgt_lang: string;
  dialect: string | null;
  features?: FeatureFlags;
  pairing_code?: string | null;
}

export interface SessionInitAckMessage {
  type: 'session_init_ack';
  session_id: string;
  assigned_node_id: string | null;
  message: string;
}

export interface UtteranceMessage {
  type: 'utterance';
  session_id: string;
  utterance_index: number;
  manual_cut: boolean;
  src_lang: string;
  tgt_lang: string;
  dialect: string | null;
  features?: FeatureFlags;
  audio: string; // base64
  audio_format: string; // e.g. 'pcm16', 'wav'
  sample_rate: number;
}

export interface TranslationResultMessage {
  type: 'translation_result';
  session_id: string;
  utterance_index: number;
  job_id: string;
  text_asr: string;
  text_translated: string;
  tts_audio: string; // base64
  tts_format: string;
  extra?: {
    emotion?: string | null;
    speech_rate?: number | null;
    voice_style?: string | null;
    [key: string]: unknown;
  };
}

export interface ClientHeartbeatMessage {
  type: 'client_heartbeat';
  session_id: string;
  timestamp: number;
}

export interface ServerHeartbeatMessage {
  type: 'server_heartbeat';
  session_id: string;
  timestamp: number;
}

export interface SessionCloseMessage {
  type: 'session_close';
  session_id: string;
  reason: string;
}

export interface SessionCloseAckMessage {
  type: 'session_close_ack';
  session_id: string;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ===== 节点 ↔ 调度服务器 =====

export interface NodeRegisterMessage {
  type: 'node_register';
  node_id?: string | null;
  version: string;
  platform: NodePlatform;
  hardware: {
    cpu_cores: number;
    memory_gb: number;
    gpus?: Array<{
      name: string;
      memory_gb: number;
    }>;
  };
  installed_models: InstalledModel[];
  features_supported: FeatureFlags;
  accept_public_jobs: boolean;
}

export interface NodeRegisterAckMessage {
  type: 'node_register_ack';
  node_id: string;
  message: string;
}

export interface NodeHeartbeatMessage {
  type: 'node_heartbeat';
  node_id: string;
  timestamp: number;
  resource_usage: ResourceUsage;
  installed_models?: InstalledModel[];
}

export interface JobAssignMessage {
  type: 'job_assign';
  job_id: string;
  session_id: string;
  utterance_index: number;
  src_lang: string;
  tgt_lang: string;
  dialect: string | null;
  features?: FeatureFlags;
  pipeline: {
    use_asr: boolean;
    use_nmt: boolean;
    use_tts: boolean;
  };
  audio: string; // base64
  audio_format: string;
  sample_rate: number;
}

export interface JobResultMessage {
  type: 'job_result';
  job_id: string;
  node_id: string;
  session_id: string;
  utterance_index: number;
  success: boolean;
  text_asr?: string;
  text_translated?: string;
  tts_audio?: string;
  tts_format?: string;
  extra?: {
    emotion?: string | null;
    speech_rate?: number | null;
    voice_style?: string | null;
    [key: string]: unknown;
  };
  processing_time_ms?: number;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface NodeErrorMessage {
  type: 'node_error';
  node_id: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface NodeControlMessage {
  type: 'node_control';
  command: 'shutdown' | 'reload_config' | string;
  reason?: string;
}

// ===== 消息联合类型 =====

export type SessionSideIncomingMessage =
  | SessionInitAckMessage
  | TranslationResultMessage
  | ServerHeartbeatMessage
  | SessionCloseAckMessage
  | ErrorMessage;

export type SessionSideOutgoingMessage =
  | SessionInitMessage
  | UtteranceMessage
  | ClientHeartbeatMessage
  | SessionCloseMessage;

export type NodeSideIncomingMessage =
  | NodeRegisterAckMessage
  | JobAssignMessage
  | NodeControlMessage
  | ErrorMessage;

export type NodeSideOutgoingMessage =
  | NodeRegisterMessage
  | NodeHeartbeatMessage
  | JobResultMessage
  | NodeErrorMessage;

export type AnyMessage =
  | SessionInitMessage
  | SessionInitAckMessage
  | UtteranceMessage
  | TranslationResultMessage
  | ClientHeartbeatMessage
  | ServerHeartbeatMessage
  | SessionCloseMessage
  | SessionCloseAckMessage
  | ErrorMessage
  | NodeRegisterMessage
  | NodeRegisterAckMessage
  | NodeHeartbeatMessage
  | JobAssignMessage
  | JobResultMessage
  | NodeErrorMessage
  | NodeControlMessage;
