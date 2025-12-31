// 指标类型定义

use serde::Serialize;
use std::sync::atomic::AtomicU64;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct Metrics {
    pub stats_requests_total: AtomicU64,
    pub stats_stale_total: AtomicU64,

    pub web_tasks_finalized_total: AtomicU64,
    pub web_tasks_finalized_by_send_total: AtomicU64,
    pub web_tasks_finalized_by_pause_total: AtomicU64,

    // Session Actor 指标
    pub session_actor_backlog_size: AtomicU64, // 当前积压事件数（峰值）
    pub duplicate_finalize_suppressed_total: AtomicU64, // 被抑制的重复 finalize 次数
    pub duplicate_job_blocked_total: AtomicU64, // 被阻止的重复 job 创建次数
    pub result_gap_timeout_total: AtomicU64, // 结果队列超时次数
    // RF-6: 音频块丢失修复相关指标
    pub empty_finalize_total: AtomicU64, // 空缓冲区 finalize 尝试次数（应该为 0，表示修复生效）
    pub index_gap_total: AtomicU64, // utterance_index 不连续次数（应该为 0，表示修复生效）

    pub model_na_received_total: AtomicU64,
    pub model_na_rate_limited_total: AtomicU64,
    pub model_na_marked_total: AtomicU64,

    pub slow_lock_wait_total: AtomicU64,
    pub slow_path_total: AtomicU64,

    // —— slow lock wait breakdown ——
    pub slow_lock_node_registry_nodes_read_total: AtomicU64,
    pub slow_lock_node_registry_nodes_write_total: AtomicU64,
    pub slow_lock_node_registry_reserved_jobs_write_total: AtomicU64,
    pub slow_lock_node_registry_unavailable_services_write_total: AtomicU64,
    pub slow_lock_node_registry_exclude_reason_stats_read_total: AtomicU64,
    pub slow_lock_node_registry_exclude_reason_stats_write_total: AtomicU64,

    // —— slow path breakdown ——
    pub slow_path_node_registry_select_node_with_features_total: AtomicU64,
    pub slow_path_node_registry_select_node_with_models_total: AtomicU64,

    // Gate-B: Rerun 指标
    pub rerun_trigger_count: AtomicU64,
    pub rerun_success_count: AtomicU64,
    pub rerun_timeout_count: AtomicU64,
    pub rerun_quality_improvements: AtomicU64,
    pub context_reset_count: AtomicU64, // Gate-A: Context reset 指标

    // OBS-1: ASR 指标
    pub asr_total_count: AtomicU64, // ASR 总次数
    pub asr_bad_segment_count: AtomicU64, // 坏段检测次数
    pub asr_rerun_trigger_count: AtomicU64, // 重跑触发次数
}

