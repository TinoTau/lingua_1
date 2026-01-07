//! 自动生成语言对 Pool（混合架构）
//! 
//! 根据节点的语言能力自动生成：
//! - 精确池（一对一语言对 Pool）：用于已知源语言和目标语言的场景
//! - 混合池（多对一 Pool）：用于 src_lang = "auto" 场景，支持 ASR 多语言自动识别

use super::NodeRegistry;
use crate::core::config::{AutoLanguagePoolConfig, Phase3PoolConfig, PoolLanguageRequirements, PoolNmtRequirements};
use crate::messages::ServiceType;
use std::collections::{HashMap, HashSet};
use tracing::{debug, info, warn};

impl NodeRegistry {
    /// 自动生成语言对 Pool（混合架构：精确池 + 混合池）
    pub async fn auto_generate_language_pair_pools(&self) -> Vec<Phase3PoolConfig> {
        info!("开始自动生成语言对 Pool（混合架构）");
        
        let cfg = self.phase3.read().await.clone();
        let auto_cfg = match &cfg.auto_pool_config {
            Some(c) => {
                info!(
                    min_nodes_per_pool = c.min_nodes_per_pool,
                    max_pools = c.max_pools,
                    require_semantic = c.require_semantic,
                    enable_mixed_pools = c.enable_mixed_pools,
                    "使用配置的自动 Pool 生成参数"
                );
                c.clone()
            }
            None => {
                warn!("auto_pool_config 未配置，使用默认值");
                AutoLanguagePoolConfig::default()
            }
        };

        let mut pools = Vec::new();
        let mut pool_id = 1;

        // 1. 生成精确池（一对一语言对 Pool）
        info!("开始生成精确池（一对一语言对）");
        let precise_pools = self.generate_precise_pools(&auto_cfg, &mut pool_id).await;
        pools.extend(precise_pools);
        
        info!(
            precise_pool_count = pools.len(),
            "精确池生成完成，共 {} 个",
            pools.len()
        );

        // 2. 生成混合池（多对一 Pool，用于 src_lang = "auto" 场景）
        if auto_cfg.enable_mixed_pools {
            info!("开始生成混合池（多对一，支持自动语言识别）");
            let mixed_pools = self.generate_mixed_pools(&auto_cfg, &mut pool_id).await;
            let mixed_count = mixed_pools.len();
            pools.extend(mixed_pools);
            
            info!(
                total_pools = pools.len(),
                precise_pools = pools.len() - mixed_count,
                mixed_pools = mixed_count,
                "混合池生成完成，总计 {} 个 Pool（精确池: {}，混合池: {}）",
                pools.len(),
                pools.len() - mixed_count,
                mixed_count
            );
        } else {
            info!(
                total_pools = pools.len(),
                "Pool 生成完成，共 {} 个精确池（混合池已禁用）",
                pools.len()
            );
        }

        pools
    }

