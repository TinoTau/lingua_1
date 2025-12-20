// 移动端 ↔ 调度服务器消息

use serde::{Deserialize, Serialize};
use crate::managers::room_manager;
use super::common::{FeatureFlags, ExtraResult};
use super::error::ErrorCode;
use super::ui_event::{UiEventType, UiEventStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SessionMessage {
    #[serde(rename = "session_init")]
    SessionInit {
        client_version: String,
        platform: String, // "android" | "ios" | "web" | "api-gateway"
        src_lang: String,  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
        tgt_lang: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        dialect: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        features: Option<FeatureFlags>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pairing_code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tenant_id: Option<String>, // 租户 ID（用于多租户支持）
        /// 翻译模式："one_way" | "two_way_auto"
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        /// 双向模式的语言 A（当 mode == "two_way_auto" 时使用）
        #[serde(skip_serializing_if = "Option::is_none")]
        lang_a: Option<String>,
        /// 双向模式的语言 B（当 mode == "two_way_auto" 时使用）
        #[serde(skip_serializing_if = "Option::is_none")]
        lang_b: Option<String>,
        /// 自动识别时限制的语言范围（可选）
        #[serde(skip_serializing_if = "Option::is_none")]
        auto_langs: Option<Vec<String>>,
        /// 是否启用流式 ASR（部分结果输出）
        #[serde(skip_serializing_if = "Option::is_none")]
        enable_streaming_asr: Option<bool>,
        /// 部分结果更新间隔（毫秒），仅在 enable_streaming_asr 为 true 时有效
        #[serde(skip_serializing_if = "Option::is_none")]
        partial_update_interval_ms: Option<u64>,
        /// 追踪 ID（可选，客户端提供或由 Scheduler 生成）
        #[serde(skip_serializing_if = "Option::is_none")]
        trace_id: Option<String>,
    },
    #[serde(rename = "session_init_ack")]
    SessionInitAck {
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        assigned_node_id: Option<String>,
        message: String,
        /// 追踪 ID（Scheduler 生成并回传）
        trace_id: String,
    },
    #[serde(rename = "utterance")]
    Utterance {
        session_id: String,
        utterance_index: u64,
        manual_cut: bool,
        src_lang: String,
        tgt_lang: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        dialect: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        features: Option<FeatureFlags>,
        audio: String, // base64
        audio_format: String,
        sample_rate: u32,
        /// 翻译模式："one_way" | "two_way_auto"
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        /// 双向模式的语言 A（当 mode == "two_way_auto" 时使用）
        #[serde(skip_serializing_if = "Option::is_none")]
        lang_a: Option<String>,
        /// 双向模式的语言 B（当 mode == "two_way_auto" 时使用）
        #[serde(skip_serializing_if = "Option::is_none")]
        lang_b: Option<String>,
        /// 自动识别时限制的语言范围（可选）
        #[serde(skip_serializing_if = "Option::is_none")]
        auto_langs: Option<Vec<String>>,
        /// 是否启用流式 ASR（部分结果输出）
        #[serde(skip_serializing_if = "Option::is_none")]
        enable_streaming_asr: Option<bool>,
        /// 部分结果更新间隔（毫秒），仅在 enable_streaming_asr 为 true 时有效
        #[serde(skip_serializing_if = "Option::is_none")]
        partial_update_interval_ms: Option<u64>,
        /// 追踪 ID（可选，客户端提供或从 Session 中获取）
        #[serde(skip_serializing_if = "Option::is_none")]
        trace_id: Option<String>,
    },
    #[serde(rename = "audio_chunk")]
    AudioChunk {
        session_id: String,
        seq: u64,
        is_final: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<String>, // base64 encoded PCM16
    },
    #[serde(rename = "translation_result")]
    TranslationResult {
        session_id: String,
        utterance_index: u64,
        job_id: String,
        text_asr: String,
        text_translated: String,
        tts_audio: String, // base64
        tts_format: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        extra: Option<ExtraResult>,
        /// 追踪 ID（必需，用于全链路追踪）
        trace_id: String,
        /// Utterance Group ID（可选，用于上下文拼接）
        #[serde(skip_serializing_if = "Option::is_none")]
        group_id: Option<String>,
        /// Group Part Index（可选，用于标识 Group 内的 part）
        #[serde(skip_serializing_if = "Option::is_none")]
        part_index: Option<u64>,
        /// 各服务耗时信息（从节点返回的 extra.service_timings 中提取）
        #[serde(skip_serializing_if = "Option::is_none")]
        service_timings: Option<crate::messages::common::ServiceTimings>,
    },
    #[serde(rename = "asr_partial")]
    AsrPartial {
        session_id: String,
        utterance_index: u64,
        job_id: String,
        text: String,
        is_final: bool,
        /// 追踪 ID（必需，用于全链路追踪）
        trace_id: String,
    },
    #[serde(rename = "client_heartbeat")]
    ClientHeartbeat {
        session_id: String,
        timestamp: i64,
    },
    #[serde(rename = "server_heartbeat")]
    ServerHeartbeat {
        session_id: String,
        timestamp: i64,
    },
    #[serde(rename = "session_close")]
    SessionClose {
        session_id: String,
        reason: String,
    },
    #[serde(rename = "session_close_ack")]
    SessionCloseAck {
        session_id: String,
    },
    #[serde(rename = "tts_play_ended")]
    TtsPlayEnded {
        session_id: String,
        trace_id: String,
        group_id: String,
        ts_end_ms: u64,
    },
    #[serde(rename = "error")]
    Error {
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<serde_json::Value>,
    },
    /// UI 事件消息（用于日志与可观测性）
    #[serde(rename = "ui_event")]
    UiEvent {
        trace_id: String,
        session_id: String,
        job_id: String,
        utterance_index: u64,
        event: UiEventType,
        #[serde(skip_serializing_if = "Option::is_none")]
        elapsed_ms: Option<u64>,
        status: UiEventStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        error_code: Option<ErrorCode>,
        #[serde(skip_serializing_if = "Option::is_none")]
        hint: Option<String>,
    },
    // ===== 房间相关消息 =====
    #[serde(rename = "room_create")]
    RoomCreate {
        client_ts: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        display_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        preferred_lang: Option<String>,
    },
    #[serde(rename = "room_create_ack")]
    RoomCreateAck {
        room_code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        room_id: Option<String>,
    },
    #[serde(rename = "room_join")]
    RoomJoin {
        room_code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        display_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        preferred_lang: Option<String>,
    },
    #[serde(rename = "room_members")]
    RoomMembers {
        room_code: String,
        members: Vec<room_manager::Participant>,
    },
    #[serde(rename = "room_leave")]
    RoomLeave {
        room_code: String,
    },
    #[serde(rename = "room_error")]
    RoomError {
        code: String, // "ROOM_NOT_FOUND" | "ROOM_FULL" | "INVALID_ROOM_CODE" | "ALREADY_IN_ROOM"
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    #[serde(rename = "room_expired")]
    RoomExpired {
        room_code: String,
        message: String,
    },
    #[serde(rename = "room_raw_voice_preference")]
    RoomRawVoicePreference {
        room_code: String,
        target_session_id: String, // 目标成员的 session_id
        receive_raw_voice: bool, // 是否接收该成员的原声
    },
    // ===== WebRTC 信令消息 =====
    #[serde(rename = "webrtc_offer")]
    WebRTCOffer {
        room_code: String,
        to: String, // 目标成员的 participant_id (session_id)
        sdp: serde_json::Value, // RTCSessionDescriptionInit
    },
    #[serde(rename = "webrtc_answer")]
    WebRTCAnswer {
        room_code: String,
        to: String, // 目标成员的 participant_id (session_id)
        sdp: serde_json::Value, // RTCSessionDescriptionInit
    },
    #[serde(rename = "webrtc_ice")]
    WebRTCIce {
        room_code: String,
        to: String, // 目标成员的 participant_id (session_id)
        candidate: serde_json::Value, // RTCIceCandidateInit
    },
}

