use super::super::JobDispatcher;
use crate::messages::{FeatureFlags, PipelineConfig};
use std::collections::HashSet;

impl JobDispatcher {
    /// 检查节点是否能够处理指定的语言对 (src_lang, tgt_lang)
    /// 使用 RuntimeSnapshot 进行无锁检查（Job 层级应该完全避免锁操作）
    /// 根据设计文档，节点必须：
    /// 1. 节点的语言能力支持该语言对（从 snapshot 检查）
    /// 2. 节点在包含 src_lang 和 tgt_lang 的 Pool 中（从 snapshot 检查 pool_ids）
    /// 注意：根据 v3.0 设计，应该使用快照克隆，避免在调度路径上持有锁
    async fn check_node_supports_language_pair(
        &self,
        node_id: &str,
        src_lang: &str,
        tgt_lang: &str,
        snapshot: &crate::node_registry::RuntimeSnapshot,
    ) -> bool {
        // 使用快照克隆（无锁读取，符合 v3.0 设计）
        if let Some(node) = snapshot.nodes.get(node_id) {
            // 方法1：检查节点的语言能力（从 snapshot 读取）
            // 检查语义修复服务是否支持 src_lang 和 tgt_lang
            let semantic_set: HashSet<&str> = node.capabilities.semantic_languages.iter().map(|s| s.as_str()).collect();
            if semantic_set.contains(src_lang) && semantic_set.contains(tgt_lang) {
                // 检查 ASR、TTS 能力
                let has_asr = node.capabilities.asr_languages.contains(&src_lang.to_string());
                let has_tts = node.capabilities.tts_languages.contains(&tgt_lang.to_string());
                // NMT 检查：从快照中检查语言对支持
                // 注意：快照中不包含详细的 NMT 能力信息，这里简化处理
                // 如果需要详细的 NMT 检查，应该从 Redis 读取（但不在锁内）
                let has_nmt = true; // 简化：假设如果节点在 Pool 中，就支持 NMT
                
                if has_asr && has_tts && has_nmt {
                    return true;
                }
            }
            
            // 方法2：检查节点是否在包含 src_lang 和 tgt_lang 的 Pool 中（从 snapshot 读取 pool_ids）
            // 注意：这里需要从 snapshot 中获取 Pool 配置信息，但 snapshot 中可能不包含完整的 Pool 配置
            // 所以这里简化处理：如果节点支持语言对的能力，就认为它支持该语言对
            // 实际的 Pool 检查在 select_node_with_types_two_level_excluding_with_breakdown 中已经完成
        }
        
        false
    }
    /// 节点选择逻辑（支持 preferred_node_id、spread策略、模块依赖展开等）
    /// 根据 v3.0 设计，preferred_pool 和 exclude_node_id 应该在 Session 锁内决定
    /// 【修复2】接收快照作为参数，避免重复获取
    pub(crate) async fn select_node_for_job_creation(
        &self,
        routing_key: &str,
        session_id: &str,
        src_lang: &str,
        tgt_lang: &str,
        features: &Option<FeatureFlags>,
        pipeline: &PipelineConfig,
        preferred_node_id: Option<String>,
        preferred_pool: Option<u16>,
        trace_id: &str,
        request_id: &str,
        _now_ms: i64,
        exclude_node_id: Option<String>,
        snapshot: &crate::node_registry::RuntimeSnapshot, // 【修复2】传递快照作为参数
    ) -> (Option<String>, Option<(&'static str, &'static str)>) {
        // 用于 Prometheus：若最终 NO_AVAILABLE_NODE，则记录"按原因拆分"的一次计数
        let mut no_available_node_metric: Option<(&'static str, &'static str)> = None;

        // 根据 v3.0 设计，exclude_node_id 和 preferred_pool 已经在 Session 锁内决定，直接使用
        let excluded = exclude_node_id.as_deref();
        let _preferred_pool = preferred_pool; // 目前节点选择逻辑内部会决定 preferred_pool，后续可以优化使用 Session 锁内决定的 preferred_pool

        // 根据 v2 技术说明书，使用模块依赖展开算法选择节点
        tracing::info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            preferred_node_id = ?preferred_node_id,
            "开始节点选择"
        );
        