    /// 生成精确池（一对一语言对 Pool）
    /// 用于已知源语言和目标语言的场景（面对面模式，用户选定了语言）
    async fn generate_precise_pools(
        &self,
        auto_cfg: &AutoLanguagePoolConfig,
        pool_id: &mut u16,
    ) -> Vec<Phase3PoolConfig> {
        // 1. 收集所有节点的语言对
        debug!("开始收集节点的语言对");
        let language_pairs = self.collect_language_pairs(auto_cfg).await;
        
        if language_pairs.is_empty() {
            info!("未找到任何语言对，跳过精确池生成");
            return vec![];
        }
        
        info!(
            total_pairs = language_pairs.len(),
            "收集到 {} 个语言对",
            language_pairs.len()
        );

        // 2. 统计每个语言对的节点数
        let mut pair_counts: HashMap<(String, String), usize> = HashMap::new();
        for (src, tgt) in &language_pairs {
            *pair_counts.entry((src.clone(), tgt.clone())).or_insert(0) += 1;
        }

        // 3. 过滤：只保留节点数 >= min_nodes_per_pool 的语言对
        let total_pairs_before_filter = pair_counts.len();
        let mut valid_pairs: Vec<((String, String), usize)> = pair_counts
            .into_iter()
            .filter(|(_, count)| *count >= auto_cfg.min_nodes_per_pool)
            .collect();
        
        let filtered_out = total_pairs_before_filter - valid_pairs.len();
        if filtered_out > 0 {
            debug!(
                filtered_out = filtered_out,
                min_nodes_per_pool = auto_cfg.min_nodes_per_pool,
                "过滤掉 {} 个节点数不足的语言对",
                filtered_out
            );
        }

        // 4. 按节点数降序排序（优先创建节点数多的 Pool）
        valid_pairs.sort_by(|a, b| b.1.cmp(&a.1));
        
        debug!(
            valid_pairs = valid_pairs.len(),
            "过滤后剩余 {} 个有效语言对",
            valid_pairs.len()
        );

        // 5. 限制：最多 max_pools 个精确池
        if valid_pairs.len() > auto_cfg.max_pools {
            valid_pairs.truncate(auto_cfg.max_pools);
            warn!(
                "语言对数量 ({}) 超过 max_pools ({})，只创建前 {} 个精确池",
                valid_pairs.len() + filtered_out,
                auto_cfg.max_pools,
                auto_cfg.max_pools
            );
        }

        // 6. 生成精确池配置
        let mut pools = Vec::new();

        for ((src, tgt), _node_count) in valid_pairs {
            let pool_name = format!("{}-{}", src, tgt);
            
            pools.push(Phase3PoolConfig {
                pool_id: *pool_id,
                name: pool_name.clone(),
                required_services: self.get_required_services(auto_cfg),
                language_requirements: Some(PoolLanguageRequirements {
                    asr_languages: Some(vec![src.clone()]),
                    tts_languages: Some(vec![tgt.clone()]),
                    nmt_requirements: Some(PoolNmtRequirements {
                        languages: vec![src.clone(), tgt.clone()],
                        rule: "specific_pairs".to_string(),
                        supported_pairs: Some(vec![crate::messages::common::LanguagePair {
                            src: src.clone(),
                            tgt: tgt.clone(),
                        }]),
                        blocked_pairs: None,
                    }),
                    semantic_languages: None, // 语义修复语言由节点端决定
                }),
            });

            debug!(
                pool_id = *pool_id,
                pool_name = %pool_name,
                src_lang = %src,
                tgt_lang = %tgt,
                "生成精确池: {} ({} -> {})",
                pool_name, src, tgt
            );
            *pool_id += 1;
        }

        pools
    }

