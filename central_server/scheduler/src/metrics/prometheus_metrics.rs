// 方向B：Prometheus 指标
// - /metrics 暴露 text format
// - 指标命名遵循 Prometheus 习惯（snake_case + *_total / *_seconds）
// - 对高基数字段做容量限制（避免 label 爆炸）

use crate::core::AppState;
use prometheus::{
    Encoder, Histogram, HistogramOpts, IntCounter, IntCounterVec, IntGauge, Opts, Registry,
    TextEncoder,
};
use std::collections::HashSet;
use std::sync::Mutex;

lazy_static::lazy_static! {
    pub static ref REGISTRY: Registry = Registry::new_custom(Some("scheduler".to_string()), None)
        .expect("Failed to create Prometheus registry");

    // —— stats —— //
    static ref STATS_REQUESTS_TOTAL: IntCounter =
        IntCounter::with_opts(Opts::new("stats_requests_total", "Total /api/v1/stats requests"))
            .expect("metric");
    static ref STATS_STALE_TOTAL: IntCounter =
        IntCounter::with_opts(Opts::new("stats_stale_total", "Total stale stats responses"))
            .expect("metric");
    static ref STATS_REQUEST_DURATION_SECONDS: Histogram = Histogram::with_opts(
        HistogramOpts::new(
            "stats_request_duration_seconds",
            "Duration of /api/v1/stats handler in seconds"
        )
        .buckets(vec![
            0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0,
        ]),
    )
    .expect("metric");

    // —— gauges from state —— //
    static ref DASHBOARD_SNAPSHOT_AGE_SECONDS: IntGauge =
        IntGauge::with_opts(Opts::new(
            "dashboard_snapshot_age_seconds",
            "Now - dashboard snapshot updated_at in seconds (0 means never updated)"
        ))
        .expect("metric");
    static ref SERVICE_CATALOG_FAIL_COUNT: IntGauge = IntGauge::with_opts(Opts::new(
        "service_catalog_fail_count",
        "Consecutive failures of service catalog refresh"
    ))
    .expect("metric");
    static ref SERVICE_CATALOG_LAST_SUCCESS_AGE_SECONDS: IntGauge =
        IntGauge::with_opts(Opts::new(
            "service_catalog_last_success_age_seconds",
            "Now - service catalog last_success_at in seconds (0 means never succeeded)"
        ))
        .expect("metric");

    static ref WEB_TASK_PAUSE_MS: IntGauge = IntGauge::with_opts(Opts::new(
        "web_task_pause_ms",
        "Configured pause_ms for web task segmentation"
    ))
    .expect("metric");

    // —— observability —— //
    static ref SLOW_PATH_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "slow_path_total",
            "Slow critical path events over threshold"
        ),
        &["path"]
    )
    .expect("metric");

    // —— web segmentation —— //
    static ref WEB_TASK_FINALIZED_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "web_task_finalized_total",
            "Web task finalized count by reason"
        ),
        &["reason"] // send|timeout
    )
    .expect("metric");

    // —— dispatch (NO_AVAILABLE_NODE) —— //
    static ref NO_AVAILABLE_NODE_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "no_available_node_total",
            "Dispatch failed with NO_AVAILABLE_NODE (by selector and reason)"
        ),
        &["selector", "reason"] // selector=models|features|reserve, reason=...
    )
    .expect("metric");

    // —— Phase3 two-level scheduling —— //
    static ref PHASE3_POOL_SELECTED_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "phase3_pool_selected_total",
            "Phase3 two-level selected pool total (by pool, outcome, fallback)"
        ),
        &["pool", "outcome", "fallback"] // outcome=hit|miss, fallback=true|false
    )
    .expect("metric");

    static ref PHASE3_POOL_ATTEMPT_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "phase3_pool_attempt_total",
            "Phase3 two-level pool attempt total (by pool, result, reason)"
        ),
        &["pool", "result", "reason"] // result=success|fail, reason=ok|no_nodes|offline|...
    )
    .expect("metric");

    // —— MODEL_NOT_AVAILABLE —— //
    static ref MODEL_NA_RECEIVED_TOTAL: IntCounter =
        IntCounter::with_opts(Opts::new("model_na_received_total", "MODEL_NOT_AVAILABLE received"))
            .expect("metric");
    static ref MODEL_NA_RATE_LIMITED_TOTAL: IntCounter = IntCounter::with_opts(Opts::new(
        "model_na_rate_limited_total",
        "MODEL_NOT_AVAILABLE rate limited and dropped"
    ))
    .expect("metric");
    static ref MODEL_NA_MARKED_TOTAL: IntCounter =
        IntCounter::with_opts(Opts::new("model_na_marked_total", "MODEL_NOT_AVAILABLE marked"))
            .expect("metric");

    static ref MODEL_NA_BY_SERVICE_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "model_na_by_service_total",
            "MODEL_NOT_AVAILABLE received by service_id (bounded)"
        ),
        &["service_id"]
    )
    .expect("metric");
    static ref MODEL_NA_BY_REASON_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "model_na_by_reason_total",
            "MODEL_NOT_AVAILABLE received by reason (normalized, bounded)"
        ),
        &["reason"]
    )
    .expect("metric");
    static ref MODEL_NA_RATE_LIMITED_BY_NODE_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "model_na_rate_limited_by_node_total",
            "MODEL_NOT_AVAILABLE rate limited by node_id (bounded)"
        ),
        &["node_id"]
    )
    .expect("metric");
    static ref MODEL_NA_MARKED_BY_NODE_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "model_na_marked_by_node_total",
            "MODEL_NOT_AVAILABLE marked by node_id (bounded)"
        ),
        &["node_id"]
    )
    .expect("metric");

    static ref MODEL_NA_OTHER_SERVICE_TOTAL: IntCounter =
        IntCounter::with_opts(Opts::new("model_na_other_service_total", "MODEL_NOT_AVAILABLE other service_id bucket"))
            .expect("metric");
    static ref MODEL_NA_OTHER_REASON_TOTAL: IntCounter =
        IntCounter::with_opts(Opts::new("model_na_other_reason_total", "MODEL_NOT_AVAILABLE other reason bucket"))
            .expect("metric");
    static ref MODEL_NA_OTHER_RATE_LIMITED_NODE_TOTAL: IntCounter =
        IntCounter::with_opts(Opts::new("model_na_other_rate_limited_node_total", "MODEL_NOT_AVAILABLE other rate_limited node bucket"))
            .expect("metric");
    static ref MODEL_NA_OTHER_MARKED_NODE_TOTAL: IntCounter =
        IntCounter::with_opts(Opts::new("model_na_other_marked_node_total", "MODEL_NOT_AVAILABLE other marked node bucket"))
            .expect("metric");

    // —— Phase2 streams —— //
    static ref PHASE2_REDIS_OP_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "phase2_redis_op_total",
            "Phase2 redis operations total by op and result"
        ),
        &["op", "result"]
    )
    .expect("metric");
    static ref PHASE2_INBOX_PENDING: IntGauge = IntGauge::with_opts(Opts::new(
        "phase2_inbox_pending",
        "Phase2 inbox pending count (for this instance)"
    ))
    .expect("metric");
    static ref PHASE2_DLQ_MOVED_TOTAL: IntCounter = IntCounter::with_opts(Opts::new(
        "phase2_dlq_moved_total",
        "Phase2 moved messages to DLQ total"
    ))
    .expect("metric");

    // —— Reservation observability —— //
    static ref RESERVE_ATTEMPT_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "reserve_attempt_total",
            "Reserve attempt total (by result)"
        ),
        &["result"] // result=success|fail|error
    )
    .expect("metric");


    static ref DISPATCH_LATENCY_SECONDS: Histogram = Histogram::with_opts(
        HistogramOpts::new(
            "dispatch_latency_seconds",
            "Dispatch latency from reserve to send (seconds)"
        )
        .buckets(vec![
            0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0,
        ]),
    )
    .expect("metric");

    static ref ACK_TIMEOUT_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "ack_timeout_total",
            "ACK timeout total (by job_id prefix for bounded cardinality)"
        ),
        &["job_prefix"] // job_id 前缀（限制基数）
    )
    .expect("metric");

    static ref NODE_OVERLOAD_REJECT_TOTAL: IntCounterVec = IntCounterVec::new(
        Opts::new(
            "node_overload_reject_total",
            "Node overload reject total (by node_id and reason)"
        ),
        &["node_id", "reason"] // reason=full|not_ready|error
    )
    .expect("metric");

    static ref SERVICE_KEYS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
    static ref REASON_KEYS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
    static ref RATE_LIMITED_NODE_KEYS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
    static ref MARKED_NODE_KEYS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
}

