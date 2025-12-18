use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub model_hub: ModelHubConfig,
    pub scheduler: SchedulerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub port: u16,
    pub host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelHubConfig {
    pub base_url: String,
    pub storage_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerConfig {
    pub max_concurrent_jobs_per_node: usize,
    /// Phase 1：任务超时（job_timeout_seconds）的语义与策略补充
    /// - job_timeout_seconds：从“成功下发到节点（dispatched）”开始计时的超时秒数
    /// - pending_timeout_seconds：从创建开始计时的 pending 超时秒数（无可用节点/无法派发）
    /// - failover_max_attempts：超时后自动重派的最大次数
    /// - send_cancel：超时/重派前是否给节点发送 job_cancel（best-effort）
    /// - scan_interval_ms：超时扫描间隔
    #[serde(default)]
    pub job_timeout: JobTimeoutPolicyConfig,
    pub job_timeout_seconds: u64,
    pub heartbeat_interval_seconds: u64,
    #[serde(default)]
    pub load_balancer: LoadBalancerConfig,
    #[serde(default)]
    pub node_health: NodeHealthConfig,
    /// Phase 1：MODEL_NOT_AVAILABLE 处理相关配置
    #[serde(default)]
    pub model_not_available: ModelNotAvailableConfig,
    /// Phase 1：任务级绑定（request_id/lease）与并发占用（reserved）相关配置
    #[serde(default)]
    pub task_binding: TaskBindingConfig,
    /// Web 端 AudioChunk 的任务边界定义
    #[serde(default)]
    pub web_task_segmentation: WebTaskSegmentationConfig,
    /// 观测/验收（方向A：采样日志）
    #[serde(default)]
    pub observability: ObservabilityConfig,
    /// Phase 1：核心服务包映射（用于 required_models/required_services 计算与选节点过滤）
    #[serde(default)]
    pub core_services: CoreServicesConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobTimeoutPolicyConfig {
    /// Pending（未成功派发）状态的超时秒数（从 job.created_at 计时）
    #[serde(default = "default_job_pending_timeout_seconds")]
    pub pending_timeout_seconds: u64,
    /// 超时后自动重派最大次数（不包含首次派发）
    #[serde(default = "default_job_failover_max_attempts")]
    pub failover_max_attempts: u32,
    /// 超时扫描间隔（毫秒）
    #[serde(default = "default_job_timeout_scan_interval_ms")]
    pub scan_interval_ms: u64,
    /// 是否给节点发送取消指令（best-effort）
    #[serde(default = "default_job_timeout_send_cancel")]
    pub send_cancel: bool,
}

fn default_job_pending_timeout_seconds() -> u64 {
    10
}

fn default_job_failover_max_attempts() -> u32 {
    3
}

fn default_job_timeout_scan_interval_ms() -> u64 {
    1000
}

fn default_job_timeout_send_cancel() -> bool {
    true
}

impl Default for JobTimeoutPolicyConfig {
    fn default() -> Self {
        Self {
            pending_timeout_seconds: default_job_pending_timeout_seconds(),
            failover_max_attempts: default_job_failover_max_attempts(),
            scan_interval_ms: default_job_timeout_scan_interval_ms(),
            send_cancel: default_job_timeout_send_cancel(),
        }
    }
}

/// 核心链路服务包 ID（与 ModelHub services_index.json 中的 service_id 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreServicesConfig {
    /// ASR 服务包（可为空；为空则不参与 required 列表）
    #[serde(default = "default_core_asr_service_id")]
    pub asr_service_id: String,
    /// NMT 服务包（可为空）
    #[serde(default = "default_core_nmt_service_id")]
    pub nmt_service_id: String,
    /// TTS 服务包（可为空）
    #[serde(default = "default_core_tts_service_id")]
    pub tts_service_id: String,
}

fn default_core_asr_service_id() -> String {
    "node-inference".to_string()
}

fn default_core_nmt_service_id() -> String {
    "nmt-m2m100".to_string()
}

fn default_core_tts_service_id() -> String {
    "piper-tts".to_string()
}

impl Default for CoreServicesConfig {
    fn default() -> Self {
        Self {
            asr_service_id: default_core_asr_service_id(),
            nmt_service_id: default_core_nmt_service_id(),
            tts_service_id: default_core_tts_service_id(),
        }
    }
}

/// 任务级绑定与并发占用配置（Phase 1）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskBindingConfig {
    /// request_id → (job_id,node_id) 绑定租约 TTL（秒）
    /// 用于：重复请求幂等；避免同一任务被重复创建/重复派发
    #[serde(default = "default_task_binding_lease_seconds")]
    pub lease_seconds: u64,
    /// 节点 reserved job 记录 TTL（秒），用于避免心跳延迟导致超卖
    /// 建议与 lease_seconds 同步或略大
    #[serde(default = "default_task_binding_reserved_ttl_seconds")]
    pub reserved_ttl_seconds: u64,
    /// 是否开启“打散”策略（任务级）：避免同一 session 连续任务落到同一节点（若存在其他候选则优先避开）
    #[serde(default)]
    pub spread_enabled: bool,
    /// 打散窗口（秒）：仅在窗口内避免使用“上一次已派发节点”
    #[serde(default = "default_task_binding_spread_window_seconds")]
    pub spread_window_seconds: u64,
}

