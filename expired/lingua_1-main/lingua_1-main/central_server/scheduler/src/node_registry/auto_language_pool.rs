//! 自动生成语言集合 Pool
//! 
//! 根据节点的语言能力自动生成：
//! - 基于语义修复服务支持的语言集合生成 Pool
//! - Pool 命名规则：排序后的语言集合，用 `-` 连接（如 `en-zh`, `de-en-zh`）
//! - 一个节点只属于一个 Pool（基于其语言集合）

use super::NodeRegistry;
use crate::core::config::{AutoLanguagePoolConfig, Phase3PoolConfig, PoolLanguageRequirements, PoolNmtRequirements};
use crate::messages::ServiceType;
use std::collections::{HashMap, HashSet};
use tracing::{debug, info, warn};

impl NodeRegistry {
    /// 自动生成语言集合 Pool
    /// 根据节点的语义修复服务支持的语言集合生成 Pool
    pub async fn auto_generate_language_pair_pools(&self) -> Vec<Phase3PoolConfig> {
        info!("开始自动生成语言集合 Pool");
        
        let cfg = self.phase3.read().await.clone();
        let auto_cfg = match &cfg.auto_pool_config {
            Some(c) => {
                info!(
                    min_nodes_per_pool = c.min_nodes_per_pool,
                    max_pools = c.max_pools,
                    require_semantic = c.require_semantic,
                    "使用配置的自动 Pool 生成参数"
                );
                c.clone()
            }
            None => {
                warn!("auto_pool_config 未配置，使用默认值");
                AutoLanguagePoolConfig::default()
            }
        };

        // 1. 收集所有节点的语言集合（基于 semantic_langs）
        let language_sets = self.collect_language_sets(&auto_cfg).await;
        
        if language_sets.is_empty() {
            info!("未找到任何语言集合，跳过 Pool 生成");
            return vec![];
        }
        
        info!(
            total_sets = language_sets.len(),
            "收集到 {} 个语言集合",
            language_sets.len()
        );

        // 2. 统计每个语言集合的节点数
        let mut set_counts: HashMap<Vec<String>, usize> = HashMap::new();
        for lang_set in &language_sets {
            let count = self.count_nodes_with_language_set(lang_set, &auto_cfg).await;
            set_counts.insert(lang_set.clone(), count);
        }

        // 3. 过滤：只保留节点数 >= min_nodes_per_pool 的语言集合
        let total_sets_before_filter = set_counts.len();
        let mut valid_sets: Vec<(Vec<String>, usize)> = set_counts
            .into_iter()
            .filter(|(_, count)| *count >= auto_cfg.min_nodes_per_pool)
            .collect();
        
        let filtered_out = total_sets_before_filter - valid_sets.len();
        if filtered_out > 0 {
            debug!(
                filtered_out = filtered_out,
                min_nodes_per_pool = auto_cfg.min_nodes_per_pool,
                "过滤掉 {} 个节点数不足的语言集合",
                filtered_out
            );
        }

        // 4. 按节点数降序排序（优先创建节点数多的 Pool）
        valid_sets.sort_by(|a, b| b.1.cmp(&a.1));
        
        debug!(
            valid_sets = valid_sets.len(),
            "过滤后剩余 {} 个有效语言集合",
            valid_sets.len()
        );

        // 5. 限制：最多 max_pools 个 Pool
        if valid_sets.len() > auto_cfg.max_pools {
            valid_sets.truncate(auto_cfg.max_pools);
            warn!(
                "语言集合数量 ({}) 超过 max_pools ({})，只创建前 {} 个 Pool",
                valid_sets.len() + filtered_out,
                auto_cfg.max_pools,
                auto_cfg.max_pools
            );
        }

        // 6. 生成 Pool 配置
        let mut pools = Vec::new();
        let mut pool_id = 1;

        for (lang_set, _node_count) in valid_sets {
            // 排序语言集合（用于 Pool 命名）
            let mut sorted_langs = lang_set.clone();
            sorted_langs.sort();
            let pool_name = sorted_langs.join("-");
            
            pools.push(Phase3PoolConfig {
                pool_id,
                name: pool_name.clone(),
                required_services: self.get_required_services(&auto_cfg),
                language_requirements: Some(PoolLanguageRequirements {
                    // ASR 和 TTS 语言不限制（由节点端决定）
                    asr_languages: None,
                    tts_languages: None,
                    // NMT 能力：支持语言集合内的任意语言对
                    nmt_requirements: Some(PoolNmtRequirements {
                        languages: sorted_langs.clone(),
                        rule: "any_to_any".to_string(),
                        supported_pairs: None, // 不限制具体语言对，由节点端决定
                        blocked_pairs: None,
                    }),
                    // 语义修复语言：Pool 的语言集合
                    semantic_languages: Some(sorted_langs.clone()),
                }),
            });

            debug!(
                pool_id = pool_id,
                pool_name = %pool_name,
                languages = ?sorted_langs,
                "生成语言集合 Pool: {}",
                pool_name
            );
            pool_id += 1;
        }

        info!(
            total_pools = pools.len(),
            "Pool 生成完成，共 {} 个语言集合 Pool",
            pools.len()
        );

        pools
    }

