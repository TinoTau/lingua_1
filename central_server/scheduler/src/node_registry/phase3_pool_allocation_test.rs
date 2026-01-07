//! Phase 3 Pool 节点分配逻辑测试

#[cfg(test)]
mod tests {
    use crate::core::config::{Phase3Config, Phase3PoolConfig};
    use crate::messages::{CapabilityByType, ServiceType, common::{NodeLanguageCapabilities, NmtCapability, LanguagePair}};
    use crate::node_registry::{Node, language_capability_index::LanguageCapabilityIndex};
    use crate::node_registry::phase3_pool_allocation::determine_pool_for_node_auto_mode_with_index;
    use crate::messages::{NodeStatus, HardwareInfo};

    fn create_test_node_with_semantic_languages(
        node_id: &str,
        asr_langs: Vec<String>,
        tts_langs: Vec<String>,
        nmt_capabilities: Vec<NmtCapability>,
        semantic_langs: Vec<String>,
    ) -> Node {
        let capability_by_type = vec![
            CapabilityByType {
                r#type: ServiceType::Asr,
                ready: true,
                ready_impl_ids: Some(vec![]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Nmt,
                ready: true,
                ready_impl_ids: Some(vec![]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Tts,
                ready: true,
                ready_impl_ids: Some(vec![]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Semantic,
                ready: true,
                ready_impl_ids: Some(vec![]),
                reason: None,
            },
        ];

        let mut capability_by_type_map = std::collections::HashMap::new();
        for c in &capability_by_type {
            capability_by_type_map.insert(c.r#type.clone(), c.ready);
        }

        Node {
            node_id: node_id.to_string(),
            name: format!("node-{}", node_id),
            version: "1.0.0".to_string(),
            platform: "test".to_string(),
            status: NodeStatus::Ready,
            online: true,
            hardware: HardwareInfo {
                cpu_cores: 4,
                memory_gb: 16,
                gpus: Some(vec![]),
            },
            cpu_usage: 0.0,
            gpu_usage: Some(0.0),
            memory_usage: 0.0,
            installed_models: vec![],
            installed_services: vec![],
            features_supported: Default::default(),
            accept_public_jobs: true,
            capability_by_type: capability_by_type.clone(),
            capability_by_type_map,
            current_jobs: 0,
            max_concurrent_jobs: 4,
            last_heartbeat: chrono::Utc::now(),
            registered_at: chrono::Utc::now(),
            processing_metrics: None,
            language_capabilities: Some(NodeLanguageCapabilities {
                supported_language_pairs: None,
                asr_languages: Some(asr_langs),
                tts_languages: Some(tts_langs),
                nmt_capabilities: Some(nmt_capabilities),
                semantic_languages: Some(semantic_langs),
            }),
        }
    }

    #[test]
    fn test_node_allocation_requires_semantic_service_languages_for_precise_pool() {
        // 创建语言能力索引
        let mut index = LanguageCapabilityIndex::new();
        
        // 创建节点：支持 zh->en，但语义修复服务只支持 zh
        let node = create_test_node_with_semantic_languages(
            "node1",
            vec!["zh".to_string()],
            vec!["en".to_string()],
            vec![NmtCapability {
                model_id: "nmt-zh-en".to_string(),
                languages: vec!["zh".to_string(), "en".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "zh".to_string(),
                    tgt: "en".to_string(),
                }]),
            }],
            vec!["zh".to_string()], // 只支持 zh，不支持 en
        );
        
        index.update_node_capabilities("node1", &node.language_capabilities);
        
        // 创建 Pool 配置：zh-en
        let mut cfg = Phase3Config::default();
        cfg.enabled = true;
        cfg.mode = "two_level".to_string();
        cfg.auto_generate_language_pools = true;
        cfg.pools = vec![
            Phase3PoolConfig {
                pool_id: 1,
                name: "zh-en".to_string(),
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string(), "semantic".to_string()],
                language_requirements: Some(crate::core::config::PoolLanguageRequirements {
                    asr_languages: Some(vec!["zh".to_string()]),
                    tts_languages: Some(vec!["en".to_string()]),
                    nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                        languages: vec!["zh".to_string(), "en".to_string()],
                        rule: "specific_pairs".to_string(),
                        supported_pairs: Some(vec![LanguagePair {
                            src: "zh".to_string(),
                            tgt: "en".to_string(),
                        }]),
                        blocked_pairs: None,
                    }),
                    semantic_languages: None,
                }),
            },
        ];
        
        // 尝试分配节点到 Pool
        let pool_id = determine_pool_for_node_auto_mode_with_index(&cfg, &node, &index);
        