fn default_task_binding_lease_seconds() -> u64 {
    90
}

fn default_task_binding_reserved_ttl_seconds() -> u64 {
    90
}

fn default_task_binding_spread_window_seconds() -> u64 {
    30
}

impl Default for TaskBindingConfig {
    fn default() -> Self {
        Self {
            lease_seconds: default_task_binding_lease_seconds(),
            reserved_ttl_seconds: default_task_binding_reserved_ttl_seconds(),
            spread_enabled: false,
            spread_window_seconds: default_task_binding_spread_window_seconds(),
        }
    }
}

/// Web 端音频分段（AudioChunk）任务边界配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebTaskSegmentationConfig {
    /// 超过该停顿（毫秒）视为一个任务结束（默认 1000ms）
    #[serde(default = "default_web_pause_ms")]
    pub pause_ms: u64,
}

fn default_web_pause_ms() -> u64 {
    1000
}

impl Default for WebTaskSegmentationConfig {
    fn default() -> Self {
        Self { pause_ms: default_web_pause_ms() }
    }
}

/// MODEL_NOT_AVAILABLE 处理配置（Phase 1）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelNotAvailableConfig {
    /// 对 (node_id, service_id) 标记“暂不可用”的 TTL（秒）
    #[serde(default = "default_model_na_unavailable_ttl_seconds")]
    pub unavailable_ttl_seconds: u64,
    /// 去抖窗口（秒）：同一 (service_id, version) 在窗口内只记录一次“昂贵操作”日志/指标
    #[serde(default = "default_model_na_debounce_window_seconds")]
    pub debounce_window_seconds: u64,
    /// 节点级限流窗口（秒）
    #[serde(default = "default_model_na_node_ratelimit_window_seconds")]
    pub node_ratelimit_window_seconds: u64,
    /// 节点级限流阈值：每窗口最多接受多少次 MODEL_NOT_AVAILABLE 事件（超出丢弃）
    #[serde(default = "default_model_na_node_ratelimit_max")]
    pub node_ratelimit_max: u32,
}

fn default_model_na_unavailable_ttl_seconds() -> u64 {
    60
}

fn default_model_na_debounce_window_seconds() -> u64 {
    5
}

fn default_model_na_node_ratelimit_window_seconds() -> u64 {
    10
}

fn default_model_na_node_ratelimit_max() -> u32 {
    30
}

impl Default for ModelNotAvailableConfig {
    fn default() -> Self {
        Self {
            unavailable_ttl_seconds: default_model_na_unavailable_ttl_seconds(),
            debounce_window_seconds: default_model_na_debounce_window_seconds(),
            node_ratelimit_window_seconds: default_model_na_node_ratelimit_window_seconds(),
            node_ratelimit_max: default_model_na_node_ratelimit_max(),
        }
    }
}

