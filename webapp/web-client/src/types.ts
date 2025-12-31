// 状态机状态定义
export enum SessionState {
  INPUT_READY = 'input_ready',
  INPUT_RECORDING = 'input_recording',
  // WAITING_RESULT 已移除，实现持续输入
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
  // 静音过滤配置
  silenceFilter?: SilenceFilterConfig;
  // WebSocket 重连配置
  reconnectConfig?: ReconnectConfig;
  // 客户端版本
  clientVersion?: string;
  // 可观测性配置
  observabilityReportUrl?: string; // 指标上报 URL
  observabilityReportIntervalMs?: number; // 上报间隔（毫秒）
  // Phase 2: 音频编解码器配置
  audioCodecConfig?: import('./audio_codec').AudioCodecConfig;
  // TTS 自动播放配置
  autoPlay?: boolean; // 是否自动播放 TTS 音频（默认 false，手动播放模式）
}

// 静音过滤配置
export interface SilenceFilterConfig {
  enabled: boolean; // 是否启用静音过滤
  threshold: number; // RMS 阈值（0-1，默认 0.01）
  windowMs: number; // 窗口大小（毫秒，默认 100ms）
  // 平滑配置（避免频繁启停）
  attackFrames: number; // 连续 N 帧语音才开始发送（默认 3）
  releaseFrames: number; // 连续 M 帧静音才停止发送（默认 5）
  attackThreshold?: number; // 进入语音的阈值（可选，默认使用 threshold）
  releaseThreshold?: number; // 退出语音的阈值（可选，默认使用 threshold）
  // 语速自适应配置（未来功能：根据语速动态调整静音检测参数）
  speechRateAdaptive?: boolean; // 是否启用语速自适应（默认 false）
  speechRateMultiplier?: number; // 语速倍数（1.0 = 正常，>1.0 = 快，<1.0 = 慢），用于调整 releaseFrames
}

export const DEFAULT_SILENCE_FILTER_CONFIG: SilenceFilterConfig = {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.01, // 进入语音：降低阈值（从0.015降低到0.01，更容易触发，避免前几句话被过滤）
  releaseThreshold: 0.003, // 退出语音：进一步降低（从0.005降低到0.003，更宽松，避免说话过程中音量稍微降低就被误判为静音）
  windowMs: 100,
  attackFrames: 3, // 连续3帧语音才开始发送（避免误触发）
  releaseFrames: 20, // 连续20帧静音才停止发送（200ms，从300ms减少到200ms，避免前几句话被过早截断）
};

// WebSocket 重连配置
export interface ReconnectConfig {
  enabled: boolean; // 是否启用自动重连
  maxRetries: number; // 最大重试次数（-1 表示无限重试）
  retryDelayMs: number; // 重试延迟（毫秒）
  heartbeatIntervalMs: number; // 心跳间隔（毫秒）
  heartbeatTimeoutMs: number; // 心跳超时（毫秒）
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  enabled: true,
  maxRetries: -1, // 无限重试
  retryDelayMs: 1000,
  heartbeatIntervalMs: 30000, // 30秒
  heartbeatTimeoutMs: 60000, // 60秒
};

export const DEFAULT_CONFIG: Config = {
  silenceTimeoutMs: 3000, // 3秒（已修复：从5秒减少到3秒，与调度服务器 pause_ms 保持一致）
  tailBufferMs: 250,
  groupTimeoutSec: 30,
  schedulerUrl: 'ws://localhost:5010/ws/session',
  silenceFilter: DEFAULT_SILENCE_FILTER_CONFIG,
  reconnectConfig: DEFAULT_RECONNECT_CONFIG,
  clientVersion: 'web-client-v1.0',
  autoPlay: false, // 默认手动播放模式（用户需要手动点击播放按钮）
};

// WebSocket 消息类型
export interface AudioChunkMessage {
  type: 'audio_chunk';
  session_id: string; // 必需：会话 ID
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
  service_timings?: {
    asr_ms?: number;
    nmt_ms?: number;
    tts_ms?: number;
    total_ms?: number;
  };
  network_timings?: {
    web_to_scheduler_ms?: number;
    scheduler_to_node_ms?: number;
    node_to_scheduler_ms?: number;
    scheduler_to_web_ms?: number;
  };
  scheduler_sent_at_ms?: number; // 调度服务器发送结果到Web端的时间戳（毫秒，UTC时区）
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
  trace_id: string; // 追踪 ID（服务器生成并回传）
  // 协议协商结果
  negotiated_audio_format?: string;
  negotiated_sample_rate?: number;
  negotiated_channel_count?: number;
  protocol_version?: string;
  // Phase 2 协商结果
  use_binary_frame?: boolean; // 是否使用 Binary Frame
  negotiated_codec?: string; // 协商后的编解码器
}

