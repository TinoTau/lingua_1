//! Phase 2 语义修复服务决定模块

use super::super::JobDispatcher;
use crate::messages::PipelineConfig;

impl JobDispatcher {
    /// 决定是否启用语义修复服务
    /// Phase3 模式：所有节点都支持语义修复服务，应该总是启用
    /// 非 Phase3 模式：根据节点端能力决定
    pub(crate) async fn decide_semantic_service_for_phase2(
        &self,
        assigned_node_id: &Option<String>,
        src_lang: &str,
        tgt_lang: &str,
        pipeline: &mut PipelineConfig,
        trace_id: &str,
        request_id: &str,
        session_id: &str,
    ) {
        if let Some(ref node_id) = assigned_node_id {
            // 使用 phase3_config 来判断 Phase3 是否启用，而不是获取快照
            let phase3_config = self.node_registry.get_phase3_config_cached().await;
            let phase3_enabled = phase3_config.enabled && phase3_config.mode == "two_level";
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                node_id = %node_id,
                phase3_enabled = phase3_enabled,
                "Phase2 路径: 使用 phase3_config 判断 Phase3 模式，开始决定语义修复服务"
            );

            if phase3_enabled {
                // Phase3 模式：所有节点都支持语义修复服务，应该总是启用
                pipeline.use_semantic = true;
                tracing::debug!(
                    trace_id = %trace_id,
                    node_id = %node_id,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "Phase3 模式：启用语义修复服务（所有 Phase3 节点都支持）（Phase2）"
                );
            } else {
                // 非 Phase3 模式：根据节点端能力决定（需要获取快照以检查节点能力）
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    node_id = %node_id,
                    "Phase2 路径: 非 Phase3 模式，获取 snapshot 检查节点能力"
                );
                let snapshot_start = std::time::Instant::now();
                let snapshot_manager = self.node_registry.get_or_init_snapshot_manager().await;
                let snapshot = snapshot_manager.get_snapshot().await;
                let snapshot_elapsed = snapshot_start.elapsed();
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    node_id = %node_id,
                    elapsed_ms = snapshot_elapsed.as_millis(),
                    "Phase2 路径: snapshot 获取完成，检查节点语义修复服务支持"
                );

                if let Some(node) = snapshot.nodes.get(node_id) {
                    // 检查节点是否支持语义修复服务，且支持当前语言对
                    let semantic_supported = !node.capabilities.semantic_languages.is_empty();
                    if semantic_supported {
                        // 检查是否支持当前语言对（src_lang 和 tgt_lang）
                        let semantic_langs_set: std::collections::HashSet<&str> = node
                            .capabilities
                            .semantic_languages
                            .iter()
                            .map(|s| s.as_str())
                            .collect();
                        if semantic_langs_set.contains(src_lang)
                            && semantic_langs_set.contains(tgt_lang)
                        {
                            pipeline.use_semantic = true;
                            tracing::debug!(
                                trace_id = %trace_id,
                                node_id = %node_id,
                                src_lang = %src_lang,
                                tgt_lang = %tgt_lang,
                                "非 Phase3 模式：根据节点端能力，启用语义修复服务（Phase2）"
                            );
                        } else {
                            pipeline.use_semantic = false;
                            tracing::debug!(
                                trace_id = %trace_id,
                                node_id = %node_id,
                                src_lang = %src_lang,
                                tgt_lang = %tgt_lang,
                                "非 Phase3 模式：节点不支持当前语言对的语义修复服务，禁用语义修复服务（Phase2）"
                            );
                        }
                    } else {
                        pipeline.use_semantic = false;
                        tracing::debug!(
                            trace_id = %trace_id,
                            node_id = %node_id,
                            "非 Phase3 模式：节点不支持语义修复服务，禁用语义修复服务（Phase2）"
                        );
                    }
                } else {
                    // 节点不在快照中，保守处理：不使用语义修复服务
                    pipeline.use_semantic = false;
                }
            }
        } else {
            // 没有选中节点，保守处理：不使用语义修复服务
            pipeline.use_semantic = false;
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                "Phase2 路径: 未选择节点，禁用语义修复服务"
            );
        }

        tracing::info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            assigned_node_id = ?assigned_node_id,
            use_semantic = pipeline.use_semantic,
            "Phase2 路径: 语义修复服务决定完成"
        );
    }
}
