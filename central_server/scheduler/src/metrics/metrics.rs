// 轻量指标采集（Phase 1）
// - 不引入 Prometheus 依赖
// - 以 JSON 方式暴露 /api/v1/metrics，便于运行期调参/验收

use crate::core::AppState;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
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
}

impl Metrics {
    fn inc(x: &AtomicU64) {
        x.fetch_add(1, Ordering::Relaxed);
    }
}

lazy_static::lazy_static! {
    pub static ref METRICS: Metrics = Metrics::default();

    // —— 高基数字段：使用 Mutex + 容量上限，避免指标无限增长 ——
    static ref MODEL_NA_BY_SERVICE: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    static ref MODEL_NA_BY_REASON: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    static ref MODEL_NA_RATE_LIMITED_BY_NODE: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    static ref MODEL_NA_MARKED_BY_NODE: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    static ref MODEL_NA_OTHER_SERVICE_TOTAL: AtomicU64 = AtomicU64::new(0);
    static ref MODEL_NA_OTHER_REASON_TOTAL: AtomicU64 = AtomicU64::new(0);
    static ref MODEL_NA_OTHER_RATE_LIMITED_NODE_TOTAL: AtomicU64 = AtomicU64::new(0);
    static ref MODEL_NA_OTHER_MARKED_NODE_TOTAL: AtomicU64 = AtomicU64::new(0);
}

