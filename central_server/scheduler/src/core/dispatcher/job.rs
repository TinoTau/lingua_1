use crate::messages::{FeatureFlags, PipelineConfig};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub job_id: String,
    /// 幂等请求 ID（Phase 1：任务级绑定使用）
    #[serde(skip_serializing_if = "String::is_empty")]
    pub request_id: String,
    /// 是否已成功下发到节点（Phase 1：用于避免 request_id 重试导致重复派发）
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub dispatched_to_node: bool,
    /// 最近一次成功下发到节点的时间戳（ms），用于 job_timeout_seconds 的计时起点（从 dispatched 开始）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispatched_at_ms: Option<i64>,
    /// 超时后的自动重派次数（不包含首次派发）
    #[serde(skip_serializing_if = "is_zero_u32")]
    pub failover_attempts: u32,
    /// 下发 attempt 序号（从 1 开始）。用于同一节点重派时的结果去重/竞态保护。
    #[serde(skip_serializing_if = "is_zero_u32")]
    pub dispatch_attempt_id: u32,
    pub session_id: String, // 发送者的 session_id
    pub utterance_index: u64,
    pub src_lang: String,  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
    pub tgt_lang: String,
    pub dialect: Option<String>,
    pub features: Option<FeatureFlags>,
    pub pipeline: PipelineConfig,
    pub audio_data: Vec<u8>,
    pub audio_format: String,
    pub sample_rate: u32,
    pub assigned_node_id: Option<String>,
    pub status: JobStatus,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// 追踪 ID（用于全链路日志追踪）
    pub trace_id: String,
    /// 翻译模式："one_way" | "two_way_auto"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// 双向模式的语言 A（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_a: Option<String>,
    /// 双向模式的语言 B（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_b: Option<String>,
    /// 自动识别时限制的语言范围（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_langs: Option<Vec<String>>,
    /// 是否启用流式 ASR（部分结果输出）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_streaming_asr: Option<bool>,
    /// 部分结果更新间隔（毫秒），仅在 enable_streaming_asr 为 true 时有效
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_update_interval_ms: Option<u64>,
    /// 目标接收者 session_id 列表（会议室模式使用，用于多语言翻译）
    /// 如果为 None，表示单会话模式，翻译结果发送给发送者
    /// 如果为 Some，表示会议室模式，翻译结果发送给列表中的所有成员
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_session_ids: Option<Vec<String>>,
    /// Phase 3：租户 ID（用于两级调度 routing_key 与运维排障）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
    /// 第一个音频块的客户端发送时间戳（毫秒，UTC时区），用于计算网络传输耗时
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_chunk_client_timestamp_ms: Option<i64>,
    /// EDGE-4: Padding 配置（毫秒），用于在音频末尾添加静音
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padding_ms: Option<u64>,
    /// 是否由用户手动发送（is_final=true）
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_manual_cut: bool,
    /// 是否由3秒静音触发（pause触发）
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_pause_triggered: bool,
    /// 是否由10秒超时触发（timeout触发）
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_timeout_triggered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobStatus {
    Pending,
    Assigned,
    Processing,
    Completed,
    Failed,
}

pub(crate) fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

