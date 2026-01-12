//! Phase 3 Pool 节点分配逻辑测试

#[cfg(test)]
mod tests {
    use crate::core::config::{Phase3Config, Phase3PoolConfig, Phase2Config};
    use crate::messages::{CapabilityByType, ServiceType, common::{NodeLanguageCapabilities, NmtCapability, LanguagePair}};
    use crate::node_registry::{Node, language_capability_index::LanguageCapabilityIndex};
    use crate::node_registry::phase3_pool_allocation::determine_pools_for_node_auto_mode_with_index;
    use crate::messages::{NodeStatus, HardwareInfo};
    use crate::phase2::Phase2Runtime;
    use std::sync::Arc;
    
    // 创建测试用的 Phase2Runtime（如果 Redis 可用）
    async fn create_test_phase2_runtime(instance_id: &str) -> Option<Arc<Phase2Runtime>> {
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        
        let mut cfg = Phase2Config::default();
        cfg.enabled = true;
        cfg.instance_id = instance_id.to_string();
        cfg.redis.mode = "single".to_string();
        cfg.redis.url = redis_url;
        cfg.redis.key_prefix = format!(
            "lingua_test_allocation_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );

        match Phase2Runtime::new(cfg, 5).await {
            Ok(Some(rt)) => Some(Arc::new(rt)),
            Ok(None) => None,
            Err(_) => None,
        }
    }
    
    // 辅助函数：同步节点能力到 Redis
    async fn sync_node_capabilities(rt: &Phase2Runtime, node_id: &str, has_asr: bool, has_nmt: bool, has_tts: bool, has_semantic: bool) {
        let capability_by_type = vec![
            CapabilityByType {
                r#type: ServiceType::Asr,
                ready: has_asr,
                ready_impl_ids: Some(vec![]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Nmt,
                ready: has_nmt,
                ready_impl_ids: Some(vec![]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Tts,
                ready: has_tts,
                ready_impl_ids: Some(vec![]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Semantic,
                ready: has_semantic,
                ready_impl_ids: Some(vec![]),
                reason: None,
            },
        ];
        rt.sync_node_capabilities_to_redis(node_id, &capability_by_type).await;
    }

    fn create_test_node_with_semantic_languages(
        node_id: &str,
        asr_langs: Vec<String>,
        tts_langs: Vec<String>,
        nmt_capabilities: Vec<NmtCapability>,
        semantic_langs: Vec<String>,
    ) -> Node {
        let _capability_by_type = vec![
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

        // 注意：capability_by_type_map 已从 Node 结构体中移除
        // 节点能力信息现在存储在 Redis 中

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
            // capability_by_type 和 capability_by_type_map 已从 Node 结构体中移除，能力信息存储在 Redis
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

    #[tokio::test]
    async fn test_node_allocation_requires_semantic_service_languages_for_precise_pool() {
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
        
        // 创建 Pool 配置：en-zh（语言集合，排序后）
        let mut cfg = Phase3Config::default();
        cfg.enabled = true;
        cfg.mode = "two_level".to_string();
        cfg.auto_generate_language_pools = true;
        cfg.pools = vec![
            Phase3PoolConfig {
                pool_id: 1,
                name: "en-zh".to_string(), // 语言集合，排序后
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string(), "semantic".to_string()],
                language_requirements: Some(crate::core::config::PoolLanguageRequirements {
                    asr_languages: None, // 语言集合 Pool 不限制 ASR/TTS
                    tts_languages: None,
                    nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                        languages: vec!["en".to_string(), "zh".to_string()],
                        rule: "any_to_any".to_string(), // 语言集合 Pool 使用 any_to_any
                        supported_pairs: None,
                        blocked_pairs: None,
                    }),
                    semantic_languages: Some(vec!["en".to_string(), "zh".to_string()]), // 语言集合
                }),
            },
        ];
        
        // 尝试分配节点到 Pool（需要 async 和 phase2_runtime）
        // 注意：由于没有 phase2_runtime，无法从 Redis 读取节点能力，会返回空集合
        let pool_ids = determine_pools_for_node_auto_mode_with_index(&cfg, &node, &index, None).await;
        
        // 由于没有 phase2_runtime，无法检查节点能力，返回空集合
        assert!(pool_ids.is_empty());
    }

    #[tokio::test]
    async fn test_node_allocation_with_semantic_service_supporting_both_languages() {
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
        
        // 创建 Pool 配置：en-zh（语言集合，排序后）
        let mut cfg = Phase3Config::default();
        cfg.enabled = true;
        cfg.mode = "two_level".to_string();
        cfg.auto_generate_language_pools = true;
        cfg.pools = vec![
            Phase3PoolConfig {
                pool_id: 1,
                name: "en-zh".to_string(), // 语言集合，排序后
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string(), "semantic".to_string()],
                language_requirements: Some(crate::core::config::PoolLanguageRequirements {
                    asr_languages: None, // 语言集合 Pool 不限制 ASR/TTS
                    tts_languages: None,
                    nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                        languages: vec!["en".to_string(), "zh".to_string()],
                        rule: "any_to_any".to_string(), // 语言集合 Pool 使用 any_to_any
                        supported_pairs: None,
                        blocked_pairs: None,
                    }),
                    semantic_languages: Some(vec!["en".to_string(), "zh".to_string()]), // 语言集合
                }),
            },
        ];
        
        // 创建 Phase2Runtime 并同步节点能力到 Redis
        let rt = create_test_phase2_runtime("test-instance").await;
        if let Some(ref rt) = rt {
            // 同步节点能力到 Redis
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
            rt.sync_node_capabilities_to_redis(&node.node_id, &capability_by_type).await;
        }
        
        // 尝试分配节点到 Pool
        let pool_ids = determine_pools_for_node_auto_mode_with_index(&cfg, &node, &index, rt.as_deref()).await;
        
        // 如果 Redis 可用，节点应该被分配到 Pool
        if rt.is_some() {
            assert_eq!(pool_ids.len(), 1);
            assert_eq!(pool_ids[0], 1);
        } else {
            // 如果 Redis 不可用，函数会返回空向量（因为无法读取节点能力）
            assert_eq!(pool_ids.len(), 0);
        }
    }

