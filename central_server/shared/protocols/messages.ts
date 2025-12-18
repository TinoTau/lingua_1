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
  tenant_id?: string | null;
  mode?: 'one_way' | 'two_way_auto';
  lang_a?: string;
  lang_b?: string;
  auto_langs?: string[];
  enable_streaming_asr?: boolean;
  partial_update_interval_ms?: number;
  /** 追踪 ID（可选，客户端提供或由 Scheduler 生成） */
  trace_id?: string;
}

export interface SessionInitAckMessage {
  type: 'session_init_ack';
  session_id: string;
  assigned_node_id: string | null;
  message: string;
  /** 追踪 ID（Scheduler 生成并回传） */
  trace_id: string;
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
  mode?: 'one_way' | 'two_way_auto';
  lang_a?: string;
  lang_b?: string;
  auto_langs?: string[];
  enable_streaming_asr?: boolean;
  partial_update_interval_ms?: number;
  /** 追踪 ID（可选，客户端提供或从 Session 中获取） */
  trace_id?: string;
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
  /** 追踪 ID（必需，用于全链路追踪） */
  trace_id: string;
}

export interface AsrPartialMessage {
  type: 'asr_partial';
  node_id?: string; // 节点发送时需要包含 node_id（SessionMessage 中不需要）
  session_id: string;
  utterance_index: number;
  job_id: string;
  text: string;
  is_final: boolean;
  /** 追踪 ID（必需，用于全链路追踪） */
  trace_id: string;
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

/** 语言检测结果消息（可选，用于 UI 显示或调试） */
export interface LanguageDetectedMessage {
  type: 'language_detected';
  session_id: string;
  lang: string;
  confidence: number;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ===== UI 事件类型（用于日志与可观测性） =====

/** UI 事件类型 */
export type UiEventType =
  | "INPUT_STARTED"
  | "INPUT_ENDED"
  | "ASR_PARTIAL"
  | "ASR_FINAL"
  | "DISPATCHED"
  | "NODE_ACCEPTED"
  | "NMT_DONE"
  | "TTS_PLAY_STARTED"
  | "TTS_PLAY_ENDED"
  | "ERROR";

/** UI 事件状态 */
export type UiEventStatus = "ok" | "error";

/** 错误码类型 */
export type ErrorCode =
  | "INVALID_MESSAGE"
  | "INTERNAL_ERROR"
  | "INVALID_SESSION"
  | "SESSION_CLOSED"
  | "NODE_UNAVAILABLE"
  | "NODE_OVERLOADED"
  | "MODEL_NOT_AVAILABLE"
  | "MODEL_LOAD_FAILED"
  | "UNSUPPORTED_FEATURE"
  | "INVALID_PAIRING_CODE"
  | "NO_AVAILABLE_NODE"
  | "WS_DISCONNECTED"
  | "NMT_TIMEOUT"
  | "TTS_TIMEOUT"
  | "JOB_TIMEOUT"
  | "MODEL_VERIFY_FAILED"
  | "MODEL_CORRUPTED";

/** UI 事件消息（用于日志与可观测性） */
export interface UiEventMessage {
  type: 'ui_event';
  trace_id: string;
  session_id: string;
  job_id: string;
  utterance_index: number;
  event: UiEventType;
  elapsed_ms?: number;
  status: UiEventStatus;
  error_code?: ErrorCode;
  hint?: string;
}

// ===== 节点 ↔ 调度服务器 =====

export type ModelStatus = 'ready' | 'downloading' | 'not_installed' | 'error';

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
  /** 节点已安装的服务包列表（可选） */
  installed_services?: InstalledService[];
  features_supported: FeatureFlags;
  accept_public_jobs: boolean;
  /** 节点模型能力图（capability_state） */
  capability_state?: Record<string, ModelStatus>;
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
  /** 节点已安装的服务包列表（可选） */
  installed_services?: InstalledService[];
  /** 节点模型能力图（capability_state） */
  capability_state?: Record<string, ModelStatus>;
}

export interface JobAssignMessage {
  type: 'job_assign';
  job_id: string;
  /** 下发 attempt 序号（从 1 开始），用于重派时结果去重 */
  attempt_id: number;
  session_id: string;
  utterance_index: number;
  src_lang: string;  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
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
  /** 翻译模式："one_way" | "two_way_auto" */
  mode?: 'one_way' | 'two_way_auto';
  /** 双向模式的语言 A（当 mode == "two_way_auto" 时使用） */
  lang_a?: string;
  /** 双向模式的语言 B（当 mode == "two_way_auto" 时使用） */
  lang_b?: string;
  /** 自动识别时限制的语言范围（可选） */
  auto_langs?: string[];
  /** 是否启用流式 ASR（部分结果输出） */
  enable_streaming_asr?: boolean;
  /** 部分结果更新间隔（毫秒），仅在 enable_streaming_asr 为 true 时有效 */
  partial_update_interval_ms?: number;
  /** 追踪 ID（必需，用于全链路追踪） */
  trace_id: string;
}

export interface JobCancelMessage {
  type: 'job_cancel';
  job_id: string;
  /** 追踪 ID（可选，用于链路日志） */
  trace_id?: string;
  /** 取消原因（可选，用于日志/诊断） */
  reason?: string;
}

export interface JobResultMessage {
  type: 'job_result';
  job_id: string;
  /** 对应的下发 attempt 序号（从 1 开始） */
  attempt_id: number;
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
  /** 追踪 ID（必需，用于全链路追踪） */
  trace_id: string;
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
  | AsrPartialMessage
  | ServerHeartbeatMessage
  | SessionCloseAckMessage
  | LanguageDetectedMessage
  | ErrorMessage
  | UiEventMessage;

export type SessionSideOutgoingMessage =
  | SessionInitMessage
  | UtteranceMessage
  | ClientHeartbeatMessage
  | SessionCloseMessage;

export type NodeSideIncomingMessage =
  | NodeRegisterAckMessage
  | JobAssignMessage
  | JobCancelMessage
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
  | AsrPartialMessage
  | ClientHeartbeatMessage
  | ServerHeartbeatMessage
  | SessionCloseMessage
  | SessionCloseAckMessage
  | LanguageDetectedMessage
  | ErrorMessage
  | UiEventMessage
  | NodeRegisterMessage
  | NodeRegisterAckMessage
  | NodeHeartbeatMessage
  | JobAssignMessage
  | JobCancelMessage
  | JobResultMessage
  | NodeErrorMessage
  | NodeControlMessage;