// 背压消息（服务端发送）
export interface BackpressureMessage {
  type: 'backpressure';
  action: 'BUSY' | 'PAUSE' | 'SLOW_DOWN';
  resume_after_ms?: number; // 恢复时间（毫秒）
  message?: string; // 可选消息
}

// Session Init 消息（客户端发送，增强版）
export interface SessionInitMessage {
  type: 'session_init';
  client_version: string;
  platform: 'web';
  src_lang: string;
  tgt_lang: string;
  dialect: string | null;
  features: FeatureFlags;
  pairing_code: string | null;
  mode: 'one_way' | 'two_way_auto';
  // 双向模式额外字段
  lang_a?: string;
  lang_b?: string;
  auto_langs?: string[];
  // Phase 3 新增字段（与 Scheduler 兼容）
  trace_id?: string; // 追踪 ID（用于可观测性）
  tenant_id?: string | null; // 租户 ID（用于多租户支持）
  // 注意：以下字段不应在 SessionInit 中发送（Scheduler 不支持）
  // audio_format, sample_rate, channel_count 只在 Utterance 消息中使用
  // protocol_version, supports_binary_frame, preferred_codec Scheduler 不支持
}

// 客户端发送的消息类型
export interface TtsPlayEndedMessage {
  type: 'tts_play_ended';
  session_id: string;
  trace_id: string;
  group_id: string;
  ts_end_ms: number;
}

// 房间相关消息类型（客户端发送）
export interface RoomCreateMessage {
  type: 'room_create';
  client_ts: number;
  display_name?: string;
  preferred_lang?: string;
}

export interface RoomJoinMessage {
  type: 'room_join';
  room_code: string;
  display_name?: string;
  preferred_lang?: string;
}

export interface RoomLeaveMessage {
  type: 'room_leave';
  room_code: string;
}

export interface RoomRawVoicePreferenceMessage {
  type: 'room_raw_voice_preference';
  room_code: string;
  target_session_id: string; // 目标成员的 session_id
  receive_raw_voice: boolean; // 是否接收该成员的原声
}

// WebRTC 信令消息类型
export interface WebRTCOfferMessage {
  type: 'webrtc_offer';
  room_code: string;
  to: string; // 目标成员的 participant_id (session_id)
  sdp: RTCSessionDescriptionInit;
}

export interface WebRTCAnswerMessage {
  type: 'webrtc_answer';
  room_code: string;
  to: string; // 目标成员的 participant_id (session_id)
  sdp: RTCSessionDescriptionInit;
}

export interface WebRTCIceMessage {
  type: 'webrtc_ice';
  room_code: string;
  to: string; // 目标成员的 participant_id (session_id)
  candidate: RTCIceCandidateInit;
}

// 房间相关消息类型（服务器发送）
export interface RoomCreateAckMessage {
  type: 'room_create_ack';
  room_code: string;
  room_id?: string;
}

export interface RoomMember {
  participant_id: string;
  session_id?: string; // 等同于 participant_id
  display_name?: string;
  preferred_lang?: string;
  raw_voice_preferences?: Record<string, boolean>; // key: 其他成员的 session_id, value: 是否接收原声
  joined_at?: number;
}

export interface RoomMembersMessage {
  type: 'room_members';
  room_code: string;
  members: RoomMember[];
}

export interface RoomErrorMessage {
  type: 'room_error';
  code: 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'INVALID_ROOM_CODE' | 'ALREADY_IN_ROOM' | string;
  message?: string;
}

export interface RoomExpiredMessage {
  type: 'room_expired';
  room_code: string;
  message: string;
}

// MissingResult 消息（用于防止队列锁死）
export interface MissingResultMessage {
  type: 'missing_result';
  session_id: string;
  utterance_index: number;
  reason: string; // "gap_timeout" | "pending_overflow_evict"
  created_at_ms: number;
  trace_id?: string;
}

// 通用错误消息（来自调度服务器）
export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
  details?: any;
}

export type ServerMessage =
  | SessionInitAckMessage
  | AsrPartialMessage
  | TranslationMessage
  | TranslationResultMessage
  | TtsAudioMessage
  | RoomCreateAckMessage
  | RoomMembersMessage
  | RoomErrorMessage
  | RoomExpiredMessage
  | WebRTCOfferMessage
  | WebRTCAnswerMessage
  | WebRTCIceMessage
  | BackpressureMessage
  | MissingResultMessage
  | ErrorMessage;

