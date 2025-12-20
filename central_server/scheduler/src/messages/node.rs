// 节点 ↔ 调度服务器消息

use serde::{Deserialize, Serialize};
use super::common::{FeatureFlags, PipelineConfig, InstalledModel, InstalledService, CapabilityState, ResourceUsage, ExtraResult, HardwareInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NodeMessage {
    #[serde(rename = "node_register")]
    NodeRegister {
        #[serde(skip_serializing_if = "Option::is_none")]
        node_id: Option<String>,
        version: String,
        /// 能力描述版本（可选，默认 "1.0"）
        #[serde(skip_serializing_if = "Option::is_none")]
        capability_schema_version: Option<String>,
        platform: String, // "windows" | "linux" | "macos"
        hardware: HardwareInfo,
        installed_models: Vec<InstalledModel>,
        /// 节点已安装的服务包列表（可选）
        #[serde(skip_serializing_if = "Option::is_none")]
        installed_services: Option<Vec<InstalledService>>,
        /// 可选功能/插件能力（保留现有 FeatureFlags）
        features_supported: FeatureFlags,
        /// 性能/调度相关高级能力（如 batched_inference、kv_cache）
        #[serde(skip_serializing_if = "Option::is_none")]
        advanced_features: Option<Vec<String>>,
        accept_public_jobs: bool,
        /// 节点模型能力图（capability_state）
        /// Phase 1：key=service_id，value=服务包状态
        #[serde(skip_serializing_if = "Option::is_none")]
        capability_state: Option<CapabilityState>,
    },
    #[serde(rename = "node_register_ack")]
    NodeRegisterAck {
        node_id: String,
        message: String,
        /// 节点状态（初始恒为 registering）
        status: String, // "registering" | "ready" | "degraded" | "draining" | "offline"
    },
    #[serde(rename = "error")]
    Error {
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<serde_json::Value>,
    },
    #[serde(rename = "node_heartbeat")]
    NodeHeartbeat {
        node_id: String,
        timestamp: i64,
        resource_usage: ResourceUsage,
        #[serde(skip_serializing_if = "Option::is_none")]
        installed_models: Option<Vec<InstalledModel>>,
        /// 节点已安装的服务包列表（可选）
        #[serde(skip_serializing_if = "Option::is_none")]
        installed_services: Option<Vec<InstalledService>>,
        /// 节点模型能力图（capability_state）
        /// Phase 1：key=service_id，value=服务包状态
        #[serde(skip_serializing_if = "Option::is_none")]
        capability_state: Option<CapabilityState>,
    },
    #[serde(rename = "job_assign")]
    JobAssign {
        job_id: String,
        /// 下发 attempt 序号（从 1 开始）
        attempt_id: u32,
        session_id: String,
        utterance_index: u64,
        src_lang: String,  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
        tgt_lang: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        dialect: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        features: Option<FeatureFlags>,
        pipeline: PipelineConfig,
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
        /// 追踪 ID（必需，用于全链路追踪）
        trace_id: String,
        /// Utterance Group ID（可选，用于上下文拼接）
        #[serde(skip_serializing_if = "Option::is_none")]
        group_id: Option<String>,
        /// Group Part Index（可选，用于标识 Group 内的 part）
        #[serde(skip_serializing_if = "Option::is_none")]
        part_index: Option<u64>,
        /// 上下文文本（可选，用于 NMT 上下文拼接）
        #[serde(skip_serializing_if = "Option::is_none")]
        context_text: Option<String>,
    },
    /// Scheduler -> Node：取消一个正在处理/排队的 job（best-effort）
    #[serde(rename = "job_cancel")]
    JobCancel {
        job_id: String,
        /// 追踪 ID（可选，用于链路日志）
        #[serde(skip_serializing_if = "Option::is_none")]
        trace_id: Option<String>,
        /// 取消原因（可选，用于日志/诊断）
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// Node -> Scheduler：确认已接收并开始执行 job（Phase 2：用于 Job FSM 的 RUNNING 语义）
    #[serde(rename = "job_ack")]
    JobAck {
        job_id: String,
        /// 对应的下发 attempt 序号（用于 Scheduler 去重/竞态保护）
        attempt_id: u32,
        node_id: String,
        session_id: String,
        /// 追踪 ID（必需，用于全链路追踪）
        trace_id: String,
    },
    /// Node -> Scheduler：确认 job 已真正开始执行（建议用于 Phase2 严格 RUNNING 语义）
    #[serde(rename = "job_started")]
    JobStarted {
        job_id: String,
        /// 对应的下发 attempt 序号（用于 Scheduler 去重/竞态保护）
        attempt_id: u32,
        node_id: String,
        session_id: String,
        /// 追踪 ID（必需，用于全链路追踪）
        trace_id: String,
    },
    #[serde(rename = "job_result")]
    JobResult {
        job_id: String,
        /// 对应的下发 attempt 序号（用于 Scheduler 去重/竞态保护）
        attempt_id: u32,
        node_id: String,
        session_id: String,
        utterance_index: u64,
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_asr: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_translated: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tts_audio: Option<String>, // base64
        #[serde(skip_serializing_if = "Option::is_none")]
        tts_format: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        extra: Option<ExtraResult>,
        #[serde(skip_serializing_if = "Option::is_none")]
        processing_time_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<JobError>,
        /// 追踪 ID（必需，用于全链路追踪）
        trace_id: String,
        /// Utterance Group ID（可选，用于上下文拼接）
        #[serde(skip_serializing_if = "Option::is_none")]
        group_id: Option<String>,
        /// Group Part Index（可选，用于标识 Group 内的 part）
        #[serde(skip_serializing_if = "Option::is_none")]
        part_index: Option<u64>,
        /// 节点端处理完成时间戳（毫秒，UTC时区）
        #[serde(skip_serializing_if = "Option::is_none")]
        node_completed_at_ms: Option<i64>,
    },
    #[serde(rename = "asr_partial")]
    AsrPartial {
        job_id: String,
        node_id: String,
        session_id: String,
        utterance_index: u64,
        text: String,
        is_final: bool,
        /// 追踪 ID（必需，用于全链路追踪）
        trace_id: String,
    },
    #[serde(rename = "node_error")]
    NodeError {
        node_id: String,
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<serde_json::Value>,
    },
    #[serde(rename = "node_control")]
    NodeControl {
        command: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