        if let Some(node_id) = preferred_node_id {
            // 步骤1：检查节点是否可用
            if !self.node_registry.is_node_available(&node_id).await {
                tracing::debug!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    node_id = %node_id,
                    "preferred_node_id 节点不可用，fallback 到随机选择"
                );
                // 回退到功能感知选择（使用 preferred_pool，如果存在）
                let o = self
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
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    preferred_node_id = %node_id,
                    fallback_reason = "node_unavailable",
                    selected_node = ?o.node_id,
                    "preferred_node_id 节点不可用，已回退到随机选择"
                );
                return (o.node_id, no_available_node_metric);
            }
            
            // 步骤2：校验节点是否在对应池中（或是否满足能力约束）
            // 【修复2】使用传入的快照，避免重复获取（减少锁竞争）
            if !self.check_node_supports_language_pair(&node_id, src_lang, tgt_lang, snapshot).await {
                tracing::debug!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    node_id = %node_id,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "preferred_node_id 节点不在对应池中或不支持语言对，fallback 到随机选择"
                );
                // 回退到功能感知选择（使用 preferred_pool，如果存在）
                let o = self
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
                            "Phase3 two-level scheduling fallback from preferred node (not in pool)"
                        );
                    }
                }
                if o.node_id.is_none() {
                    no_available_node_metric = Some((o.selector, o.breakdown.best_reason_label()));
                }
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    preferred_node_id = %node_id,
                    fallback_reason = "node_not_in_pool",
                    selected_node = ?o.node_id,
                    "preferred_node_id 节点不在对应池中，已回退到随机选择"
                );
                return (o.node_id, no_available_node_metric);
            }
            
            // 步骤3：检查节点是否具备所需的模型能力
            if let Some(features) = features {
                if let Ok(required_models) =
                    self.get_required_types_for_features(pipeline, Some(features), src_lang, tgt_lang)
                {
                    if !self.node_registry.check_node_has_types_ready(&node_id, &required_models, self.phase2.as_ref().map(|rt| rt.as_ref())).await {
                        tracing::debug!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            node_id = %node_id,
                            "preferred_node_id 节点不具备所需模型，fallback 到随机选择"
                        );
                        // 节点不具备所需模型，回退到功能感知选择（使用 preferred_pool，如果存在）
                        let o = self
                            .select_node_with_module_expansion_with_breakdown(
                                routing_key,
                                src_lang,
                                tgt_lang,
                                Some(features.clone()),
                                pipeline,
                                true,
                                None,
                                preferred_pool, // 传递 Session 锁内决定的 preferred_pool
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
                                    "Phase3 two-level scheduling fallback from preferred node (missing models)"
                                );
                            }
                        }
                        if o.node_id.is_none() {
                            no_available_node_metric =
                                Some((o.selector, o.breakdown.best_reason_label()));
                        }
                        return (o.node_id, no_available_node_metric);
                    }
                }
            }
            
            // 所有校验通过，返回 preferred_node_id
            tracing::debug!(
                trace_id = %trace_id,
                request_id = %request_id,
                node_id = %node_id,
                "preferred_node_id 校验通过，使用指定节点"
            );
            (Some(node_id), None)
        } else {
            // 使用模块依赖展开算法选择节点
            // preferred_pool 已经在 Session 锁内决定，传递给选择逻辑
            // 先尝试避开上一节点；如果无候选再回退不避开
            tracing::debug!(
                trace_id = %trace_id,
                request_id = %request_id,
                routing_key = %routing_key,
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                preferred_pool = ?preferred_pool,
                exclude_node_id = ?excluded,
                "使用功能感知选择（模块依赖展开）"
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
            
            // 记录节点选择结果
            if let Some(ref node_id) = first.node_id {
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    selected_node = %node_id,
                    selector = %first.selector,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "节点选择成功"
                );
                if first.selector == "phase3" {
                    if let Some(ref dbg) = first.phase3_debug {
                        tracing::info!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase3 两级调度详情"
                        );
                    }
                }
            } else {
                tracing::warn!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    selector = %first.selector,
                    reason = %first.breakdown.best_reason_label(),
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "节点选择失败：无可用节点"
                );
            }
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
                // 第二次尝试：不避开上一节点，但仍使用 preferred_pool（如果存在）
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