    /// 生成混合池（多对一 Pool）
    /// 用于 src_lang = "auto" 场景，支持 ASR 多语言自动识别
    async fn generate_mixed_pools(
        &self,
        auto_cfg: &AutoLanguagePoolConfig,
        pool_id: &mut u16,
    ) -> Vec<Phase3PoolConfig> {
        let nodes = self.nodes.read().await;
        let language_index = self.language_capability_index.read().await;
        
        // 1. 收集所有支持的目标语言
        let mut target_languages: HashSet<String> = HashSet::new();
        let mut nodes_by_target: HashMap<String, HashSet<String>> = HashMap::new(); // tgt_lang -> node_ids
        
        for node in nodes.values() {
            // 检查节点是否具备所有必需服务
            if !self.node_has_all_required_services(node, auto_cfg) {
                continue;
            }
            
            // 获取节点的语言对
            let node_pairs = self.get_node_language_pairs(node, &language_index);
            
            // 统计每个目标语言的节点
            for (_src, tgt) in node_pairs {
                target_languages.insert(tgt.clone());
                nodes_by_target
                    .entry(tgt.clone())
                    .or_insert_with(HashSet::new)
                    .insert(node.node_id.clone());
            }
        }
        
        if target_languages.is_empty() {
            info!("未找到任何目标语言，跳过混合池生成");
            return vec![];
        }
        
        info!(
            target_languages = target_languages.len(),
            "收集到 {} 个目标语言",
            target_languages.len()
        );

        // 2. 过滤：只保留节点数 >= min_nodes_per_pool 的目标语言
        let mut valid_targets: Vec<(String, usize)> = nodes_by_target
            .into_iter()
            .filter(|(_, node_ids)| node_ids.len() >= auto_cfg.min_nodes_per_pool)
            .map(|(tgt, node_ids)| (tgt, node_ids.len()))
            .collect();
        
        // 3. 按节点数降序排序
        valid_targets.sort_by(|a, b| b.1.cmp(&a.1));
        
        info!(
            valid_targets = valid_targets.len(),
            "过滤后剩余 {} 个有效目标语言",
            valid_targets.len()
        );

        // 4. 生成混合池配置
        let mut pools = Vec::new();

        for (tgt, node_count) in valid_targets {
            // 混合池命名：*-{tgt_lang}（如 *-en）
            let pool_name = format!("*-{}", tgt);
            
            // 收集所有支持该目标语言的源语言（用于 NMT 能力描述）
            let mut source_languages: HashSet<String> = HashSet::new();
            for node in nodes.values() {
                if !self.node_has_all_required_services(node, auto_cfg) {
                    continue;
                }
                let node_pairs = self.get_node_language_pairs(node, &language_index);
                for (src, tgt_lang) in node_pairs {
                    if tgt_lang == tgt {
                        source_languages.insert(src);
                    }
                }
            }
            
            let source_langs_vec: Vec<String> = source_languages.into_iter().collect();
            
            pools.push(Phase3PoolConfig {
                pool_id: *pool_id,
                name: pool_name.clone(),
                required_services: self.get_required_services(auto_cfg),
                language_requirements: Some(PoolLanguageRequirements {
                    // ASR 语言：不限制（支持多语言自动识别）
                    asr_languages: None,
                    // TTS 语言：限制为目标语言
                    tts_languages: Some(vec![tgt.clone()]),
                    // NMT 能力：支持所有源语言到目标语言的翻译
                    nmt_requirements: Some(PoolNmtRequirements {
                        languages: {
                            let mut langs = source_langs_vec.clone();
                            langs.push(tgt.clone());
                            langs.sort();
                            langs.dedup();
                            langs
                        },
                        rule: "any_to_any".to_string(), // 混合池使用 any_to_any，由节点端验证具体语言对
                        supported_pairs: None, // 不限制具体语言对，由节点端决定
                        blocked_pairs: None,
                    }),
                    semantic_languages: None, // 语义修复语言由节点端决定
                }),
            });

            info!(
                pool_id = *pool_id,
                pool_name = %pool_name,
                tgt_lang = %tgt,
                node_count = node_count,
                source_lang_count = source_langs_vec.len(),
                "生成混合池: {} (支持 {} 种源语言 -> {})",
                pool_name, source_langs_vec.len(), tgt
            );
            *pool_id += 1;
        }

        pools
    }

    /// 收集所有节点的语言对
    async fn collect_language_pairs(&self, auto_cfg: &AutoLanguagePoolConfig) -> Vec<(String, String)> {
        let nodes = self.nodes.read().await;
        let language_index = self.language_capability_index.read().await;
        let mut pairs = HashSet::new();
        let mut nodes_checked = 0;
        let mut nodes_with_services = 0;
        let mut nodes_with_pairs = 0;

        for node in nodes.values() {
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

            // 获取节点的语言对
            let node_pairs = self.get_node_language_pairs(node, &language_index);
            if !node_pairs.is_empty() {
                nodes_with_pairs += 1;
                debug!(
                    node_id = %node.node_id,
                    pair_count = node_pairs.len(),
                    "节点支持 {} 个语言对",
                    node_pairs.len()
                );
            }
            pairs.extend(node_pairs);
        }
        
        debug!(
            nodes_checked = nodes_checked,
            nodes_with_services = nodes_with_services,
            nodes_with_pairs = nodes_with_pairs,
            total_pairs = pairs.len(),
            "语言对收集完成：检查了 {} 个节点，{} 个具备必需服务，{} 个有语言对",
            nodes_checked, nodes_with_services, nodes_with_pairs
        );

        pairs.into_iter().collect()
    }

