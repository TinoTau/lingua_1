#[cfg(test)]
mod tests {
    use crate::core::config::{AutoLanguagePoolConfig, Phase3Config, Phase3PoolConfig};
    use crate::messages::{CapabilityByType, ServiceType, common::{NodeLanguageCapabilities, NmtCapability, LanguagePair}};
    use crate::node_registry::{NodeRegistry, Node};
    use crate::messages::{NodeStatus, HardwareInfo};

    fn create_test_node(
        node_id: &str,
        asr_langs: Vec<String>,
        tts_langs: Vec<String>,
        nmt_capabilities: Vec<NmtCapability>,
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
                semantic_languages: Some(vec!["zh".to_string(), "en".to_string()]),
            }),
        }
    }

    async fn setup_test_registry() -> NodeRegistry {
        let registry = NodeRegistry::new();
        
        // 设置 Phase3 配置
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 10,
            pool_naming: "pair".to_string(),
            require_semantic: true,
            enable_mixed_pools: false, // 测试中默认禁用混合 Pool，只测试精确 Pool
            ..Default::default()
        });
        
        registry.set_phase3_config(phase3_config).await;
        registry
    }

    #[tokio::test]
    async fn test_auto_generate_language_pair_pools_basic() {
        let registry = setup_test_registry().await;
        
        // 添加测试节点：支持 zh->en
        let node1 = create_test_node(
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
        );
        
        {
            let mut nodes = registry.nodes.write().await;
            nodes.insert("node1".to_string(), node1.clone());
        }
        
        // 更新语言能力索引
        {
            let mut index = registry.language_capability_index.write().await;
            index.update_node_capabilities("node1", &node1.language_capabilities);
        }
        
        // 生成 Pool
        let pools = registry.auto_generate_language_pair_pools().await;
        
        assert_eq!(pools.len(), 1);
        assert_eq!(pools[0].name, "zh-en");
        assert_eq!(pools[0].pool_id, 1);
    }

    #[tokio::test]
    async fn test_language_pairs_filtered_by_semantic_service() {
        let registry = setup_test_registry().await;
        
        // 添加节点：支持 zh->en，但语义修复服务只支持 zh
        // 注意：如果节点端已经基于语义修复服务过滤了语言对，那么节点上报的 supported_language_pairs
        // 应该已经是过滤后的结果。如果节点上报了 zh-en，说明语义修复服务支持 zh 和 en。
        // 但在这个测试中，我们模拟的是向后兼容模式（节点没有上报 supported_language_pairs），
        // 调度服务器端会基于语义修复服务的语言能力进行过滤。
        let node1 = create_test_node(
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
        );
        
        // 修改节点：语义修复服务只支持 zh，不支持 en
        // 不提供 supported_language_pairs，使用向后兼容模式
        let mut node1_modified = node1.clone();
        node1_modified.language_capabilities = Some(NodeLanguageCapabilities {
            supported_language_pairs: None, // 不提供，使用向后兼容模式
            asr_languages: Some(vec!["zh".to_string()]),
            tts_languages: Some(vec!["en".to_string()]),
            nmt_capabilities: Some(vec![NmtCapability {
                model_id: "nmt-zh-en".to_string(),
                languages: vec!["zh".to_string(), "en".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "zh".to_string(),
                    tgt: "en".to_string(),
                }]),
            }]),
            semantic_languages: Some(vec!["zh".to_string()]), // 只支持 zh，不支持 en
        });
        
        {
            let mut nodes = registry.nodes.write().await;
            nodes.insert("node1".to_string(), node1_modified.clone());
        }
        
        // 更新语言能力索引
        {
            let mut index = registry.language_capability_index.write().await;
            index.update_node_capabilities("node1", &node1_modified.language_capabilities);
        }
        
        // 生成 Pool
        let pools = registry.auto_generate_language_pair_pools().await;
        
        // 由于语义修复服务只支持 zh，不支持 en，所以 zh-en 不应该被生成
        // 在向后兼容模式下，调度服务器端会检查语义修复服务的语言能力
        assert_eq!(pools.len(), 0);
    }

    #[tokio::test]
    async fn test_language_pairs_with_semantic_service_supporting_both_languages() {
        let registry = setup_test_registry().await;
        
        // 添加节点：支持 zh->en，语义修复服务支持 zh 和 en
        let node1 = create_test_node(
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
        );
        
        // 修改节点：语义修复服务支持 zh 和 en
        let mut node1_modified = node1.clone();
        node1_modified.language_capabilities = Some(NodeLanguageCapabilities {
            supported_language_pairs: Some(vec![LanguagePair {
                src: "zh".to_string(),
                tgt: "en".to_string(),
            }]),
            asr_languages: Some(vec!["zh".to_string()]),
            tts_languages: Some(vec!["en".to_string()]),
            nmt_capabilities: Some(vec![NmtCapability {
                model_id: "nmt-zh-en".to_string(),
                languages: vec!["zh".to_string(), "en".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "zh".to_string(),
                    tgt: "en".to_string(),
                }]),
            }]),
            semantic_languages: Some(vec!["zh".to_string(), "en".to_string()]), // 支持 zh 和 en
        });
        
        {
            let mut nodes = registry.nodes.write().await;
            nodes.insert("node1".to_string(), node1_modified.clone());
        }
        
        // 更新语言能力索引
        {
            let mut index = registry.language_capability_index.write().await;
            index.update_node_capabilities("node1", &node1_modified.language_capabilities);
        }
        
        // 生成 Pool
        let pools = registry.auto_generate_language_pair_pools().await;
        
        // 由于语义修复服务支持 zh 和 en，所以 zh-en 应该被生成
        assert_eq!(pools.len(), 1);
        assert_eq!(pools[0].name, "zh-en");
    }

    #[tokio::test]
    async fn test_auto_generate_language_pair_pools_min_nodes_filter() {
        let registry = setup_test_registry().await;
        
        // 添加节点：支持 zh->en（但只有一个节点，min_nodes_per_pool=2）
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 2,  // 需要至少2个节点
            max_pools: 10,
            pool_naming: "pair".to_string(),
            require_semantic: true,
            enable_mixed_pools: false, // 测试中禁用混合 Pool
            ..Default::default()
        });
        registry.set_phase3_config(phase3_config).await;
        
        let node1 = create_test_node(
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
        );
        
        {
            let mut nodes = registry.nodes.write().await;
            nodes.insert("node1".to_string(), node1.clone());
        }
        
        {
            let mut index = registry.language_capability_index.write().await;
            index.update_node_capabilities("node1", &node1.language_capabilities);
        }
        
        // 生成 Pool（应该被过滤掉，因为只有1个节点）
        let pools = registry.auto_generate_language_pair_pools().await;
        
        assert_eq!(pools.len(), 0);
    }

    #[tokio::test]
    async fn test_auto_generate_language_pair_pools_multiple_pairs() {
        let registry = setup_test_registry().await;
        
        // 添加多个节点，支持不同的语言对
        let node1 = create_test_node(
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
        );
        
        let node2 = create_test_node(
            "node2",
            vec!["en".to_string()],
            vec!["zh".to_string()],
            vec![NmtCapability {
                model_id: "nmt-en-zh".to_string(),
                languages: vec!["en".to_string(), "zh".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "en".to_string(),
                    tgt: "zh".to_string(),
                }]),
            }],
        );
        
        {
            let mut nodes = registry.nodes.write().await;
            nodes.insert("node1".to_string(), node1.clone());
            nodes.insert("node2".to_string(), node2.clone());
        }
        
        {
            let mut index = registry.language_capability_index.write().await;
            index.update_node_capabilities("node1", &node1.language_capabilities);
            index.update_node_capabilities("node2", &node2.language_capabilities);
        }
        
        // 生成 Pool
        let pools = registry.auto_generate_language_pair_pools().await;
        
        assert_eq!(pools.len(), 2);
        let pool_names: Vec<String> = pools.iter().map(|p| p.name.clone()).collect();
        assert!(pool_names.contains(&"zh-en".to_string()));
        assert!(pool_names.contains(&"en-zh".to_string()));
    }

    #[tokio::test]
    async fn test_node_allocation_requires_semantic_service_languages() {
        let registry = setup_test_registry().await;
        
        // 创建 Pool：zh-en
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 10,
            pool_naming: "pair".to_string(),
            require_semantic: true,
            enable_mixed_pools: false,
            ..Default::default()
        });
        phase3_config.pools = vec![
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
        registry.set_phase3_config(phase3_config).await;
        
        // 创建节点：支持 zh->en，但语义修复服务只支持 zh（不支持 en）
        let node1 = create_test_node(
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
        );
        
        // 修改节点：语义修复服务只支持 zh
        let mut node1_modified = node1.clone();
        node1_modified.language_capabilities = Some(NodeLanguageCapabilities {
            supported_language_pairs: Some(vec![LanguagePair {
                src: "zh".to_string(),
                tgt: "en".to_string(),
            }]),
            asr_languages: Some(vec!["zh".to_string()]),
            tts_languages: Some(vec!["en".to_string()]),
            nmt_capabilities: Some(vec![NmtCapability {
                model_id: "nmt-zh-en".to_string(),
                languages: vec!["zh".to_string(), "en".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "zh".to_string(),
                    tgt: "en".to_string(),
                }]),
            }]),
            semantic_languages: Some(vec!["zh".to_string()]), // 只支持 zh，不支持 en
        });
        
        {
            let mut nodes = registry.nodes.write().await;
            nodes.insert("node1".to_string(), node1_modified.clone());
        }
        
        // 更新语言能力索引
        {
            let mut index = registry.language_capability_index.write().await;
            index.update_node_capabilities("node1", &node1_modified.language_capabilities);
        }
        
        // 尝试分配节点到 Pool
        registry.phase3_upsert_node_to_pool_index("node1").await;
        
        // 检查节点是否被分配到 Pool
        let pool_id = registry.phase3_node_pool_id("node1").await;
        
        // 由于语义修复服务不支持 en，节点不应该被分配到 zh-en Pool
        assert_eq!(pool_id, None);
    }

    #[tokio::test]
    async fn test_node_allocation_with_semantic_service_supporting_both_languages() {
        let registry = setup_test_registry().await;
        
        // 创建 Pool：zh-en
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 10,
            pool_naming: "pair".to_string(),
            require_semantic: true,
            enable_mixed_pools: false,
            ..Default::default()
        });
        phase3_config.pools = vec![
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
        registry.set_phase3_config(phase3_config).await;
        
        // 创建节点：支持 zh->en，语义修复服务支持 zh 和 en
        let node1 = create_test_node(
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
        );
        
        // 修改节点：语义修复服务支持 zh 和 en
        let mut node1_modified = node1.clone();
        node1_modified.language_capabilities = Some(NodeLanguageCapabilities {
            supported_language_pairs: Some(vec![LanguagePair {
                src: "zh".to_string(),
                tgt: "en".to_string(),
            }]),
            asr_languages: Some(vec!["zh".to_string()]),
            tts_languages: Some(vec!["en".to_string()]),
            nmt_capabilities: Some(vec![NmtCapability {
                model_id: "nmt-zh-en".to_string(),
                languages: vec!["zh".to_string(), "en".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "zh".to_string(),
                    tgt: "en".to_string(),
                }]),
            }]),
            semantic_languages: Some(vec!["zh".to_string(), "en".to_string()]), // 支持 zh 和 en
        });
        
        {
            let mut nodes = registry.nodes.write().await;
            nodes.insert("node1".to_string(), node1_modified.clone());
        }
        
        // 更新语言能力索引
        {
            let mut index = registry.language_capability_index.write().await;
            index.update_node_capabilities("node1", &node1_modified.language_capabilities);
        }
        
        // 尝试分配节点到 Pool
        registry.phase3_upsert_node_to_pool_index("node1").await;
        
        // 检查节点是否被分配到 Pool
        let pool_id = registry.phase3_node_pool_id("node1").await;
        
        // 由于语义修复服务支持 zh 和 en，节点应该被分配到 zh-en Pool
        assert_eq!(pool_id, Some(1));
    }

    #[tokio::test]
    async fn test_dynamic_pool_creation_for_new_language_pair() {
        let registry = setup_test_registry().await;
        
        // 创建初始 Pool：zh-en
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 10,
            pool_naming: "pair".to_string(),
            require_semantic: true,
            enable_mixed_pools: false,
            ..Default::default()
        });
        phase3_config.pools = vec![
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
        registry.set_phase3_config(phase3_config).await;
        
        // 创建节点：支持 zh->ja（新语言对，不在现有 Pool 中）
        let node1 = create_test_node(
            "node1",
            vec!["zh".to_string()],
            vec!["ja".to_string()],
            vec![NmtCapability {
                model_id: "nmt-zh-ja".to_string(),
                languages: vec!["zh".to_string(), "ja".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "zh".to_string(),
                    tgt: "ja".to_string(),
                }]),
            }],
        );
        
        // 修改节点：语义修复服务支持 zh 和 ja
        let mut node1_modified = node1.clone();
        node1_modified.language_capabilities = Some(NodeLanguageCapabilities {
            supported_language_pairs: Some(vec![LanguagePair {
                src: "zh".to_string(),
                tgt: "ja".to_string(),
            }]),
            asr_languages: Some(vec!["zh".to_string()]),
            tts_languages: Some(vec!["ja".to_string()]),
            nmt_capabilities: Some(vec![NmtCapability {
                model_id: "nmt-zh-ja".to_string(),
                languages: vec!["zh".to_string(), "ja".to_string()],
                rule: "specific_pairs".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair {
                    src: "zh".to_string(),
                    tgt: "ja".to_string(),
                }]),
            }]),
            semantic_languages: Some(vec!["zh".to_string(), "ja".to_string()]), // 支持 zh 和 ja
        });
        
        {
            let mut nodes = registry.nodes.write().await;
            nodes.insert("node1".to_string(), node1_modified.clone());
        }
        
        // 更新语言能力索引
        {
            let mut index = registry.language_capability_index.write().await;
            index.update_node_capabilities("node1", &node1_modified.language_capabilities);
        }
        
        // 尝试分配节点到 Pool（应该动态创建新 Pool）
        registry.phase3_upsert_node_to_pool_index("node1").await;
        
        // 检查 Pool 配置是否包含新创建的 Pool
        let cfg = registry.phase3_config().await;
        let pool_names: Vec<String> = cfg.pools.iter().map(|p| p.name.clone()).collect();
        
        // 应该包含新创建的 zh-ja Pool
        assert!(pool_names.contains(&"zh-ja".to_string()));
        
        // 检查节点是否被分配到新 Pool
        let pool_id = registry.phase3_node_pool_id("node1").await;
        assert!(pool_id.is_some());
        
        // 验证新 Pool 的配置
        let new_pool = cfg.pools.iter().find(|p| p.name == "zh-ja").unwrap();
        assert_eq!(new_pool.pool_id, 2); // 应该是第二个 Pool
        assert!(new_pool.required_services.contains(&"semantic".to_string()));
    }

    #[tokio::test]
    async fn test_auto_generate_language_pair_pools_max_pools_limit() {
        let registry = setup_test_registry().await;
        
        // 设置 max_pools = 2
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 2,  // 最多2个精确 Pool（混合 Pool 不受此限制）
            pool_naming: "pair".to_string(),
            require_semantic: true,
            enable_mixed_pools: false, // 测试中禁用混合 Pool，只测试精确 Pool 的数量限制
            ..Default::default()
        });
        registry.set_phase3_config(phase3_config).await;
        
        // 添加多个节点，支持多个语言对
        let languages = vec!["zh", "en", "ja", "ko"];
        for (i, src) in languages.iter().enumerate() {
            for (j, tgt) in languages.iter().enumerate() {
                if i != j {
                    let node_id = format!("node-{}-{}", src, tgt);
                    let node = create_test_node(
                        &node_id,
                        vec![src.to_string()],
                        vec![tgt.to_string()],
                        vec![NmtCapability {
                            model_id: format!("nmt-{}-{}", src, tgt),
                            languages: vec![src.to_string(), tgt.to_string()],
                            rule: "specific_pairs".to_string(),
                            blocked_pairs: None,
                            supported_pairs: Some(vec![LanguagePair {
                                src: src.to_string(),
                                tgt: tgt.to_string(),
                            }]),
                        }],
                    );
                    
                    {
                        let mut nodes = registry.nodes.write().await;
                        nodes.insert(node_id.clone(), node.clone());
                    }
                    
                    {
                        let mut index = registry.language_capability_index.write().await;
                        index.update_node_capabilities(&node_id, &node.language_capabilities);
                    }
                }
            }
        }
        
        // 生成 Pool（应该被限制为最多2个）
        let pools = registry.auto_generate_language_pair_pools().await;
        
        assert!(pools.len() <= 2);
    }
}