#[derive(Debug, Serialize)]
pub struct MetricsSnapshot {
    pub stats: StatsMetrics,
    pub service_catalog: ServiceCatalogMetrics,
    pub model_not_available: ModelNotAvailableMetrics,
    pub dispatch_exclude: DispatchExcludeMetrics,
    pub web_task_segmentation: WebTaskSegmentationMetrics,
    pub observability: ObservabilityMetrics,
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

pub async fn collect(state: &AppState) -> MetricsSnapshot {
    let service_meta = state.service_catalog.get_meta().await;
    let (lock_wait_warn_ms, path_warn_ms) = crate::metrics::observability::thresholds();
    let exclude_stats = state.node_registry.get_exclude_reason_stats().await;

    let by_service_top = top_k_from_map(&MODEL_NA_BY_SERVICE, 20);
    let by_reason_top = top_k_from_map(&MODEL_NA_BY_REASON, 20);
    let rate_limited_by_node_top = top_k_from_map(&MODEL_NA_RATE_LIMITED_BY_NODE, 20);
    let marked_by_node_top = top_k_from_map(&MODEL_NA_MARKED_BY_NODE, 20);

    MetricsSnapshot {
        stats: StatsMetrics {
            requests_total: METRICS.stats_requests_total.load(Ordering::Relaxed),
            stale_total: METRICS.stats_stale_total.load(Ordering::Relaxed),
            snapshot_updated_at_ms: state.dashboard_snapshot.last_updated_at_ms().await,
        },
        service_catalog: ServiceCatalogMetrics {
            fetched_at_ms: service_meta.fetched_at_ms,
            last_success_at_ms: service_meta.last_success_at_ms,
            fail_count: service_meta.fail_count,
            last_error: service_meta.last_error,
        },
        model_not_available: ModelNotAvailableMetrics {
            received_total: METRICS.model_na_received_total.load(Ordering::Relaxed),
            rate_limited_total: METRICS.model_na_rate_limited_total.load(Ordering::Relaxed),
            marked_total: METRICS.model_na_marked_total.load(Ordering::Relaxed),
            by_service_top,
            by_reason_top,
            rate_limited_by_node_top,
            marked_by_node_top,
            other_service_total: MODEL_NA_OTHER_SERVICE_TOTAL.load(Ordering::Relaxed),
            other_reason_total: MODEL_NA_OTHER_REASON_TOTAL.load(Ordering::Relaxed),
            other_rate_limited_node_total: MODEL_NA_OTHER_RATE_LIMITED_NODE_TOTAL.load(Ordering::Relaxed),
            other_marked_node_total: MODEL_NA_OTHER_MARKED_NODE_TOTAL.load(Ordering::Relaxed),
        },
        dispatch_exclude: DispatchExcludeMetrics {
            by_reason: exclude_stats
                .into_iter()
                .map(|(reason, (total, sample))| DispatchExcludeReasonCount {
                    reason: format_dispatch_exclude_reason(&reason),
                    total,
                    sample_node_ids: sample,
                })
                .collect(),
        },
        web_task_segmentation: WebTaskSegmentationMetrics {
            finalized_total: METRICS.web_tasks_finalized_total.load(Ordering::Relaxed),
            finalized_by_send_total: METRICS.web_tasks_finalized_by_send_total.load(Ordering::Relaxed),
            finalized_by_pause_total: METRICS.web_tasks_finalized_by_pause_total.load(Ordering::Relaxed),
            pause_ms: state.web_task_segmentation.pause_ms,
        },
        observability: ObservabilityMetrics {
            slow_lock_wait_total: METRICS.slow_lock_wait_total.load(Ordering::Relaxed),
            slow_path_total: METRICS.slow_path_total.load(Ordering::Relaxed),
            lock_wait_warn_ms,
            path_warn_ms,
            slow_lock_wait_by_lock: SlowLockWaitByLock {
                node_registry_nodes_read_total: METRICS
                    .slow_lock_node_registry_nodes_read_total
                    .load(Ordering::Relaxed),
                node_registry_nodes_write_total: METRICS
                    .slow_lock_node_registry_nodes_write_total
                    .load(Ordering::Relaxed),
                node_registry_reserved_jobs_write_total: METRICS
                    .slow_lock_node_registry_reserved_jobs_write_total
                    .load(Ordering::Relaxed),
                node_registry_unavailable_services_write_total: METRICS
                    .slow_lock_node_registry_unavailable_services_write_total
                    .load(Ordering::Relaxed),
                node_registry_exclude_reason_stats_read_total: METRICS
                    .slow_lock_node_registry_exclude_reason_stats_read_total
                    .load(Ordering::Relaxed),
                node_registry_exclude_reason_stats_write_total: METRICS
                    .slow_lock_node_registry_exclude_reason_stats_write_total
                    .load(Ordering::Relaxed),
                other_total: METRICS.slow_lock_wait_total.load(Ordering::Relaxed)
                    .saturating_sub(
                        METRICS
                            .slow_lock_node_registry_nodes_read_total
                            .load(Ordering::Relaxed)
                            + METRICS
                                .slow_lock_node_registry_nodes_write_total
                                .load(Ordering::Relaxed)
                            + METRICS
                                .slow_lock_node_registry_reserved_jobs_write_total
                                .load(Ordering::Relaxed)
                            + METRICS
                                .slow_lock_node_registry_unavailable_services_write_total
                                .load(Ordering::Relaxed)
                            + METRICS
                                .slow_lock_node_registry_exclude_reason_stats_read_total
                                .load(Ordering::Relaxed)
                            + METRICS
                                .slow_lock_node_registry_exclude_reason_stats_write_total
                                .load(Ordering::Relaxed),
                    ),
            },
            slow_path_by_path: SlowPathByPath {
                node_registry_select_node_with_features_total: METRICS
                    .slow_path_node_registry_select_node_with_features_total
                    .load(Ordering::Relaxed),
                node_registry_select_node_with_models_total: METRICS
                    .slow_path_node_registry_select_node_with_models_total
                    .load(Ordering::Relaxed),
                other_total: METRICS.slow_path_total.load(Ordering::Relaxed).saturating_sub(
                    METRICS
                        .slow_path_node_registry_select_node_with_features_total
                        .load(Ordering::Relaxed)
                        + METRICS
                            .slow_path_node_registry_select_node_with_models_total
                            .load(Ordering::Relaxed),
                ),
            },
        },
    }
}

fn top_k_from_map(map: &Mutex<HashMap<String, u64>>, k: usize) -> Vec<KeyCount> {
    let guard = map.lock().unwrap_or_else(|e| e.into_inner());
    let mut items: Vec<(String, u64)> = guard.iter().map(|(k, v)| (k.clone(), *v)).collect();
    drop(guard);
    items.sort_by(|a, b| b.1.cmp(&a.1));
    items
        .into_iter()
        .take(k)
        .map(|(key, count)| KeyCount { key, count })
        .collect()
}

fn format_dispatch_exclude_reason(r: &crate::node_registry::DispatchExcludeReason) -> String {
    use crate::node_registry::DispatchExcludeReason::*;
    match r {
        StatusNotReady => "StatusNotReady",
        NotInPublicPool => "NotInPublicPool",
        GpuUnavailable => "GpuUnavailable",
        ModelNotAvailable => "ModelNotAvailable",
        CapacityExceeded => "CapacityExceeded",
        ResourceThresholdExceeded => "ResourceThresholdExceeded",
    }
    .to_string()
}

// —— 计数器更新入口（避免各处直接操作 Atomic 细节）——

pub fn on_stats_response(is_stale: bool) {
    Metrics::inc(&METRICS.stats_requests_total);
    if is_stale {
        Metrics::inc(&METRICS.stats_stale_total);
    }
    crate::metrics::prometheus_metrics::on_stats_response(is_stale);
}

pub fn on_model_na_received() {
    Metrics::inc(&METRICS.model_na_received_total);
    crate::metrics::prometheus_metrics::on_model_na_received();
}

pub fn on_model_na_rate_limited() {
    Metrics::inc(&METRICS.model_na_rate_limited_total);
    // prom 侧需要 node_id 维度，因此在 *_detail 中记录；这里仅保留 total
}

pub fn on_model_na_marked() {
    Metrics::inc(&METRICS.model_na_marked_total);
    // prom 侧需要 node_id 维度，因此在 *_detail 中记录；这里仅保留 total
}

pub fn on_model_na_received_detail(node_id: &str, service_id: &str, reason: Option<&str>) {
    // service_id
    bump_limited_map(&MODEL_NA_BY_SERVICE, service_id, 200, &MODEL_NA_OTHER_SERVICE_TOTAL);
    // reason（归一化）
    let r = normalize_reason(reason);
    bump_limited_map(&MODEL_NA_BY_REASON, &r, 200, &MODEL_NA_OTHER_REASON_TOTAL);
    crate::metrics::prometheus_metrics::on_model_na_received_detail(service_id, &r);

    // 目前“received”不按 node 拆分（node_id 基数可能很高）；需要的话再加
    let _ = node_id;
}

pub fn on_model_na_rate_limited_detail(node_id: &str) {
    bump_limited_map(
        &MODEL_NA_RATE_LIMITED_BY_NODE,
        node_id,
        100,
        &MODEL_NA_OTHER_RATE_LIMITED_NODE_TOTAL,
    );
    crate::metrics::prometheus_metrics::on_model_na_rate_limited(node_id);
}

pub fn on_model_na_marked_detail(node_id: &str) {
    bump_limited_map(
        &MODEL_NA_MARKED_BY_NODE,
        node_id,
        100,
        &MODEL_NA_OTHER_MARKED_NODE_TOTAL,
    );
    crate::metrics::prometheus_metrics::on_model_na_marked(node_id);
}

fn bump_limited_map(
    map: &Mutex<HashMap<String, u64>>,
    key: &str,
    max_keys: usize,
    other: &AtomicU64,
) {
    let mut guard = map.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(v) = guard.get_mut(key) {
        *v += 1;
        return;
    }
    if guard.len() >= max_keys {
        other.fetch_add(1, Ordering::Relaxed);
        return;
    }
    guard.insert(key.to_string(), 1);
}

fn normalize_reason(reason: Option<&str>) -> String {
    let Some(r) = reason else {
        return "unknown".to_string();
    };
    let r = r.trim();
    if r.is_empty() {
        return "unknown".to_string();
    }
    // 低成本归一化：避免把整段错误栈打散成高基数 key
    let lowered = r.to_ascii_lowercase();
    if lowered.contains("not found") || lowered.contains("no such file") {
        "not_found".to_string()
    } else if lowered.contains("checksum") || lowered.contains("sha") || lowered.contains("hash") {
        "checksum_mismatch".to_string()
    } else if lowered.contains("load") || lowered.contains("init") {
        "load_failed".to_string()
    } else if lowered.contains("timeout") {
        "timeout".to_string()
    } else if lowered.contains("oom") || lowered.contains("out of memory") {
        "oom".to_string()
    } else {
        // 兜底：截断，避免超长文本造成指标膨胀
        let max_len = 64usize;
        if r.len() > max_len {
            format!("raw:{}", &r[..max_len])
        } else {
            format!("raw:{}", r)
        }
    }
}

pub fn on_web_task_finalized_by_send() {
    Metrics::inc(&METRICS.web_tasks_finalized_total);
    Metrics::inc(&METRICS.web_tasks_finalized_by_send_total);
    crate::metrics::prometheus_metrics::on_web_task_finalized("send");
}

pub fn on_web_task_finalized_by_pause() {
    Metrics::inc(&METRICS.web_tasks_finalized_total);
    Metrics::inc(&METRICS.web_tasks_finalized_by_pause_total);
    crate::metrics::prometheus_metrics::on_web_task_finalized("pause");
}

/// 记录 Session Actor 积压事件数（峰值）
pub fn on_session_actor_backlog(backlog_size: usize) {
    let current = METRICS.session_actor_backlog_size.load(Ordering::Relaxed);
    if backlog_size as u64 > current {
        METRICS.session_actor_backlog_size.store(backlog_size as u64, Ordering::Relaxed);
    }
}

/// 记录被抑制的重复 finalize
pub fn on_duplicate_finalize_suppressed() {
    METRICS.duplicate_finalize_suppressed_total.fetch_add(1, Ordering::Relaxed);
}

/// 记录被阻止的重复 job 创建
pub fn on_duplicate_job_blocked() {
    METRICS.duplicate_job_blocked_total.fetch_add(1, Ordering::Relaxed);
}

/// 记录结果队列超时
pub fn on_result_gap_timeout() {
    METRICS.result_gap_timeout_total.fetch_add(1, Ordering::Relaxed);
}

pub fn on_slow_lock_wait(lock_name: &'static str) {
    Metrics::inc(&METRICS.slow_lock_wait_total);
    crate::metrics::prometheus_metrics::on_slow_lock_wait(lock_name);
    match lock_name {
        "node_registry.nodes.read" => Metrics::inc(&METRICS.slow_lock_node_registry_nodes_read_total),
        "node_registry.nodes.write" => Metrics::inc(&METRICS.slow_lock_node_registry_nodes_write_total),
        "node_registry.reserved_jobs.write" => {
            Metrics::inc(&METRICS.slow_lock_node_registry_reserved_jobs_write_total)
        }
        "node_registry.unavailable_services.write" => {
            Metrics::inc(&METRICS.slow_lock_node_registry_unavailable_services_write_total)
        }
        "node_registry.exclude_reason_stats.read" => {
            Metrics::inc(&METRICS.slow_lock_node_registry_exclude_reason_stats_read_total)
        }
        "node_registry.exclude_reason_stats.write" => {
            Metrics::inc(&METRICS.slow_lock_node_registry_exclude_reason_stats_write_total)
        }
        _ => {}
    }
}

pub fn on_slow_path(path_name: &'static str) {
    Metrics::inc(&METRICS.slow_path_total);
    crate::metrics::prometheus_metrics::on_slow_path(path_name);
    match path_name {
        "node_registry.select_node_with_features" => {
            Metrics::inc(&METRICS.slow_path_node_registry_select_node_with_features_total)
        }
        "node_registry.select_node_with_models" => {
            Metrics::inc(&METRICS.slow_path_node_registry_select_node_with_models_total)
        }
        _ => {}
    }
}


