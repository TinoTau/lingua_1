// 指标记录函数

use super::metrics_types::{METRICS, MODEL_NA_BY_SERVICE, MODEL_NA_BY_REASON, MODEL_NA_RATE_LIMITED_BY_NODE, MODEL_NA_MARKED_BY_NODE, MODEL_NA_OTHER_SERVICE_TOTAL, MODEL_NA_OTHER_REASON_TOTAL, MODEL_NA_OTHER_RATE_LIMITED_NODE_TOTAL, MODEL_NA_OTHER_MARKED_NODE_TOTAL, ASR_E2E_LATENCIES, LANG_PROB_DISTRIBUTION};
use std::sync::atomic::{AtomicU64, Ordering};
use std::collections::HashMap;
use std::sync::Mutex;

// —— 计数器更新入口（避免各处直接操作 Atomic 细节）——

pub fn on_stats_response(is_stale: bool) {
    super::metrics_types::Metrics::inc(&METRICS.stats_requests_total);
    if is_stale {
        super::metrics_types::Metrics::inc(&METRICS.stats_stale_total);
    }
    crate::metrics::prometheus_metrics::on_stats_response(is_stale);
}

pub fn on_model_na_received() {
    super::metrics_types::Metrics::inc(&METRICS.model_na_received_total);
    crate::metrics::prometheus_metrics::on_model_na_received();
}

pub fn on_model_na_rate_limited() {
    super::metrics_types::Metrics::inc(&METRICS.model_na_rate_limited_total);
    // prom 侧需要 node_id 维度，因此在 *_detail 中记录；这里仅保留 total
}

pub fn on_model_na_marked() {
    super::metrics_types::Metrics::inc(&METRICS.model_na_marked_total);
    // prom 侧需要 node_id 维度，因此在 *_detail 中记录；这里仅保留 total
}

pub fn on_model_na_received_detail(node_id: &str, service_id: &str, reason: Option<&str>) {
    // service_id
    bump_limited_map(&MODEL_NA_BY_SERVICE, service_id, 200, &MODEL_NA_OTHER_SERVICE_TOTAL);
    // reason（归一化）
    let r = normalize_reason(reason);
    bump_limited_map(&MODEL_NA_BY_REASON, &r, 200, &MODEL_NA_OTHER_REASON_TOTAL);
    crate::metrics::prometheus_metrics::on_model_na_received_detail(service_id, &r);

    // 目前"received"不按 node 拆分（node_id 基数可能很高）；需要的话再加
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
    super::metrics_types::Metrics::inc(&METRICS.web_tasks_finalized_total);
    super::metrics_types::Metrics::inc(&METRICS.web_tasks_finalized_by_send_total);
    crate::metrics::prometheus_metrics::on_web_task_finalized("send");
}

pub fn on_web_task_finalized_by_pause() {
    super::metrics_types::Metrics::inc(&METRICS.web_tasks_finalized_total);
    super::metrics_types::Metrics::inc(&METRICS.web_tasks_finalized_by_pause_total);
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

/// RF-6: 记录空缓冲区 finalize 尝试（应该为 0，表示修复生效）
pub fn on_empty_finalize() {
    METRICS.empty_finalize_total.fetch_add(1, Ordering::Relaxed);
}

// 已删除未使用的函数：on_index_gap
// 此函数未被调用

pub fn on_slow_lock_wait(lock_name: &'static str) {
    super::metrics_types::Metrics::inc(&METRICS.slow_lock_wait_total);
    crate::metrics::prometheus_metrics::on_slow_lock_wait(lock_name);
    match lock_name {
        "node_registry.management_registry.read" => super::metrics_types::Metrics::inc(&METRICS.slow_lock_node_registry_nodes_read_total),
        "node_registry.management_registry.write" => super::metrics_types::Metrics::inc(&METRICS.slow_lock_node_registry_nodes_write_total),
        "node_registry.reserved_jobs.write" => {
            super::metrics_types::Metrics::inc(&METRICS.slow_lock_node_registry_reserved_jobs_write_total)
        }
        "node_registry.unavailable_services.write" => {
            super::metrics_types::Metrics::inc(&METRICS.slow_lock_node_registry_unavailable_services_write_total)
        }
        "node_registry.exclude_reason_stats.read" => {
            super::metrics_types::Metrics::inc(&METRICS.slow_lock_node_registry_exclude_reason_stats_read_total)
        }
        "node_registry.exclude_reason_stats.write" => {
            super::metrics_types::Metrics::inc(&METRICS.slow_lock_node_registry_exclude_reason_stats_write_total)
        }
        _ => {}
    }
}

pub fn on_slow_path(path_name: &'static str) {
    super::metrics_types::Metrics::inc(&METRICS.slow_path_total);
    crate::metrics::prometheus_metrics::on_slow_path(path_name);
    match path_name {
        "node_registry.select_node_with_features" => {
            super::metrics_types::Metrics::inc(&METRICS.slow_path_node_registry_select_node_with_features_total)
        }
        "node_registry.select_node_with_models" => {
            super::metrics_types::Metrics::inc(&METRICS.slow_path_node_registry_select_node_with_models_total)
        }
        _ => {}
    }
}

// OBS-1: ASR 指标记录函数

/// 记录 ASR 端到端延迟
pub fn record_asr_e2e_latency(latency_ms: u64) {
    let mut latencies = ASR_E2E_LATENCIES.lock().unwrap_or_else(|e| e.into_inner());
    latencies.push(latency_ms);
    // 保持最多 1000 个值
    if latencies.len() > 1000 {
        latencies.remove(0);
    }
    METRICS.asr_total_count.fetch_add(1, Ordering::Relaxed);
}

/// 记录语言置信度分布
pub fn record_lang_probability(lang_prob: f32) {
    // 将置信度按区间分组：0.0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0
    let bucket = if lang_prob < 0.2 {
        "0.0-0.2"
    } else if lang_prob < 0.4 {
        "0.2-0.4"
    } else if lang_prob < 0.6 {
        "0.4-0.6"
    } else if lang_prob < 0.8 {
        "0.6-0.8"
    } else {
        "0.8-1.0"
    };
    
    let mut dist = LANG_PROB_DISTRIBUTION.lock().unwrap_or_else(|e| e.into_inner());
    *dist.entry(bucket.to_string()).or_insert(0) += 1;
}

/// 记录坏段检测
pub fn record_bad_segment() {
    METRICS.asr_bad_segment_count.fetch_add(1, Ordering::Relaxed);
}

/// 记录重跑触发
pub fn record_rerun_trigger() {
    METRICS.asr_rerun_trigger_count.fetch_add(1, Ordering::Relaxed);
}

