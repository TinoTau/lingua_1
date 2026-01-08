use super::JobDispatcher;
use super::selection_outcome::SelectionOutcome;
use crate::messages::{FeatureFlags, PipelineConfig};
use crate::utils::ModuleResolver;

impl JobDispatcher {
    /// 使用模块依赖展开算法选择节点
    /// 
    /// 按照 v2 技术说明书的步骤：
    /// 1. 解析用户请求 features
    /// 2. 递归展开依赖链
    /// 3. 收集 required_types (ServiceType)
    /// 4. 过滤 capability_by_type ready 的节点
    /// 5. 负载均衡选节点
    pub(crate) async fn select_node_with_module_expansion_with_breakdown(
        &self,
        routing_key: &str,
        src_lang: &str,
        tgt_lang: &str,
        features: Option<FeatureFlags>,
        pipeline: &PipelineConfig,
        accept_public: bool,
        exclude_node_id: Option<&str>,
    ) -> SelectionOutcome {
        // 步骤 1: 解析用户请求 features
        let module_names = if let Some(ref features) = features {
            ModuleResolver::parse_features_to_modules(features)
        } else {
            // 如果没有 features，只使用核心模块
            vec!["asr".to_string(), "nmt".to_string(), "tts".to_string()]
        };

        // 步骤 2: 递归展开依赖链
        let _expanded_modules = match ModuleResolver::expand_dependencies(&module_names) {
            Ok(modules) => modules,
            Err(e) => {
                tracing::warn!("Failed to expand module dependencies: {}", e);
                // 回退到原来的方法
                let (node_id, breakdown) = self
                    .node_registry
                    .select_node_with_features_excluding_with_breakdown(
                        src_lang,
                        tgt_lang,
                        &features,
                        accept_public,
                        exclude_node_id,
                    )
                    .await;
                return SelectionOutcome {
                    node_id,
                    selector: "features",
                    breakdown,
                    phase3_debug: None,
                };
            }
        };

        // 步骤 3: 收集 required_types
        let required_types =
            match self.get_required_types_for_features(pipeline, features.as_ref(), src_lang, tgt_lang)
            {
            Ok(types) => types,
            Err(e) => {
                tracing::warn!("Failed to collect required models: {}", e);
                // 回退到原来的方法
                let (node_id, breakdown) = self
                    .node_registry
                    .select_node_with_features_excluding_with_breakdown(
                        src_lang,
                        tgt_lang,
                        &features,
                        accept_public,
                        exclude_node_id,
                    )
                    .await;
                return SelectionOutcome {
                    node_id,
                    selector: "features",
                    breakdown,
                    phase3_debug: None,
                };
            }
        };

        // 步骤 4 & 5: 过滤 type ready 的节点，并负载均衡
        let p3 = self.node_registry.phase3_config().await;
        if p3.enabled && p3.mode == "two_level" {
            let (node_id, dbg, breakdown) = self
                .node_registry
                .select_node_with_types_two_level_excluding_with_breakdown(
                    routing_key,
                    src_lang,
                    tgt_lang,
                    &required_types,
                    accept_public,
                    exclude_node_id,
                    Some(&self.core_services),
                    self.phase2.as_ref().map(|rt| rt.as_ref()),
                )
                .await;
            // Prometheus：记录 pool 命中/回退
            if let Some(pid) = dbg.selected_pool {
                crate::metrics::prometheus_metrics::on_phase3_pool_selected(pid, true, dbg.fallback_used);
            } else {
                crate::metrics::prometheus_metrics::on_phase3_pool_selected(dbg.preferred_pool, false, false);
            }
            SelectionOutcome {
                node_id,
                selector: "phase3_type",
                breakdown,
                phase3_debug: Some(dbg),
            }
        } else {
            let (node_id, breakdown) = self
                .node_registry
                .select_node_with_types_excluding_with_breakdown(
                    src_lang,
                    tgt_lang,
                    &required_types,
                    accept_public,
                    exclude_node_id,
                )
                .await;
            SelectionOutcome {
                node_id,
                selector: "types",
                breakdown,
                phase3_debug: None,
            }
        }
    }

    /// 获取功能所需的类型列表
    pub(crate) fn get_required_types_for_features(
        &self,
        pipeline: &PipelineConfig,
        features: Option<&FeatureFlags>,
        _src_lang: &str,
        _tgt_lang: &str,
    ) -> anyhow::Result<Vec<crate::messages::ServiceType>> {
        let mut types = Vec::new();

        if pipeline.use_asr {
            types.push(crate::messages::ServiceType::Asr);
        }
        if pipeline.use_nmt {
            types.push(crate::messages::ServiceType::Nmt);
        }
        if pipeline.use_tts {
            types.push(crate::messages::ServiceType::Tts);
        }

        // 可选模块映射到类型（当前仅 tone 可选）
        if let Some(features) = features {
            let module_names = ModuleResolver::parse_features_to_modules(features);
            let optional_models = ModuleResolver::collect_required_models(&module_names)?;
            // tone: 若模块包含 tone（例如 voice_cloning 相关）则加入
            if optional_models.iter().any(|m| m.contains("tone") || m.contains("speaker") || m.contains("voice")) {
                types.push(crate::messages::ServiceType::Tone);
            }
        }

        types.sort();
        types.dedup();

        Ok(types)
    }
}

