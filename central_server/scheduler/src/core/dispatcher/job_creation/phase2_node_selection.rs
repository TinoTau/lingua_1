//! Phase 2 节点选择模块

use super::super::JobDispatcher;
use crate::messages::{FeatureFlags, PipelineConfig};

impl JobDispatcher {
    /// Phase 2: 节点选择逻辑（在锁外执行，减少锁持有时间）
    pub(crate) async fn select_node_for_phase2(
        &self,
        preferred_node_id: Option<String>,
        exclude_node_id: Option<String>,
        preferred_pool: Option<u16>,
        routing_key: &str,
        src_lang: &str,
        tgt_lang: &str,
        features: &Option<FeatureFlags>,
        pipeline: &PipelineConfig,
        trace_id: &str,
        request_id: &str,
        session_id: &str,
    ) -> Option<String> {
        let node_selection_start = std::time::Instant::now();

        let assigned_node_id = if let Some(node_id) = preferred_node_id {
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                preferred_node_id = %node_id,
                "Phase2 路径: 使用 preferred_node_id 进行节点选择"
            );
            if self.node_registry.is_node_available(&node_id).await {
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    node_id = %node_id,
                    "Phase2 路径: preferred_node_id 节点可用"
                );
                Some(node_id)
            } else {
                tracing::warn!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    node_id = %node_id,
                    "Phase2 路径: preferred_node_id 节点不可用，fallback 到模块展开选择"
                );
                None
            }
        } else {
            let excluded = exclude_node_id.as_deref();
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                preferred_pool = ?preferred_pool,
                exclude_node_id = ?excluded,
                "Phase2 路径: 使用模块展开算法进行节点选择"
            );
            let first = self
                .select_node_with_module_expansion_with_breakdown(
                    routing_key,
                    src_lang,
                    tgt_lang,
                    features.clone(),
                    pipeline,
                    true,
                    excluded,
                    preferred_pool, // 传递 Session 锁内决定的 preferred_pool
                )
                .await;
            let first_selection_elapsed = node_selection_start.elapsed();
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                selector = %first.selector,
                node_id = ?first.node_id,
                elapsed_ms = first_selection_elapsed.as_millis(),
                "Phase2 路径: 第一次节点选择完成"
            );
            if first.selector == "phase3" {
                if let Some(ref dbg) = first.phase3_debug {
                    tracing::info!(
                        trace_id = %trace_id,
                        request_id = %request_id,
                        session_id = %session_id,
                        pool_count = dbg.pool_count,
                        preferred_pool = dbg.preferred_pool,
                        selected_pool = ?dbg.selected_pool,
                        fallback_used = dbg.fallback_used,
                        attempts = ?dbg.attempts,
                        "Phase2 路径: Phase3 两级调度详情"
                    );
                    if dbg.fallback_used || dbg.selected_pool.is_none() {
                        tracing::warn!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            session_id = %session_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase2 路径: Phase3 two-level scheduling used fallback or failed"
                        );
                    }
                }
            }
            if first.node_id.is_some() {
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    selected_node_id = %first.node_id.as_ref().unwrap(),
                    "Phase2 路径: 节点选择成功（第一次尝试）"
                );
                first.node_id
            } else {
                tracing::warn!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    breakdown_reason = %first.breakdown.best_reason_label(),
                    "Phase2 路径: 第一次节点选择失败，开始第二次尝试（不排除节点）"
                );
                // 第二次尝试：不避开上一节点，但仍使用 preferred_pool（如果存在）
                let second_start = std::time::Instant::now();
                let second = self
                    .select_node_with_module_expansion_with_breakdown(
                        routing_key,
                        src_lang,
                        tgt_lang,
                        features.clone(),
                        pipeline,
                        true,
                        None,
                        preferred_pool, // 传递 Session 锁内决定的 preferred_pool
                    )
                    .await;
                let second_elapsed = second_start.elapsed();
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    selector = %second.selector,
                    node_id = ?second.node_id,
                    elapsed_ms = second_elapsed.as_millis(),
                    "Phase2 路径: 第二次节点选择完成"
                );
                if second.selector == "phase3" {
                    if let Some(ref dbg) = second.phase3_debug {
                        tracing::warn!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase3 two-level scheduling second attempt"
                        );
                    }
                }
                second.node_id
            }
        };

        let node_selection_elapsed = node_selection_start.elapsed();
        tracing::info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            assigned_node_id = ?assigned_node_id,
            elapsed_ms = node_selection_elapsed.as_millis(),
            "Phase2 路径: 节点选择完成（锁外）"
        );

        assigned_node_id
    }
}