    /// 检查节点是否具备所有必需服务
    fn node_has_all_required_services(&self, node: &super::Node, auto_cfg: &AutoLanguagePoolConfig) -> bool {
        let required_types = self.get_required_service_types(auto_cfg);
        
        let has_all = required_types.iter().all(|t| {
            node.capability_by_type
                .iter()
                .find(|c| c.r#type == *t)
                .map(|c| c.ready)
                .unwrap_or(false)
        });
        
        if !has_all {
            let missing: Vec<String> = required_types
                .iter()
                .filter(|t| {
                    !node.capability_by_type
                        .iter()
                        .find(|c| c.r#type == **t)
                        .map(|c| c.ready)
                        .unwrap_or(false)
                })
                .map(|t| format!("{:?}", t))
                .collect();
            debug!(
                node_id = %node.node_id,
                missing_services = ?missing,
                "节点缺少必需服务"
            );
        }
        
        has_all
    }

    /// 获取节点的语言对列表
    /// 优先使用节点端计算的 supported_language_pairs，如果没有则回退到计算模式（向后兼容）
    fn get_node_language_pairs(
        &self,
        node: &super::Node,
        language_index: &super::language_capability_index::LanguageCapabilityIndex,
    ) -> Vec<(String, String)> {
        // 优先级1：使用节点端计算的 supported_language_pairs
        if let Some(ref caps) = node.language_capabilities {
            if let Some(ref pairs) = caps.supported_language_pairs {
                debug!(
                    node_id = %node.node_id,
                    pair_count = pairs.len(),
                    "使用节点端计算的语言对列表"
                );
                return pairs.iter().map(|p| (p.src.clone(), p.tgt.clone())).collect();
            }
        }

        // 优先级2：向后兼容模式，调度服务器计算（已废弃，但保留用于兼容旧节点）
        debug!(
            node_id = %node.node_id,
            "节点未提供 supported_language_pairs，使用向后兼容模式计算"
        );
        
        let mut pairs = Vec::new();

        // 获取节点的 ASR、TTS、NMT 能力
        let asr_langs = language_index.get_node_asr_languages(&node.node_id);
        let tts_langs = language_index.get_node_tts_languages(&node.node_id);
        let semantic_langs = language_index.get_node_semantic_languages(&node.node_id);
        let nmt_capabilities = language_index.get_node_nmt_capabilities(&node.node_id);

        // 如果没有语义修复服务支持的语言，返回空列表（语言可用性以语义修复服务为准）
        if semantic_langs.is_empty() {
            debug!(
                node_id = %node.node_id,
                asr_langs = ?asr_langs,
                tts_langs = ?tts_langs,
                nmt_capabilities_count = nmt_capabilities.len(),
                "节点没有语义修复服务支持的语言，返回空语言对列表（语言可用性以语义修复服务为准）"
            );
            return pairs;
        }
        
        debug!(
            node_id = %node.node_id,
            semantic_languages = ?semantic_langs,
            asr_languages = ?asr_langs,
            tts_languages = ?tts_langs,
            "节点语言能力检查（向后兼容模式）：语义修复服务支持 {} 种语言",
            semantic_langs.len()
        );

        // 遍历 NMT 能力，生成语言对
        for nmt_cap in nmt_capabilities {
            match nmt_cap.rule.as_str() {
                "any_to_any" => {
                    // 任意语言到任意语言：遍历所有 ASR 和 TTS 语言的组合
                    for src in &asr_langs {
                        for tgt in &tts_langs {
                            if src != tgt && nmt_cap.languages.contains(src) && nmt_cap.languages.contains(tgt) {
                                // 检查是否被阻止
                                if !nmt_cap.blocked_pairs.iter().any(|p| p.src == *src && p.tgt == *tgt) {
                                    // 检查源语言和目标语言是否都在语义修复服务支持的语言列表中
                                    if semantic_langs.contains(src) && semantic_langs.contains(tgt) {
                                        pairs.push((src.clone(), tgt.clone()));
                                    } else {
                                        debug!(
                                            node_id = %node.node_id,
                                            src_lang = %src,
                                            tgt_lang = %tgt,
                                            semantic_languages = ?semantic_langs,
                                            "语言对 {}-{} 被过滤：源语言或目标语言不在语义修复服务支持的语言列表中",
                                            src, tgt
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                "any_to_en" => {
                    // 任意语言到英文
                    if !tts_langs.contains("en") || !semantic_langs.contains("en") {
                        continue;
                    }
                    for src in &asr_langs {
                        if src != "en" && nmt_cap.languages.contains(src) && semantic_langs.contains(src) {
                            if !nmt_cap.blocked_pairs.iter().any(|p| p.src == *src && p.tgt == "en") {
                                pairs.push((src.clone(), "en".to_string()));
                            }
                        } else if src != "en" && nmt_cap.languages.contains(src) && !semantic_langs.contains(src) {
                            debug!(
                                node_id = %node.node_id,
                                src_lang = %src,
                                semantic_languages = ?semantic_langs,
                                "语言对 {}-en 被过滤：源语言不在语义修复服务支持的语言列表中",
                                src
                            );
                        }
                    }
                }
                "en_to_any" => {
                    // 英文到任意语言
                    if !asr_langs.contains("en") || !semantic_langs.contains("en") {
                        continue;
                    }
                    for tgt in &tts_langs {
                        if tgt != "en" && nmt_cap.languages.contains(tgt) && semantic_langs.contains(tgt) {
                            if !nmt_cap.blocked_pairs.iter().any(|p| p.src == "en" && p.tgt == *tgt) {
                                pairs.push(("en".to_string(), tgt.clone()));
                            }
                        } else if tgt != "en" && nmt_cap.languages.contains(tgt) && !semantic_langs.contains(tgt) {
                            debug!(
                                node_id = %node.node_id,
                                tgt_lang = %tgt,
                                semantic_languages = ?semantic_langs,
                                "语言对 en-{} 被过滤：目标语言不在语义修复服务支持的语言列表中",
                                tgt
                            );
                        }
                    }
                }
                "specific_pairs" => {
                    // 明确支持的语言对
                    if let Some(sp) = &nmt_cap.supported_pairs {
                        for pair in sp {
                            if asr_langs.contains(&pair.src) && tts_langs.contains(&pair.tgt) {
                                // 检查源语言和目标语言是否都在语义修复服务支持的语言列表中
                                if semantic_langs.contains(&pair.src) && semantic_langs.contains(&pair.tgt) {
                                    pairs.push((pair.src.clone(), pair.tgt.clone()));
                                } else {
                                    debug!(
                                        node_id = %node.node_id,
                                        src_lang = %pair.src,
                                        tgt_lang = %pair.tgt,
                                        semantic_languages = ?semantic_langs,
                                        "语言对 {}-{} 被过滤：源语言或目标语言不在语义修复服务支持的语言列表中",
                                        pair.src, pair.tgt
                                    );
                                }
                            }
                        }
                    }
                }
                _ => {
                    warn!("未知的 NMT 规则: {}", nmt_cap.rule);
                }
            }
        }

        pairs
    }

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