    /// 收集所有节点的语言集合（基于 semantic_langs）
    async fn collect_language_sets(&self, auto_cfg: &AutoLanguagePoolConfig) -> Vec<Vec<String>> {
        // 使用 ManagementRegistry（统一管理锁）
        let node_clones: Vec<super::Node> = {
            let mgmt = self.management_registry.read().await;
            mgmt.nodes.values().map(|state| state.node.clone()).collect()
        };
        let language_index = self.language_capability_index.read().await;
        let mut language_sets = HashSet::new();
        let mut nodes_checked = 0;
        let mut nodes_with_services = 0;
        let mut nodes_with_sets = 0;

        for node in &node_clones {
            nodes_checked += 1;
            
            // 检查节点是否具备所有必需服务
            if !self.node_has_all_required_services(node, auto_cfg) {
                debug!(
                    node_id = %node.node_id,
                    "节点缺少必需服务，跳过"
                );
                continue;
            }
            
            nodes_with_services += 1;

            // 获取节点的语义修复服务支持的语言集合
            let semantic_langs: HashSet<String> = if let Some(ref caps) = node.language_capabilities {
                caps.semantic_languages.as_ref()
                    .map(|v| v.iter().cloned().collect())
                    .unwrap_or_default()
            } else {
                // 向后兼容：从 language_index 获取
                language_index.get_node_semantic_languages(&node.node_id)
            };

            if !semantic_langs.is_empty() {
                nodes_with_sets += 1;
                // 排序语言集合（用于去重和命名）
                let mut sorted_langs: Vec<String> = semantic_langs.into_iter().collect();
                sorted_langs.sort();
                language_sets.insert(sorted_langs);
            }
        }
        
        debug!(
            nodes_checked = nodes_checked,
            nodes_with_services = nodes_with_services,
            nodes_with_sets = nodes_with_sets,
            total_sets = language_sets.len(),
            "语言集合收集完成：检查了 {} 个节点，{} 个具备必需服务，{} 个有语言集合",
            nodes_checked, nodes_with_services, nodes_with_sets
        );

        language_sets.into_iter().collect()
    }

    /// 统计支持指定语言集合的节点数
    async fn count_nodes_with_language_set(
        &self,
        lang_set: &[String],
        auto_cfg: &AutoLanguagePoolConfig,
    ) -> usize {
        // 使用 ManagementRegistry（统一管理锁）
        let node_clones: Vec<super::Node> = {
            let mgmt = self.management_registry.read().await;
            mgmt.nodes.values().map(|state| state.node.clone()).collect()
        };
        let language_index = self.language_capability_index.read().await;
        let lang_set_set: HashSet<String> = lang_set.iter().cloned().collect();
        let mut count = 0;

        for node in &node_clones {
            // 检查节点是否具备所有必需服务
            if !self.node_has_all_required_services(node, auto_cfg) {
                continue;
            }

            // 获取节点的语义修复服务支持的语言集合
            let semantic_langs: HashSet<String> = if let Some(ref caps) = node.language_capabilities {
                caps.semantic_languages.as_ref()
                    .map(|v| v.iter().cloned().collect())
                    .unwrap_or_default()
            } else {
                // 向后兼容：从 language_index 获取
                language_index.get_node_semantic_languages(&node.node_id)
            };

            // 检查节点的语言集合是否完全匹配（必须完全一致）
            if semantic_langs == lang_set_set {
                count += 1;
            }
        }

        count
    }

    // 已删除未使用的函数：
    // - generate_precise_pools: 生成精确池（一对一语言对 Pool），已废弃，未被使用
    // - generate_mixed_pools: 生成混合池（多对一 Pool），已废弃，未被使用
    // 这些函数已被 auto_generate_language_pair_pools 替代

    // 已删除未使用的函数：collect_language_pairs
    // 此函数只在已删除的 generate_precise_pools 中使用

    /// 检查节点是否具备所有必需服务
    /// 注意：节点能力信息已迁移到 Redis，这里暂时使用 installed_services 作为替代
    /// TODO: 重构以支持从 Redis 读取节点能力
    fn node_has_all_required_services(&self, node: &super::Node, auto_cfg: &AutoLanguagePoolConfig) -> bool {
        let required_types = self.get_required_service_types(auto_cfg);
        
        // 使用 installed_services 检查（服务已安装且状态为 Running）
        let has_all = required_types.iter().all(|t| {
            node.installed_services
                .iter()
                .any(|s| s.r#type == *t && s.status == crate::messages::ServiceStatus::Running)
        });
        
        if !has_all {
            let missing: Vec<String> = required_types
                .iter()
                .filter(|t| {
                    !node.installed_services
                        .iter()
                        .any(|s| s.r#type == **t && s.status == crate::messages::ServiceStatus::Running)
                })
                .map(|t| format!("{:?}", t))
                .collect();
            debug!(
                node_id = %node.node_id,
                missing_services = ?missing,
                "节点缺少必需服务（使用 installed_services 检查）"
            );
        }
        
        has_all
    }

    // 已删除未使用的函数：get_node_language_pairs
    // 此函数只在已删除的 collect_language_pairs 中使用

    /// 获取必需的服务类型列表
    fn get_required_service_types(&self, auto_cfg: &AutoLanguagePoolConfig) -> Vec<ServiceType> {
        let mut types = vec![
            ServiceType::Asr,
            ServiceType::Nmt,
            ServiceType::Tts,
        ];
        if auto_cfg.require_semantic {
            types.push(ServiceType::Semantic);
        }
        types
    }

    /// 获取必需的服务名称列表（用于 Pool 配置）
    fn get_required_services(&self, auto_cfg: &AutoLanguagePoolConfig) -> Vec<String> {
        let mut services = vec![
            "asr".to_string(),
            "nmt".to_string(),
            "tts".to_string(),
        ];
        if auto_cfg.require_semantic {
            services.push("semantic".to_string());
        }
        services
    }
}

impl Default for AutoLanguagePoolConfig {
    fn default() -> Self {
        Self {
            min_nodes_per_pool: 1, // 允许单个节点创建 Pool
            max_pools: 50,
            pool_naming: "pair".to_string(),
            require_semantic: true,
            enable_mixed_pools: true, // 默认启用混合池
        }
    }
}
