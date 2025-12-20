// 通用类型定义

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureFlags {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emotion_detection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_style_detection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_rate_detection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_rate_control: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_identification: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persona_adaptation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineConfig {
    pub use_asr: bool,
    pub use_nmt: bool,
    pub use_tts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledModel {
    pub model_id: String,
    pub kind: String, // "asr" | "nmt" | "tts" | "vad" | "emotion" | "other"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src_lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tgt_lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dialect: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

/// 已安装的服务包信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledService {
    pub service_id: String,
    pub version: String,
    pub platform: String, // "windows-x64" | "linux-x64" | etc.
}

/// 模型状态（用于 capability_state）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelStatus {
    /// 模型已安装可用
    Ready,
    /// 正在下载
    Downloading,
    /// 未安装
    NotInstalled,
    /// 模型损坏 / 无法加载
    Error,
}

/// 节点服务能力图（capability_state）
/// 
/// **Phase 1 规范：key 必须是 service_id（服务包 ID）**，value 为该服务包当前状态
pub type CapabilityState = std::collections::HashMap<String, ModelStatus>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub cpu_cores: u32,
    pub memory_gb: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpus: Option<Vec<GpuInfo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub memory_gb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub cpu_percent: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu_percent: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu_mem_percent: Option<f32>,
    pub mem_percent: f32,
    pub running_jobs: usize,
}

/// 服务耗时信息（毫秒）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceTimings {
    /// ASR 服务耗时（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asr_ms: Option<u64>,
    /// NMT 服务耗时（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nmt_ms: Option<u64>,
    /// TTS 服务耗时（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tts_ms: Option<u64>,
    /// 总耗时（毫秒，包含所有服务及中间处理时间）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_ms: Option<u64>,
}

/// 网络传输耗时信息（毫秒）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkTimings {
    /// Web端到调度服务器的传输耗时（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_to_scheduler_ms: Option<u64>,
    /// 调度服务器到节点端的传输耗时（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduler_to_node_ms: Option<u64>,
    /// 节点端返回结果到调度服务器的传输耗时（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_to_scheduler_ms: Option<u64>,
    /// 调度服务器返回结果到Web端的传输耗时（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduler_to_web_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emotion: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_rate: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_style: Option<String>,
    /// 各服务耗时信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_timings: Option<ServiceTimings>,
}

/// 节点生命周期状态（Scheduler 权威）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    /// 已完成注册，但尚未参与调度（能力/模型仍可能在 warm-up）
    Registering,
    /// 已就绪，可被调度
    Ready,
    /// 能力下降（模型缺失、GPU 不可用、连续失败等）
    Degraded,
    /// 准备下线，不再接新任务，但允许完成在途任务
    Draining,
    /// 心跳丢失/主动下线/被移除
    Offline,
}

impl NodeStatus {
    /// 检查节点是否可以被调度
    #[allow(dead_code)]
    pub fn is_schedulable(&self) -> bool {
        matches!(self, NodeStatus::Ready)
    }
}