impl Metrics {
    pub(crate) fn inc(x: &AtomicU64) {
        x.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

lazy_static::lazy_static! {
    pub static ref METRICS: Metrics = Metrics::default();

    // —— 高基数字段：使用 Mutex + 容量上限，避免指标无限增长 ——
    pub static ref MODEL_NA_BY_SERVICE: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    pub static ref MODEL_NA_BY_REASON: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    pub static ref MODEL_NA_RATE_LIMITED_BY_NODE: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    pub static ref MODEL_NA_MARKED_BY_NODE: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    pub static ref MODEL_NA_OTHER_SERVICE_TOTAL: AtomicU64 = AtomicU64::new(0);
    pub static ref MODEL_NA_OTHER_REASON_TOTAL: AtomicU64 = AtomicU64::new(0);
    pub static ref MODEL_NA_OTHER_RATE_LIMITED_NODE_TOTAL: AtomicU64 = AtomicU64::new(0);
    pub static ref MODEL_NA_OTHER_MARKED_NODE_TOTAL: AtomicU64 = AtomicU64::new(0);

    // OBS-1: ASR 延迟统计（使用滑动窗口，最多保留最近 1000 个值）
    pub static ref ASR_E2E_LATENCIES: Mutex<Vec<u64>> = Mutex::new(Vec::with_capacity(1000));
    // OBS-1: 语言置信度分布（按区间统计）
    pub static ref LANG_PROB_DISTRIBUTION: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
}

#[derive(Debug, Serialize)]
pub struct MetricsSnapshot {
    pub stats: StatsMetrics,
    pub service_catalog: ServiceCatalogMetrics,
    pub model_not_available: ModelNotAvailableMetrics,
    pub dispatch_exclude: DispatchExcludeMetrics,
    pub web_task_segmentation: WebTaskSegmentationMetrics,
    pub observability: ObservabilityMetrics,
    pub rerun: RerunMetrics, // Gate-B: Rerun 指标
    pub asr: AsrMetrics, // OBS-1: ASR 指标
}

#[derive(Debug, Serialize)]
pub struct StatsMetrics {
    pub requests_total: u64,
    pub stale_total: u64,
    pub snapshot_updated_at_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct ServiceCatalogMetrics {
    pub fetched_at_ms: i64,
    pub last_success_at_ms: i64,
    pub fail_count: u32,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ModelNotAvailableMetrics {
    pub received_total: u64,
    pub rate_limited_total: u64,
    pub marked_total: u64,

    pub by_service_top: Vec<KeyCount>,
    pub by_reason_top: Vec<KeyCount>,
    pub rate_limited_by_node_top: Vec<KeyCount>,
    pub marked_by_node_top: Vec<KeyCount>,
    pub other_service_total: u64,
    pub other_reason_total: u64,
    pub other_rate_limited_node_total: u64,
    pub other_marked_node_total: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct KeyCount {
    pub key: String,
    pub count: u64,
}

#[derive(Debug, Serialize)]
pub struct DispatchExcludeMetrics {
    /// 每个排除原因的累计次数（来自 NodeRegistry 聚合）
    pub by_reason: Vec<DispatchExcludeReasonCount>,
}

#[derive(Debug, Serialize)]
pub struct DispatchExcludeReasonCount {
    pub reason: String,
    pub total: usize,
    pub sample_node_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct WebTaskSegmentationMetrics {
    pub finalized_total: u64,
    pub finalized_by_send_total: u64,
    pub finalized_by_pause_total: u64,
    pub pause_ms: u64,
    // RF-6: 音频块丢失修复相关指标
    pub empty_finalize_total: u64, // 空缓冲区 finalize 尝试次数（应该为 0，表示修复生效）
    pub index_gap_total: u64, // utterance_index 不连续次数（应该为 0，表示修复生效）
}

#[derive(Debug, Serialize)]
pub struct ObservabilityMetrics {
    pub slow_lock_wait_total: u64,
    pub slow_path_total: u64,
    pub lock_wait_warn_ms: u64,
    pub path_warn_ms: u64,

    pub slow_lock_wait_by_lock: SlowLockWaitByLock,
    pub slow_path_by_path: SlowPathByPath,
}

/// OBS-1: ASR 指标
#[derive(Debug, Serialize)]
pub struct AsrMetrics {
    pub e2e_latency: AsrLatencyMetrics,
    pub lang_prob_distribution: Vec<KeyCount>,
    pub bad_segment_rate: f64,  // 坏段检测率
    pub rerun_trigger_rate: f64,  // 重跑触发率
}

#[derive(Debug, Serialize)]
pub struct AsrLatencyMetrics {
    pub p50_ms: u64,
    pub p95_ms: u64,
    pub p99_ms: u64,
    pub count: u64,
}

#[derive(Debug, Serialize)]
pub struct SlowLockWaitByLock {
    pub node_registry_nodes_read_total: u64,
    pub node_registry_nodes_write_total: u64,
    pub node_registry_reserved_jobs_write_total: u64,
    pub node_registry_unavailable_services_write_total: u64,
    pub node_registry_exclude_reason_stats_read_total: u64,
    pub node_registry_exclude_reason_stats_write_total: u64,
    pub other_total: u64,
}

#[derive(Debug, Serialize)]
pub struct SlowPathByPath {
    pub node_registry_select_node_with_features_total: u64,
    pub node_registry_select_node_with_models_total: u64,
    pub other_total: u64,
}

/// Gate-B: Rerun 指标
#[derive(Debug, Serialize)]
pub struct RerunMetrics {
    pub trigger_count: u64,
    pub success_count: u64,
    pub timeout_count: u64,
    pub quality_improvements: u64,
    pub context_reset_count: u64, // Gate-A: Context reset 指标
}