        // 由于语义修复服务不支持 en，节点不应该被分配到 zh-en Pool
        assert_eq!(pool_id, None);
    }

    #[test]
    fn test_node_allocation_with_semantic_service_supporting_both_languages() {
        // 创建语言能力索引
        let mut index = LanguageCapabilityIndex::new();
        
        // 创建节点：支持 zh->en，语义修复服务支持 zh 和 en
        let node = create_test_node_with_semantic_languages(
            "node1",
            vec!["zh".to_string()],
            vec!["en".to_string()],
            vec![NmtCapability {
                model_id: "nmt-zh-en".to_string(),
                languages: vec!["zh".to_string(), "en".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "zh".to_string(),
                    tgt: "en".to_string(),
                }]),
            }],
            vec!["zh".to_string(), "en".to_string()], // 支持 zh 和 en
        );
        
        index.update_node_capabilities("node1", &node.language_capabilities);
        
        // 创建 Pool 配置：zh-en
        let mut cfg = Phase3Config::default();
        cfg.enabled = true;
        cfg.mode = "two_level".to_string();
        cfg.auto_generate_language_pools = true;
        cfg.pools = vec![
            Phase3PoolConfig {
                pool_id: 1,
                name: "zh-en".to_string(),
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string(), "semantic".to_string()],
                language_requirements: Some(crate::core::config::PoolLanguageRequirements {
                    asr_languages: Some(vec!["zh".to_string()]),
                    tts_languages: Some(vec!["en".to_string()]),
                    nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                        languages: vec!["zh".to_string(), "en".to_string()],
                        rule: "specific_pairs".to_string(),
                        supported_pairs: Some(vec![LanguagePair {
                            src: "zh".to_string(),
                            tgt: "en".to_string(),
                        }]),
                        blocked_pairs: None,
                    }),
                    semantic_languages: None,
                }),
            },
        ];
        
        // 尝试分配节点到 Pool
        let pool_id = determine_pool_for_node_auto_mode_with_index(&cfg, &node, &index);
        
        // 由于语义修复服务支持 zh 和 en，节点应该被分配到 zh-en Pool
        assert_eq!(pool_id, Some(1));
    }

    #[test]
    fn test_node_allocation_without_semantic_service() {
        // 创建语言能力索引
        let mut index = LanguageCapabilityIndex::new();
        
        // 创建节点：支持 zh->en，但没有语义修复服务
        let node = create_test_node_with_semantic_languages(
            "node1",
            vec!["zh".to_string()],
            vec!["en".to_string()],
            vec![NmtCapability {
                model_id: "nmt-zh-en".to_string(),
                languages: vec!["zh".to_string(), "en".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "zh".to_string(),
                    tgt: "en".to_string(),
                }]),
            }],
            vec![], // 没有语义修复服务
        );
        
        index.update_node_capabilities("node1", &node.language_capabilities);
        
        // 创建 Pool 配置：zh-en
        let mut cfg = Phase3Config::default();
        cfg.enabled = true;
        cfg.mode = "two_level".to_string();
        cfg.auto_generate_language_pools = true;
        cfg.pools = vec![
            Phase3PoolConfig {
                pool_id: 1,
                name: "zh-en".to_string(),
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string(), "semantic".to_string()],
                language_requirements: Some(crate::core::config::PoolLanguageRequirements {
                    asr_languages: Some(vec!["zh".to_string()]),
                    tts_languages: Some(vec!["en".to_string()]),
                    nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                        languages: vec!["zh".to_string(), "en".to_string()],
                        rule: "specific_pairs".to_string(),
                        supported_pairs: Some(vec![LanguagePair {
                            src: "zh".to_string(),
                            tgt: "en".to_string(),
                        }]),
                        blocked_pairs: None,
                    }),
                    semantic_languages: None,
                }),
            },
        ];
        
        // 尝试分配节点到 Pool
        let pool_id = determine_pool_for_node_auto_mode_with_index(&cfg, &node, &index);
        
        // 由于没有语义修复服务，节点不应该被分配到 Pool
        assert_eq!(pool_id, None);
    }

    #[test]
    fn test_node_allocation_mixed_pool_with_semantic_service_check() {
        // 创建语言能力索引
        let mut index = LanguageCapabilityIndex::new();
        
        // 创建节点：支持任意源语言到 en，语义修复服务支持 zh 和 en
        let node = create_test_node_with_semantic_languages(
            "node1",
            vec!["zh".to_string(), "ja".to_string()],
            vec!["en".to_string()],
            vec![NmtCapability {
                model_id: "nmt-any-en".to_string(),
                languages: vec!["zh".to_string(), "ja".to_string(), "en".to_string()],
                rule: "any_to_en".to_string(),
                blocked_pairs: None,
                supported_pairs: None,
            }],
            vec!["zh".to_string(), "en".to_string()], // 支持 zh 和 en，但不支持 ja
        );
        
        index.update_node_capabilities("node1", &node.language_capabilities);
        
        // 创建混合 Pool 配置：*-en
        let mut cfg = Phase3Config::default();
        cfg.enabled = true;
        cfg.mode = "two_level".to_string();
        cfg.auto_generate_language_pools = true;
        cfg.pools = vec![
            Phase3PoolConfig {
                pool_id: 1,
                name: "*-en".to_string(),
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string(), "semantic".to_string()],
                language_requirements: Some(crate::core::config::PoolLanguageRequirements {
                    asr_languages: None,
                    tts_languages: Some(vec!["en".to_string()]),
                    nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                        languages: vec!["zh".to_string(), "ja".to_string(), "en".to_string()],
                        rule: "any_to_any".to_string(),
                        supported_pairs: None,
                        blocked_pairs: None,
                    }),
                    semantic_languages: None,
                }),
            },
        ];
        
        // 尝试分配节点到 Pool
        let pool_id = determine_pool_for_node_auto_mode_with_index(&cfg, &node, &index);
        
        // 由于语义修复服务支持 en，并且有源语言（zh）在语义修复服务支持列表中，节点应该被分配到 Pool
        assert_eq!(pool_id, Some(1));
    }
}