/// 节点健康检查配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeHealthConfig {
    /// 心跳间隔（秒）
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_seconds: u64,
    /// 心跳超时（秒），超过此时间未收到心跳则判为 offline
    #[serde(default = "default_heartbeat_timeout")]
    pub heartbeat_timeout_seconds: u64,
    /// registering → ready 需要连续正常心跳次数
    #[serde(default = "default_health_check_count")]
    pub health_check_count: usize,
    /// warmup 超时（秒），超过此时间仍未 ready 则转 degraded
    #[serde(default = "default_warmup_timeout")]
    pub warmup_timeout_seconds: u64,
    /// 失败率阈值：连续 N 次中失败 ≥ M 次，或连续失败 M 次
    #[serde(default = "default_failure_threshold")]
    pub failure_threshold: FailureThreshold,
    /// 状态转换定期扫描间隔（秒）
    #[serde(default = "default_status_scan_interval")]
    pub status_scan_interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailureThreshold {
    /// 检查窗口大小（例如：5 次）
    pub window_size: usize,
    /// 失败次数阈值（例如：3 次）
    pub failure_count: usize,
    /// 连续失败次数阈值（例如：3 次）
    pub consecutive_failure_count: usize,
}

fn default_heartbeat_interval() -> u64 {
    15
}

fn default_heartbeat_timeout() -> u64 {
    45
}

fn default_health_check_count() -> usize {
    3
}

fn default_warmup_timeout() -> u64 {
    60
}

fn default_failure_threshold() -> FailureThreshold {
    FailureThreshold {
        window_size: 5,
        failure_count: 3,
        consecutive_failure_count: 3,
    }
}

fn default_status_scan_interval() -> u64 {
    30
}

impl Default for NodeHealthConfig {
    fn default() -> Self {
        Self {
            heartbeat_interval_seconds: default_heartbeat_interval(),
            heartbeat_timeout_seconds: default_heartbeat_timeout(),
            health_check_count: default_health_check_count(),
            warmup_timeout_seconds: default_warmup_timeout(),
            failure_threshold: default_failure_threshold(),
            status_scan_interval_seconds: default_status_scan_interval(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancerConfig {
    #[serde(default = "default_load_balancer_strategy")]
    pub strategy: String,
    /// 资源使用率阈值（超过此值的节点将被跳过）
    #[serde(default = "default_resource_threshold")]
    pub resource_threshold: f32,
}

fn default_resource_threshold() -> f32 {
    25.0 // 默认 25%
}

fn default_load_balancer_strategy() -> String {
    "least_connections".to_string()
}

impl Default for LoadBalancerConfig {
    fn default() -> Self {
        Self {
            strategy: default_load_balancer_strategy(),
            resource_threshold: default_resource_threshold(),
        }
    }
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        let config_path = PathBuf::from("config.toml");
        
        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            let config: Config = toml::from_str(&content)?;
            Ok(config)
        } else {
            // 使用默认配置
            Ok(Config::default())
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                port: 5010,
                host: "0.0.0.0".to_string(),
            },
            model_hub: ModelHubConfig {
                base_url: "http://localhost:5000".to_string(),
                // 默认指向 repo 内 ModelHub 服务包索引目录（可在 config.toml 覆盖）
                // 期望存在 services_index.json（用于 Scheduler 单机冷启动/离线兜底）
                storage_path: PathBuf::from("../model-hub/models/services"),
            },
            scheduler: SchedulerConfig {
                max_concurrent_jobs_per_node: 4,
                job_timeout_seconds: 30,
                heartbeat_interval_seconds: 15,
                job_timeout: JobTimeoutPolicyConfig::default(),
                load_balancer: LoadBalancerConfig {
                    strategy: "least_connections".to_string(),
                    resource_threshold: default_resource_threshold(),
                },
                node_health: NodeHealthConfig::default(),
                model_not_available: ModelNotAvailableConfig::default(),
                task_binding: TaskBindingConfig::default(),
                web_task_segmentation: WebTaskSegmentationConfig::default(),
                observability: ObservabilityConfig::default(),
                core_services: CoreServicesConfig::default(),
            },
        }
    }
}

/// 方向A：采样日志阈值配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservabilityConfig {
    /// 获取锁等待时间超过该阈值就记录 warn（毫秒）
    #[serde(default = "default_obs_lock_wait_warn_ms")]
    pub lock_wait_warn_ms: u64,
    /// 关键路径耗时超过该阈值就记录 warn（毫秒）
    #[serde(default = "default_obs_path_warn_ms")]
    pub path_warn_ms: u64,
}

fn default_obs_lock_wait_warn_ms() -> u64 {
    10
}

fn default_obs_path_warn_ms() -> u64 {
    50
}

impl Default for ObservabilityConfig {
    fn default() -> Self {
        Self {
            lock_wait_warn_ms: default_obs_lock_wait_warn_ms(),
            path_warn_ms: default_obs_path_warn_ms(),
        }
    }
}