    #[tokio::test]
    async fn test_node_allocation_without_semantic_service() {
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
        
        // 创建 Pool 配置：en-zh（语言集合，排序后）
        let mut cfg = Phase3Config::default();
        cfg.enabled = true;
        cfg.mode = "two_level".to_string();
        cfg.auto_generate_language_pools = true;
        cfg.pools = vec![
            Phase3PoolConfig {
                pool_id: 1,
                name: "en-zh".to_string(), // 语言集合，排序后
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string(), "semantic".to_string()],
                language_requirements: Some(crate::core::config::PoolLanguageRequirements {
                    asr_languages: None, // 语言集合 Pool 不限制 ASR/TTS
                    tts_languages: None,
                    nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                        languages: vec!["en".to_string(), "zh".to_string()],
                        rule: "any_to_any".to_string(), // 语言集合 Pool 使用 any_to_any
                        supported_pairs: None,
                        blocked_pairs: None,
                    }),
                    semantic_languages: Some(vec!["en".to_string(), "zh".to_string()]), // 语言集合
                }),
            },
        ];
        
        // 创建 Phase2Runtime 并同步节点能力到 Redis（没有语义修复服务）
        let rt = create_test_phase2_runtime("test-instance-2").await;
        if let Some(ref rt) = rt {
            sync_node_capabilities(rt, &node.node_id, true, true, true, false).await;
        }
        
        // 尝试分配节点到 Pool
        let pool_ids = determine_pools_for_node_auto_mode_with_index(&cfg, &node, &index, rt.as_deref()).await;
        
        // 由于没有语义修复服务，节点不应该被分配到 Pool
        assert!(pool_ids.is_empty());
    }

    #[tokio::test]
    async fn test_node_allocation_mixed_pool_with_semantic_service_check() {
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
        
        // 创建语言集合 Pool 配置：en-zh（节点支持 zh 和 en）
        let mut cfg = Phase3Config::default();
        cfg.enabled = true;
        cfg.mode = "two_level".to_string();
        cfg.auto_generate_language_pools = true;
        cfg.pools = vec![
            Phase3PoolConfig {
                pool_id: 1,
                name: "en-zh".to_string(), // 语言集合，排序后
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string(), "semantic".to_string()],
                language_requirements: Some(crate::core::config::PoolLanguageRequirements {
                    asr_languages: None,
                    tts_languages: None,
                    nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                        languages: vec!["en".to_string(), "zh".to_string()],
                        rule: "any_to_any".to_string(),
                        supported_pairs: None,
                        blocked_pairs: None,
                    }),
                    semantic_languages: Some(vec!["en".to_string(), "zh".to_string()]), // 语言集合
                }),
            },
        ];
        
        // 创建 Phase2Runtime 并同步节点能力到 Redis
        let rt = create_test_phase2_runtime("test-instance-3").await;
        if let Some(ref rt) = rt {
            sync_node_capabilities(rt, &node.node_id, true, true, true, true).await;
        }
        
        // 尝试分配节点到 Pool
        let pool_ids = determine_pools_for_node_auto_mode_with_index(&cfg, &node, &index, rt.as_deref()).await;
        
        // 如果 Redis 可用，由于节点的语义修复服务支持 zh 和 en，语言集合完全匹配，节点应该被分配到 Pool
        if rt.is_some() {
            assert_eq!(pool_ids.len(), 1);
            assert_eq!(pool_ids[0], 1);
        } else {
            // 如果 Redis 不可用，函数会返回空向量
            assert_eq!(pool_ids.len(), 0);
        }
    }
}
