use super::super::JobDispatcher;
use crate::messages::{FeatureFlags, PipelineConfig};

impl JobDispatcher {
    /// 节点选择逻辑（支持 preferred_node_id、spread策略、模块依赖展开等）
    pub(crate) async fn select_node_for_job_creation(
        &self,
        routing_key: &str,
        session_id: &str,
        src_lang: &str,
        tgt_lang: &str,
        features: &Option<FeatureFlags>,
        pipeline: &PipelineConfig,
        preferred_node_id: Option<String>,
        trace_id: &str,
        request_id: &str,
        now_ms: i64,
    ) -> (Option<String>, Option<(&'static str, &'static str)>) {
        // 用于 Prometheus：若最终 NO_AVAILABLE_NODE，则记录"按原因拆分"的一次计数
        let mut no_available_node_metric: Option<(&'static str, &'static str)> = None;

        // Phase 1：可选"打散"策略。若开启且窗口内存在上一次已派发节点，则优先避开（若无其他候选则回退）
        let exclude_node_id = if self.spread_enabled {
            self.last_dispatched_node_by_session
                .read()
                .await
                .get(session_id)
                .and_then(|(nid, ts)| {
                    if now_ms - *ts <= self.spread_window_ms {
                        Some(nid.clone())
                    } else {
                        None
                    }
                })
        } else {
            None
        };

        // 根据 v2 技术说明书，使用模块依赖展开算法选择节点
        if let Some(node_id) = preferred_node_id {
            // 如果指定了节点，检查节点是否可用
            if self.node_registry.is_node_available(&node_id).await {
                // 还需要检查节点是否具备所需的模型能力
                if let Some(features) = features {
                    if let Ok(required_models) =
                        self.get_required_types_for_features(pipeline, Some(features), src_lang, tgt_lang)
                    {
                        if !self.node_registry.check_node_has_types_ready(&node_id, &required_models).await {
                            // 节点不具备所需模型，回退到功能感知选择
                            let o = self
                                .select_node_with_module_expansion_with_breakdown(
                                    routing_key,
                                    src_lang,
                                    tgt_lang,
                                    Some(features.clone()),
                                    pipeline,
                                    true,
                                    None,
                                )
                                .await;
                            if o.selector == "phase3" {
                                if let Some(ref dbg) = o.phase3_debug {
                                    tracing::debug!(
                                        trace_id = %trace_id,
                                        request_id = %request_id,
                                        pool_count = dbg.pool_count,
                                        preferred_pool = dbg.preferred_pool,
                                        selected_pool = ?dbg.selected_pool,
                                        fallback_used = dbg.fallback_used,
                                        attempts = ?dbg.attempts,
                                        "Phase3 two-level scheduling fallback from preferred node"
                                    );
                                }
                            }
                            if o.node_id.is_none() {
                                no_available_node_metric =
                                    Some((o.selector, o.breakdown.best_reason_label()));
                            }
                            (o.node_id, no_available_node_metric)
                        } else {
                            (Some(node_id), None)
                        }
                    } else {
                        (Some(node_id), None)
                    }
                } else {
                    (Some(node_id), None)
                }
            } else {
                // 回退到功能感知选择
                let o = self
                    .select_node_with_module_expansion_with_breakdown(
                        routing_key,
                        src_lang,
                        tgt_lang,
                        features.clone(),
                        pipeline,
                        true,
                        None,
                    )
                    .await;
                if o.selector == "phase3" {
                    if let Some(ref dbg) = o.phase3_debug {
                        tracing::debug!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase3 two-level scheduling fallback from unavailable preferred node"
                        );
                    }
                }
                if o.node_id.is_none() {
                    no_available_node_metric = Some((o.selector, o.breakdown.best_reason_label()));
                }
                return (o.node_id, no_available_node_metric);
            }
        } else {
            // 使用模块依赖展开算法选择节点
            // 先尝试避开上一节点；如果无候选再回退不避开
            let excluded = exclude_node_id.as_deref();
            let first = self
                .select_node_with_module_expansion_with_breakdown(
                    routing_key,
                    src_lang,
                    tgt_lang,
                    features.clone(),
                    pipeline,
                    true,
                    excluded,
                )
                .await;
            if first.selector == "phase3" {
                if let Some(ref dbg) = first.phase3_debug {
                    if dbg.fallback_used || dbg.selected_pool.is_none() {
                        tracing::warn!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase3 two-level scheduling used fallback or failed"
                        );
                    }
                }
            }
            if first.node_id.is_some() {
                return (first.node_id, None);
            } else {
                let second = self
                    .select_node_with_module_expansion_with_breakdown(
                        routing_key,
                        src_lang,
                        tgt_lang,
                        features.clone(),
                        pipeline,
                        true,
                        None,
                    )
                    .await;
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
                if second.node_id.is_none() {
                    // 仅记录最终失败的原因（第二次：不避开上一节点）
                    no_available_node_metric =
                        Some((second.selector, second.breakdown.best_reason_label()));
                }
                return (second.node_id, no_available_node_metric);
            }
        }
    }
}

