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
    /// 根据 v3.1 设计，preferred_pool 应该在 Session 锁内决定，这里接受 preferred_pool 参数
    pub(crate) async fn select_node_with_module_expansion_with_breakdown(
        &self,
        routing_key: &str,
        src_lang: &str,
        tgt_lang: &str,
        features: Option<FeatureFlags>,
        pipeline: &PipelineConfig,
        accept_public: bool,
        exclude_node_id: Option<&str>,
        preferred_pool: Option<u16>, // Session 锁内决定的 preferred_pool（可选，向后兼容）
    ) -> SelectionOutcome {
        tracing::info!(
            routing_key = %routing_key,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            preferred_pool = ?preferred_pool,
            exclude_node_id = ?exclude_node_id,
            "select_node_with_module_expansion_with_breakdown: 开始节点选择（job_selection.rs）"
        );
        
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

        // 步骤 3: 收集 required_types（基础服务：ASR/NMT/TTS）
        // 注意：语义修复服务是可选服务，应该根据节点端能力来决定，而不是由调度服务器配置决定
        // 策略：先尝试包含语义修复服务（优先选择支持语义修复服务的节点），如果找不到再回退
        tracing::info!(
            routing_key = %routing_key,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            "select_node_with_module_expansion_with_breakdown: 开始获取 required_types（job_selection.rs）"
        );
        let required_types =
            match self.get_required_types_for_features(pipeline, features.as_ref(), src_lang, tgt_lang)
            {
            Ok(mut types) => {
                // 移除语义修复服务（如果有），因为它应该根据节点能力来决定
                types.retain(|t| *t != crate::messages::ServiceType::Semantic);
                tracing::info!(
                    routing_key = %routing_key,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    required_types = ?types,
                    "select_node_with_module_expansion_with_breakdown: required_types 获取完成（job_selection.rs）"
                );
                types
            },
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
        // 【修复1】优化：使用 phase3_config.enabled 来判断 Phase3 是否启用，避免获取快照（减少锁竞争）
        // 注意：phase3_config 是缓存读取，无锁，性能更好
        tracing::info!(
            routing_key = %routing_key,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            "节点选择: 开始获取 Phase3 配置缓存（job_selection.rs）"
        );
        let phase3_config = self.node_registry.get_phase3_config_cached().await;
        let phase3_enabled = phase3_config.enabled && phase3_config.mode == "two_level";
        tracing::info!(
            routing_key = %routing_key,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            phase3_enabled = phase3_enabled,
            phase3_mode = %phase3_config.mode,
            pool_count = phase3_config.pools.len(),
            "节点选择: Phase3 配置缓存获取完成（job_selection.rs）"
        );
        
        // 重要：Phase3 Pool 是基于语义修复服务支持建立的，所有 Phase3 节点都支持语义修复服务
        // 因此在 Phase3 模式下，应该总是要求语义修复服务；非 Phase3 模式下，不要求语义修复服务
        if phase3_enabled {
            // Phase3 模式：总是包含语义修复服务（因为所有 Phase3 节点都支持语义修复服务）
            let mut types_with_semantic = required_types.clone();
            types_with_semantic.push(crate::messages::ServiceType::Semantic);
            types_with_semantic.sort();
            types_with_semantic.dedup();
            
            tracing::info!(
                routing_key = %routing_key,
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                preferred_pool = ?preferred_pool,
                "节点选择: Phase3 模式，开始调用 select_node_with_types_two_level_excluding_with_breakdown（job_selection.rs）"
            );
            let two_level_start = std::time::Instant::now();
            let (node_id, dbg, breakdown) = self
                .node_registry
                .select_node_with_types_two_level_excluding_with_breakdown(
                    routing_key,
                    src_lang,
                    tgt_lang,
                    &types_with_semantic,
                    accept_public,
                    exclude_node_id,
                    Some(&self.core_services),
                    self.phase2.as_ref().map(|rt| rt.as_ref()),
                    preferred_pool, // 传递 Session 锁内决定的 preferred_pool
                )
                .await;
            let two_level_elapsed = two_level_start.elapsed();
            tracing::info!(
                routing_key = %routing_key,
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                node_id = ?node_id,
                elapsed_ms = two_level_elapsed.as_millis(),
                "节点选择: select_node_with_types_two_level_excluding_with_breakdown 完成（job_selection.rs）"
            );
            
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
            // 非 Phase3 模式：不要求语义修复服务（根据节点端能力决定是否使用）
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
        if pipeline.use_semantic {
            types.push(crate::messages::ServiceType::Semantic);
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

