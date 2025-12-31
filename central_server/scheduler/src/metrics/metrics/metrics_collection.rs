// 指标收集函数

use crate::core::AppState;
use super::metrics_types::*;
use std::sync::atomic::Ordering;
use std::collections::HashMap;
use std::sync::Mutex;

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
            // RF-6: 音频块丢失修复相关指标
            empty_finalize_total: METRICS.empty_finalize_total.load(Ordering::Relaxed),
            index_gap_total: METRICS.index_gap_total.load(Ordering::Relaxed),
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
        rerun: RerunMetrics {
            trigger_count: METRICS.rerun_trigger_count.load(Ordering::Relaxed),
            success_count: METRICS.rerun_success_count.load(Ordering::Relaxed),
            timeout_count: METRICS.rerun_timeout_count.load(Ordering::Relaxed),
            quality_improvements: METRICS.rerun_quality_improvements.load(Ordering::Relaxed),
            context_reset_count: METRICS.context_reset_count.load(Ordering::Relaxed),
        },
        asr: {
            // OBS-1: 计算 ASR 延迟分位数
            let latencies_guard = ASR_E2E_LATENCIES.lock().unwrap_or_else(|e| e.into_inner());
            let mut latencies = latencies_guard.clone();
            drop(latencies_guard);
            latencies.sort();
            
            let latency_count = latencies.len() as u64;
            let p50_ms = if latency_count > 0 {
                latencies[(latency_count as usize * 50 / 100).min(latencies.len() - 1)]
            } else {
                0
            };
            let p95_ms = if latency_count > 0 {
                latencies[(latency_count as usize * 95 / 100).min(latencies.len() - 1)]
            } else {
                0
            };
            let p99_ms = if latency_count > 0 {
                latencies[(latency_count as usize * 99 / 100).min(latencies.len() - 1)]
            } else {
                0
            };

            // OBS-1: 计算语言置信度分布
            let lang_prob_guard = LANG_PROB_DISTRIBUTION.lock().unwrap_or_else(|e| e.into_inner());
            let lang_prob_dist = top_k_from_map(&Mutex::new(lang_prob_guard.clone()), 20);

            // OBS-1: 计算坏段检测率和重跑触发率
            let asr_total = METRICS.asr_total_count.load(Ordering::Relaxed);
            let bad_segment_count = METRICS.asr_bad_segment_count.load(Ordering::Relaxed);
            let rerun_trigger_count = METRICS.asr_rerun_trigger_count.load(Ordering::Relaxed);
            
            let bad_segment_rate = if asr_total > 0 {
                bad_segment_count as f64 / asr_total as f64
            } else {
                0.0
            };
            
            let rerun_trigger_rate = if asr_total > 0 {
                rerun_trigger_count as f64 / asr_total as f64
            } else {
                0.0
            };

            AsrMetrics {
                e2e_latency: AsrLatencyMetrics {
                    p50_ms,
                    p95_ms,
                    p99_ms,
                    count: latency_count,
                },
                lang_prob_distribution: lang_prob_dist,
                bad_segment_rate,
                rerun_trigger_rate,
            }
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

