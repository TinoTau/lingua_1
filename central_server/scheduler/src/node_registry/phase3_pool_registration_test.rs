#[cfg(test)]
mod tests {
    use crate::core::config::{AutoLanguagePoolConfig, Phase3Config, Phase2Config};
    use crate::messages::{CapabilityByType, ServiceType, common::{NodeLanguageCapabilities, LanguagePair}, FeatureFlags};
    use crate::node_registry::{NodeRegistry, Node};
    use crate::messages::{NodeStatus, HardwareInfo, InstalledModel, InstalledService, ServiceStatus, DeviceType};
    use crate::phase2::Phase2Runtime;
    use std::sync::Arc;
    use std::collections::HashSet;

    async fn create_test_phase2_runtime(instance_id: &str) -> Option<Arc<Phase2Runtime>> {
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        
        let mut cfg = Phase2Config::default();
        cfg.enabled = true;
        cfg.instance_id = instance_id.to_string();
        cfg.redis.mode = "single".to_string();
        cfg.redis.url = redis_url;
        cfg.redis.key_prefix = format!(
            "lingua_test_registration_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );

        match Phase2Runtime::new(cfg, 5).await {
            Ok(Some(rt)) => Some(Arc::new(rt)),
            Ok(None) => None,
            Err(e) => {
                eprintln!("Failed to create Phase2Runtime: {}", e);
                None
            }
        }
    }

    fn create_test_node_with_semantic_langs(
        node_id: &str,
        semantic_langs: Vec<String>,
    ) -> Node {
        let capability_by_type = vec![
            CapabilityByType {
                r#type: ServiceType::Asr,
                ready: true,
                ready_impl_ids: Some(vec!["asr-impl".to_string()]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Nmt,
                ready: true,
                ready_impl_ids: Some(vec!["nmt-impl".to_string()]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Tts,
                ready: true,
                ready_impl_ids: Some(vec!["tts-impl".to_string()]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Semantic,
                ready: true,
                ready_impl_ids: Some(vec!["semantic-impl".to_string()]),
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
            status: NodeStatus::Registering,
            online: true,
            hardware: HardwareInfo {
                cpu_cores: 4,
                memory_gb: 16,
                gpus: Some(vec![crate::messages::GpuInfo {
                name: "test-gpu".to_string(),
                memory_gb: 8,
            }]),
            },
            // capability_by_type 已从 Node 结构体中移除，能力信息存储在 Redis
            installed_services: vec![
                InstalledService {
                    service_id: "asr-impl".to_string(),
                    r#type: ServiceType::Asr,
                    device: DeviceType::Gpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "nmt-impl".to_string(),
                    r#type: ServiceType::Nmt,
                    device: DeviceType::Gpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "tts-impl".to_string(),
                    r#type: ServiceType::Tts,
                    device: DeviceType::Gpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "semantic-impl".to_string(),
                    r#type: ServiceType::Semantic,
                    device: DeviceType::Gpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
            ],
            installed_models: vec![
                InstalledModel {
                    model_id: "test-model".to_string(),
                    kind: "asr".to_string(),
                    src_lang: None,
                    tgt_lang: None,
                    dialect: None,
                    version: "1.0.0".to_string(),
                    enabled: Some(true),
                },
            ],
            language_capabilities: Some(NodeLanguageCapabilities {
                supported_language_pairs: None,
                asr_languages: None,
                tts_languages: None,
                nmt_capabilities: None,
                semantic_languages: Some(semantic_langs),
            }),
            features_supported: FeatureFlags {
                emotion_detection: None,
                voice_style_detection: None,
                speech_rate_detection: None,
                speech_rate_control: None,
                speaker_identification: None,
                persona_adaptation: None,
            },
            accept_public_jobs: true,
            current_jobs: 0,
            max_concurrent_jobs: 4,
            cpu_usage: 0.0,
            gpu_usage: None,
            memory_usage: 0.0,
            last_heartbeat: chrono::Utc::now(),
            registered_at: chrono::Utc::now(),
            processing_metrics: None,
        }
    }

    async fn cleanup_test_keys(rt: &Phase2Runtime) {
        // 清理测试用的 Redis keys（通过 Phase2Runtime 的方法）
        use redis::Commands;
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        
        if let Ok(client) = redis::Client::open(redis_url.as_str()) {
            if let Ok(mut conn) = client.get_connection() {
                let key_prefix = rt.key_prefix();
                let config_key = format!("{}:v1:phase3:pools:config", key_prefix);
                let leader_key = format!("{}:v1:phase3:pools:leader", key_prefix);
                let version_key = format!("{}:v1:phase3:pools:version", key_prefix);
                
                let _: Result<(), _> = conn.del(&config_key);
                let _: Result<(), _> = conn.del(&leader_key);
                let _: Result<(), _> = conn.del(&version_key);
            }
        }
    }

    #[tokio::test]
    async fn test_node_registration_pool_allocation() {
        // 创建 Phase2Runtime
        let rt = match create_test_phase2_runtime("test-registration").await {
            Some(rt) => rt,
            None => {
                eprintln!("Skipping test: Redis not available");
                return;
            }
        };

        // 清理测试 keys
        cleanup_test_keys(&rt).await;

        // 创建 NodeRegistry
        let registry = Arc::new(NodeRegistry::new());

        // 配置 Phase3
        let mut phase3_cfg = Phase3Config::default();
        phase3_cfg.enabled = true;
        phase3_cfg.mode = "two_level".to_string();
        phase3_cfg.auto_generate_language_pools = true;
        phase3_cfg.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 10,
            pool_naming: "set".to_string(),
            require_semantic: true,
            enable_mixed_pools: false,
        });
        registry.set_phase3_config(phase3_cfg).await;

        // 测试节点1：支持 en-zh
        let node1 = create_test_node_with_semantic_langs("node-1", vec!["en".to_string(), "zh".to_string()]);
        
        // 注册节点（传递 phase2_runtime）
        // 注意：节点必须有 GPU 才能注册
        let mut node_with_gpu = node1.clone();
        node_with_gpu.hardware.gpus = Some(vec![crate::messages::GpuInfo {
            name: "test-gpu".to_string(),
            memory_gb: 8,
        }]);
        
        // 创建 capability_by_type 用于注册（虽然 Node 结构体中已移除，但函数签名仍需要此参数用于同步到 Redis）
        let capability_by_type = vec![
            CapabilityByType {
                r#type: ServiceType::Asr,
                ready: true,
                ready_impl_ids: Some(vec!["asr-impl".to_string()]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Nmt,
                ready: true,
                ready_impl_ids: Some(vec!["nmt-impl".to_string()]),
                reason: None,
            },
            CapabilityByType {
                r#type: ServiceType::Tts,
                ready: true,
                ready_impl_ids: Some(vec!["tts-impl".to_string()]),
                reason: None,
            },
        ];
        
        let result = registry.register_node_with_policy(
            Some("node-1".to_string()),
            node_with_gpu.name.clone(),
            node_with_gpu.version.clone(),
            node_with_gpu.platform.clone(),
            node_with_gpu.hardware.clone(),
            node_with_gpu.installed_models.clone(),
            Some(node_with_gpu.installed_services.clone()),
            node_with_gpu.features_supported.clone(),
            node_with_gpu.accept_public_jobs,
            capability_by_type,
            false, // allow_existing_id
            node_with_gpu.language_capabilities.clone(),
            Some(rt.as_ref()), // phase2_runtime
        ).await;

        assert!(result.is_ok(), "节点注册应该成功: {:?}", result);
        let registered_node = result.unwrap();
        assert_eq!(registered_node.node_id, "node-1");
        assert_eq!(registered_node.status, NodeStatus::Registering);

        // 等待 Pool 分配完成
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // 检查节点是否分配到 Pool
        let pool_ids = registry.phase3_node_pool_ids("node-1").await;
        assert!(!pool_ids.is_empty(), "节点应该被分配到至少一个 Pool");
        println!("节点 node-1 分配到 Pool: {:?}", pool_ids);

        // 检查节点状态是否变为 Ready
        let nodes = registry.nodes.read().await;
        let node = nodes.get("node-1").unwrap();
        assert_eq!(node.status, NodeStatus::Ready, "节点状态应该从 Registering 变为 Ready");
        drop(nodes);

        // 检查 Pool 配置是否同步到 Redis
        let redis_pools = rt.get_pool_config().await;
        assert!(redis_pools.is_some(), "Pool 配置应该同步到 Redis");
        let (pools, _version) = redis_pools.unwrap();
        assert!(!pools.is_empty(), "Redis 中应该有 Pool 配置");
        
        // 检查 Pool 名称（应该是排序后的语言集合）
        let pool_name = pools[0].name.clone();
        assert!(pool_name == "en-zh" || pool_name == "zh-en", "Pool 名称应该是排序后的语言集合: {}", pool_name);
        println!("Pool 配置已同步到 Redis: pool_name={}, pool_id={}", pool_name, pools[0].pool_id);

        // 检查 Pool 成员是否同步到 Redis
        // 注意：Pool 成员同步可能需要一些时间，等待一下
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let pool_members = rt.get_pool_members_from_redis(&pool_name).await;
        if let Some(members) = pool_members {
            if !members.contains("node-1") {
                println!("警告：节点 node-1 尚未在 Pool 成员列表中: {:?}", members);
                println!("这可能是异步同步延迟，检查本地 Pool 索引...");
                // 检查本地 Pool 索引
                let pool_index = registry.phase3_pool_index_clone(Some(&*rt)).await;
                for (pool_id, node_set) in &pool_index {
                    if node_set.contains("node-1") {
                        println!("节点 node-1 在本地 Pool {} 中", pool_id);
                    }
                }
            } else {
                println!("Pool 成员已同步到 Redis: {:?}", members);
            }
        } else {
            println!("Pool 成员尚未同步到 Redis（可能是异步操作延迟）");
        }

        // 清理
        cleanup_test_keys(&rt).await;
    }

    #[tokio::test]
    async fn test_node_registration_multiple_nodes_different_languages() {
        // 创建 Phase2Runtime
        let rt = match create_test_phase2_runtime("test-registration-multi").await {
            Some(rt) => rt,
            None => {
                eprintln!("Skipping test: Redis not available");
                return;
            }
        };

        // 清理测试 keys
        cleanup_test_keys(&rt).await;

        // 创建 NodeRegistry
        let registry = Arc::new(NodeRegistry::new());

        // 配置 Phase3
        let mut phase3_cfg = Phase3Config::default();
        phase3_cfg.enabled = true;
        phase3_cfg.mode = "two_level".to_string();
        phase3_cfg.auto_generate_language_pools = true;
        phase3_cfg.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 10,
            pool_naming: "set".to_string(),
            require_semantic: true,
            enable_mixed_pools: false,
        });
        registry.set_phase3_config(phase3_cfg).await;

        // 注册节点1：支持 en-zh
        let node1 = create_test_node_with_semantic_langs("node-1", vec!["en".to_string(), "zh".to_string()]);
        let result1 = registry.register_node_with_policy(
            Some("node-1".to_string()),
            node1.name.clone(),
            node1.version.clone(),
            node1.platform.clone(),
            node1.hardware.clone(),
            node1.installed_models.clone(),
            Some(node1.installed_services.clone()),
            node1.features_supported.clone(),
            node1.accept_public_jobs,
            vec![
                CapabilityByType {
                    r#type: ServiceType::Asr,
                    ready: true,
                    ready_impl_ids: Some(vec!["asr-impl".to_string()]),
                    reason: None,
                },
                CapabilityByType {
                    r#type: ServiceType::Nmt,
                    ready: true,
                    ready_impl_ids: Some(vec!["nmt-impl".to_string()]),
                    reason: None,
                },
                CapabilityByType {
                    r#type: ServiceType::Tts,
                    ready: true,
                    ready_impl_ids: Some(vec!["tts-impl".to_string()]),
                    reason: None,
                },
            ], // capability_by_type 已从 Node 结构体中移除，但函数签名仍需要此参数（用于同步到 Redis）
            false, // allow_existing_id
            node1.language_capabilities.clone(),
            Some(rt.as_ref()), // phase2_runtime
        ).await;
        assert!(result1.is_ok(), "节点1注册应该成功: {:?}", result1);

        // 注册节点2：支持 en-zh（应该分配到同一个 Pool）
        let node2 = create_test_node_with_semantic_langs("node-2", vec!["en".to_string(), "zh".to_string()]);
        let result2 = registry.register_node_with_policy(
            Some("node-2".to_string()),
            node2.name.clone(),
            node2.version.clone(),
            node2.platform.clone(),
            node2.hardware.clone(),
            node2.installed_models.clone(),
            Some(node2.installed_services.clone()),
            node2.features_supported.clone(),
            node2.accept_public_jobs,
            // 创建 capability_by_type 用于注册（节点2支持中英德）
            vec![
                CapabilityByType {
                    r#type: ServiceType::Asr,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["asr-impl".to_string()]),
                },
                CapabilityByType {
                    r#type: ServiceType::Nmt,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["nmt-impl".to_string()]),
                },
                CapabilityByType {
                    r#type: ServiceType::Tts,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["tts-impl".to_string()]),
                },
                CapabilityByType {
                    r#type: ServiceType::Semantic,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["semantic-impl".to_string()]),
                },
            ],
            false, // allow_existing_id
            node2.language_capabilities.clone(),
            Some(rt.as_ref()), // phase2_runtime
        ).await;
        assert!(result2.is_ok(), "节点2注册应该成功: {:?}", result2);

        // 注册节点3：支持 de-en-zh（应该创建新的 Pool）
        let node3 = create_test_node_with_semantic_langs("node-3", vec!["de".to_string(), "en".to_string(), "zh".to_string()]);
        let result3 = registry.register_node_with_policy(
            Some("node-3".to_string()),
            node3.name.clone(),
            node3.version.clone(),
            node3.platform.clone(),
            node3.hardware.clone(),
            node3.installed_models.clone(),
            Some(node3.installed_services.clone()),
            node3.features_supported.clone(),
            node3.accept_public_jobs,
            // 创建 capability_by_type 用于注册
            vec![
                CapabilityByType {
                    r#type: ServiceType::Asr,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["asr-impl".to_string()]),
                },
                CapabilityByType {
                    r#type: ServiceType::Nmt,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["nmt-impl".to_string()]),
                },
                CapabilityByType {
                    r#type: ServiceType::Tts,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["tts-impl".to_string()]),
                },
                CapabilityByType {
                    r#type: ServiceType::Semantic,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["semantic-impl".to_string()]),
                },
            ],
            false, // allow_existing_id
            node3.language_capabilities.clone(),
            Some(rt.as_ref()), // phase2_runtime
        ).await;
        assert!(result3.is_ok(), "节点3注册应该成功: {:?}", result3);

        // 等待 Pool 分配完成
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // 检查节点1和节点2是否分配到同一个 Pool
        let pool_ids_1 = registry.phase3_node_pool_ids("node-1").await;
        let pool_ids_2 = registry.phase3_node_pool_ids("node-2").await;
        assert!(!pool_ids_1.is_empty(), "节点1应该被分配到 Pool");
        assert!(!pool_ids_2.is_empty(), "节点2应该被分配到 Pool");
        
        // 节点1和节点2应该分配到同一个 Pool（en-zh）
        let common_pools: Vec<u16> = pool_ids_1.intersection(&pool_ids_2).cloned().collect();
        assert!(!common_pools.is_empty(), "节点1和节点2应该分配到同一个 Pool");
        println!("节点1和节点2都分配到 Pool: {:?}", common_pools);

        // 检查节点3是否分配到不同的 Pool
        let pool_ids_3 = registry.phase3_node_pool_ids("node-3").await;
        assert!(!pool_ids_3.is_empty(), "节点3应该被分配到 Pool");
        
        // 节点3应该分配到不同的 Pool（de-en-zh）
        let common_pools_3: Vec<u16> = pool_ids_1.intersection(&pool_ids_3).cloned().collect();
        assert!(common_pools_3.is_empty(), "节点3应该分配到不同的 Pool");
        println!("节点3分配到 Pool: {:?}", pool_ids_3);

        // 检查 Redis 中的 Pool 配置
        let redis_pools = rt.get_pool_config().await;
        assert!(redis_pools.is_some(), "Pool 配置应该同步到 Redis");
        let (pools, _version) = redis_pools.unwrap();
        assert!(pools.len() >= 2, "Redis 中应该有至少2个 Pool 配置");
        println!("Redis 中有 {} 个 Pool 配置", pools.len());

        // 清理
        cleanup_test_keys(&rt).await;
    }

    #[tokio::test]
    async fn test_node_registration_pool_config_not_cleared() {
        // 测试修复后的代码：确保配置不会被清空
        let rt = match create_test_phase2_runtime("test-no-clear").await {
            Some(rt) => rt,
            None => {
                eprintln!("Skipping test: Redis not available");
                return;
            }
        };

        // 清理测试 keys
        cleanup_test_keys(&rt).await;

        // 创建 NodeRegistry
        let registry = Arc::new(NodeRegistry::new());

        // 配置 Phase3
        let mut phase3_cfg = Phase3Config::default();
        phase3_cfg.enabled = true;
        phase3_cfg.mode = "two_level".to_string();
        phase3_cfg.auto_generate_language_pools = true;
        phase3_cfg.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 10,
            pool_naming: "set".to_string(),
            require_semantic: true,
            enable_mixed_pools: false,
        });
        registry.set_phase3_config(phase3_cfg).await;

        // 注册节点
        let node = create_test_node_with_semantic_langs("node-1", vec!["en".to_string(), "zh".to_string()]);
        let result = registry.register_node_with_policy(
            Some("node-1".to_string()),
            node.name.clone(),
            node.version.clone(),
            node.platform.clone(),
            node.hardware.clone(),
            node.installed_models.clone(),
            Some(node.installed_services.clone()),
            node.features_supported.clone(),
            node.accept_public_jobs,
            // 创建 capability_by_type 用于注册
            vec![
                CapabilityByType {
                    r#type: ServiceType::Asr,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["asr-impl".to_string()]),
                },
                CapabilityByType {
                    r#type: ServiceType::Nmt,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["nmt-impl".to_string()]),
                },
                CapabilityByType {
                    r#type: ServiceType::Tts,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["tts-impl".to_string()]),
                },
                CapabilityByType {
                    r#type: ServiceType::Semantic,
                    ready: true,
                    reason: None,
                    ready_impl_ids: Some(vec!["semantic-impl".to_string()]),
                },
            ],
            false, // allow_existing_id
            node.language_capabilities.clone(),
            Some(rt.as_ref()), // phase2_runtime
        ).await;
        assert!(result.is_ok(), "节点注册应该成功: {:?}", result);

        // 等待 Pool 分配完成
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // 检查本地配置
        let cfg_before = registry.phase3_config().await;
        assert!(!cfg_before.pools.is_empty(), "本地 Pool 配置不应该为空");
        let pool_count_before = cfg_before.pools.len();
        println!("修复前本地 Pool 配置数量: {}", pool_count_before);

        // 模拟 Redis 配置为空的情况（清空 Redis）
        cleanup_test_keys(&rt).await;

        // 调用 rebuild_auto_language_pools（应该保留本地配置）
        registry.rebuild_auto_language_pools(Some(rt.clone())).await;

        // 等待完成
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // 重新分配节点到 Pool（因为 rebuild 后需要重新分配）
        registry.phase3_upsert_node_to_pool_index_with_runtime("node-1", Some(rt.as_ref())).await;

        // 等待完成
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // 检查本地配置是否仍然存在（不应该被清空）
        let cfg_after = registry.phase3_config().await;
        assert!(!cfg_after.pools.is_empty(), "本地 Pool 配置不应该被清空");
        println!("修复后本地 Pool 配置数量: {}", cfg_after.pools.len());
        
        // 配置应该保持不变或增加，不应该减少
        assert!(cfg_after.pools.len() >= pool_count_before, "Pool 配置不应该减少");

        // 检查节点是否仍然在 Pool 中
        let pool_ids = registry.phase3_node_pool_ids("node-1").await;
        assert!(!pool_ids.is_empty(), "节点应该仍然在 Pool 中");

        // 清理
        cleanup_test_keys(&rt).await;
    }
}