pub fn init() {
    // 注册所有指标（只做一次）
    let _ = REGISTRY.register(Box::new(STATS_REQUESTS_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(STATS_STALE_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(STATS_REQUEST_DURATION_SECONDS.clone()));

    let _ = REGISTRY.register(Box::new(DASHBOARD_SNAPSHOT_AGE_SECONDS.clone()));
    let _ = REGISTRY.register(Box::new(SERVICE_CATALOG_FAIL_COUNT.clone()));
    let _ = REGISTRY.register(Box::new(SERVICE_CATALOG_LAST_SUCCESS_AGE_SECONDS.clone()));
    let _ = REGISTRY.register(Box::new(WEB_TASK_PAUSE_MS.clone()));

    let _ = REGISTRY.register(Box::new(SLOW_PATH_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(WEB_TASK_FINALIZED_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(NO_AVAILABLE_NODE_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(PHASE3_POOL_SELECTED_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(PHASE3_POOL_ATTEMPT_TOTAL.clone()));

    let _ = REGISTRY.register(Box::new(MODEL_NA_RECEIVED_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_RATE_LIMITED_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_MARKED_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_BY_SERVICE_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_BY_REASON_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_RATE_LIMITED_BY_NODE_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_MARKED_BY_NODE_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_OTHER_SERVICE_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_OTHER_REASON_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_OTHER_RATE_LIMITED_NODE_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MODEL_NA_OTHER_MARKED_NODE_TOTAL.clone()));

    let _ = REGISTRY.register(Box::new(PHASE2_REDIS_OP_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(PHASE2_INBOX_PENDING.clone()));
    let _ = REGISTRY.register(Box::new(PHASE2_DLQ_MOVED_TOTAL.clone()));

    let _ = REGISTRY.register(Box::new(RESERVE_ATTEMPT_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(DISPATCH_LATENCY_SECONDS.clone()));
    let _ = REGISTRY.register(Box::new(ACK_TIMEOUT_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(NODE_OVERLOAD_REJECT_TOTAL.clone()));
}

pub fn observe_stats_request_duration_seconds(secs: f64) {
    STATS_REQUEST_DURATION_SECONDS.observe(secs);
}

pub fn on_stats_response(is_stale: bool) {
    STATS_REQUESTS_TOTAL.inc();
    if is_stale {
        STATS_STALE_TOTAL.inc();
    }
}


pub fn on_slow_path(path_name: &'static str) {
    SLOW_PATH_TOTAL.with_label_values(&[path_name]).inc();
}

pub fn on_web_task_finalized(reason: &'static str) {
    WEB_TASK_FINALIZED_TOTAL.with_label_values(&[reason]).inc();
}


pub fn on_model_na_received() {
    MODEL_NA_RECEIVED_TOTAL.inc();
}

pub fn on_model_na_rate_limited(node_id: &str) {
    MODEL_NA_RATE_LIMITED_TOTAL.inc();
    inc_bounded(
        &MODEL_NA_RATE_LIMITED_BY_NODE_TOTAL,
        &RATE_LIMITED_NODE_KEYS,
        node_id,
        100,
        &MODEL_NA_OTHER_RATE_LIMITED_NODE_TOTAL,
        "node_id",
    );
}

pub fn on_model_na_marked(node_id: &str) {
    MODEL_NA_MARKED_TOTAL.inc();
    inc_bounded(
        &MODEL_NA_MARKED_BY_NODE_TOTAL,
        &MARKED_NODE_KEYS,
        node_id,
        100,
        &MODEL_NA_OTHER_MARKED_NODE_TOTAL,
        "node_id",
    );
}

pub fn on_model_na_received_detail(service_id: &str, reason: &str) {
    inc_bounded(
        &MODEL_NA_BY_SERVICE_TOTAL,
        &SERVICE_KEYS,
        service_id,
        200,
        &MODEL_NA_OTHER_SERVICE_TOTAL,
        "service_id",
    );
    inc_bounded(
        &MODEL_NA_BY_REASON_TOTAL,
        &REASON_KEYS,
        reason,
        200,
        &MODEL_NA_OTHER_REASON_TOTAL,
        "reason",
    );
}

// ===== Phase2 helpers =====
pub fn phase2_redis_op(op: &'static str, ok: bool) {
    let result = if ok { "ok" } else { "err" };
    PHASE2_REDIS_OP_TOTAL.with_label_values(&[op, result]).inc();
}

pub fn set_phase2_inbox_pending(v: i64) {
    PHASE2_INBOX_PENDING.set(v);
}

pub fn on_phase2_dlq_moved() {
    PHASE2_DLQ_MOVED_TOTAL.inc();
}

fn inc_bounded(
    vec: &IntCounterVec,
    keys: &Mutex<HashSet<String>>,
    value: &str,
    max_keys: usize,
    other: &IntCounter,
    label_name: &str,
) {
    let mut guard = keys.lock().unwrap_or_else(|e| e.into_inner());
    if !guard.contains(value) {
        if guard.len() >= max_keys {
            other.inc();
            return;
        }
        guard.insert(value.to_string());
    }
    drop(guard);
    // label_name 只是为了明确意图；counter vec 已经固定了 label
    let _ = label_name;
    vec.with_label_values(&[value]).inc();
}

pub async fn update_gauges_from_state(state: &AppState) {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let updated_at = state.dashboard_snapshot.last_updated_at_ms().await;
    if updated_at <= 0 {
        DASHBOARD_SNAPSHOT_AGE_SECONDS.set(0);
    } else {
        let age_s = (now_ms.saturating_sub(updated_at) / 1000).max(0);
        DASHBOARD_SNAPSHOT_AGE_SECONDS.set(age_s as i64);
    }

    let meta = state.service_catalog.get_meta().await;
    SERVICE_CATALOG_FAIL_COUNT.set(meta.fail_count as i64);
    if meta.last_success_at_ms <= 0 {
        SERVICE_CATALOG_LAST_SUCCESS_AGE_SECONDS.set(0);
    } else {
        let age_s = (now_ms.saturating_sub(meta.last_success_at_ms) / 1000).max(0);
        SERVICE_CATALOG_LAST_SUCCESS_AGE_SECONDS.set(age_s as i64);
    }

    WEB_TASK_PAUSE_MS.set(state.web_task_segmentation.pause_ms as i64);
}

pub async fn render_text(state: &AppState) -> (String, String) {
    update_gauges_from_state(state).await;
    let encoder = TextEncoder::new();
    let metric_families = REGISTRY.gather();
    let mut buf = Vec::new();
    encoder.encode(&metric_families, &mut buf).unwrap_or(());
    let content_type = encoder.format_type().to_string();
    (String::from_utf8_lossy(&buf).to_string(), content_type)
}

// ===== Reservation observability =====

/// 记录 reserve 尝试（成功/失败）
pub fn on_reserve_attempt(success: bool) {
    let result = if success { "success" } else { "fail" };
    RESERVE_ATTEMPT_TOTAL.with_label_values(&[result]).inc();
}

/// 记录 reserve 错误（Redis 不可用等）
pub fn on_reserve_error() {
    RESERVE_ATTEMPT_TOTAL.with_label_values(&["error"]).inc();
}


/// 记录派发延迟（从 reserve 到 send 的耗时）
pub fn observe_dispatch_latency(seconds: f64) {
    DISPATCH_LATENCY_SECONDS.observe(seconds);
}

/// 记录 ACK 超时（使用 job_id 前缀限制基数）
pub fn on_ack_timeout(job_id: &str) {
    // 使用 job_id 的前8个字符作为前缀，限制 label 基数
    let prefix = if job_id.len() >= 8 {
        &job_id[..8]
    } else {
        job_id
    };
    ACK_TIMEOUT_TOTAL.with_label_values(&[prefix]).inc();
}

/// 记录节点过载拒绝（FULL / NOT_READY / ERROR）
pub fn on_node_overload_reject(node_id: &str, reason: &'static str) {
    NODE_OVERLOAD_REJECT_TOTAL
        .with_label_values(&[node_id, reason])
        .inc();
}


