// 通用类型定义

use serde::{Deserialize, Serialize};

/// Gate-B: Rerun 指标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RerunMetrics {
    #[serde(rename = "totalReruns")]
    pub total_reruns: u64,
    #[serde(rename = "successfulReruns")]
    pub successful_reruns: u64,
    #[serde(rename = "failedReruns")]
    pub failed_reruns: u64,
    #[serde(rename = "timeoutReruns")]
    pub timeout_reruns: u64,
    #[serde(rename = "qualityImprovements")]
    pub quality_improvements: u64,
}

/// OBS-1: ASR 观测指标（按心跳周期统计，向后兼容，已废弃）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ASRMetrics {
    /// @deprecated 使用 ProcessingMetrics.asr_efficiency 代替
    #[serde(rename = "processingEfficiency")]
    pub processing_efficiency: Option<f64>,
}

/// OBS-1: 处理效率观测指标（按心跳周期统计，按服务ID分组）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessingMetrics {
    /// 每个服务ID的处理效率
    /// key: 服务ID（如 "faster-whisper-vad", "nmt-m2m100", "piper-tts", "your-tts" 等）
    /// value: 该服务在心跳周期内的平均处理效率
    /// 
    /// 处理效率计算方式：
    /// - ASR服务：处理效率 = 原音频时长(ms) / 处理时间(ms)
    /// - NMT服务：处理效率 = 文本长度(字符数) / 处理时间(ms) * 1000 (字符/秒)
    /// - TTS服务：处理效率 = 生成音频时长(ms) / 处理时间(ms)
    /// 
    /// 值越大表示处理越快
    /// 如果心跳周期内某个服务没有任务，则该服务ID不会出现在此对象中
    #[serde(rename = "serviceEfficiencies")]
    pub service_efficiencies: std::collections::HashMap<String, f64>,
}

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

/// 能力类型（按类型聚合能力）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Ord, PartialOrd)]
#[serde(rename_all = "lowercase")]
pub enum ServiceType {
    Asr,
    Nmt,
    Tts,
    Tone,
}

impl std::str::FromStr for ServiceType {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "asr" => Ok(ServiceType::Asr),
            "nmt" => Ok(ServiceType::Nmt),
            "tts" => Ok(ServiceType::Tts),
            "tone" => Ok(ServiceType::Tone),
            _ => Err(()),
        }
    }
}

/// 服务运行设备
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    Gpu,
    Cpu,
}

/// 服务运行状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Running,
    Stopped,
    Error,
}

/// 已安装的服务实现信息（实现粒度）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledService {
    pub service_id: String,
    pub r#type: ServiceType,
    pub device: DeviceType,
    pub status: ServiceStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mem_mb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warmup_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// 按 ServiceType 聚合的能力
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityByType {
    pub r#type: ServiceType,
    pub ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ready_impl_ids: Option<Vec<String>>,
}

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
    /// ASR 检测到的语言的概率（0.0-1.0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_probability: Option<f32>,
    /// ASR 所有语言的概率信息（字典：语言代码 -> 概率）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_probabilities: Option<std::collections::HashMap<String, f32>>,
}

/// OBS-2: Segments 元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentsMeta {
    pub count: u32,
    pub max_gap: f32,  // 最大间隔（秒）
    pub avg_duration: f32,  // 平均时长（秒）
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

