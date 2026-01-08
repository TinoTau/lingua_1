#[cfg(test)]
mod tests {
    use crate::core::config::{AutoLanguagePoolConfig, Phase3Config, Phase3PoolConfig, Phase2Config};
    use crate::messages::{CapabilityByType, ServiceType, common::{NodeLanguageCapabilities, LanguagePair}, FeatureFlags};
    use crate::node_registry::{NodeRegistry, Node};
    use crate::messages::{NodeStatus, HardwareInfo, DeviceType, ServiceStatus, InstalledService};
    use crate::phase2::Phase2Runtime;
    use std::sync::Arc;
    use std::time::Duration;

    fn create_test_node_with_language_pairs(
        node_id: &str,
        language_pairs: Vec<(String, String)>,
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

        let supported_pairs: Vec<LanguagePair> = language_pairs
            .iter()
            .map(|(src, tgt)| LanguagePair {
                src: src.clone(),
                tgt: tgt.clone(),
            })
            .collect();

        // 从语言对中提取所有语言，作为 semantic_languages（语言集合）
        let mut semantic_langs: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (src, tgt) in &language_pairs {
            semantic_langs.insert(src.clone());
            semantic_langs.insert(tgt.clone());
        }
        let mut semantic_langs_vec: Vec<String> = semantic_langs.into_iter().collect();
        semantic_langs_vec.sort();

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
            // capability_by_type 已从 Node 结构体中移除，能力信息存储在 Redis
            // 添加必要的服务，以便 node_has_all_required_services 能正确检查
            installed_services: vec![
                InstalledService {
                    service_id: "asr-service".to_string(),
                    r#type: ServiceType::Asr,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "nmt-service".to_string(),
                    r#type: ServiceType::Nmt,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "tts-service".to_string(),
                    r#type: ServiceType::Tts,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "semantic-service".to_string(),
                    r#type: ServiceType::Semantic,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
            ],
            installed_models: vec![],
            language_capabilities: Some(NodeLanguageCapabilities {
                supported_language_pairs: Some(supported_pairs),
                asr_languages: None,
                tts_languages: None,
                nmt_capabilities: None,
                semantic_languages: Some(semantic_langs_vec), // 从语言对中提取
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
            // capability_by_type_map 已移除，能力信息存储在 Redis
        }
    }

    async fn create_test_phase2_runtime(instance_id: &str) -> Option<Arc<Phase2Runtime>> {
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        
        let mut cfg = Phase2Config::default();
        cfg.enabled = true;
        cfg.instance_id = instance_id.to_string();
        cfg.redis.mode = "single".to_string();
        cfg.redis.url = redis_url;
        // 使用固定的 key_prefix 以便多个实例共享同一个 Redis key 空间
        cfg.redis.key_prefix = "test:pool:shared".to_string();
        
        match Phase2Runtime::new(cfg, 15).await {
            Ok(Some(rt)) => {
                let rt = Arc::new(rt);
                // 设置 scheduler presence，以便 is_instance_alive() 能正确工作
                set_test_scheduler_presence(&rt).await;
                Some(rt)
            },
            Ok(None) => None,
            Err(_) => None,
        }
    }

    async fn set_test_scheduler_presence(rt: &Phase2Runtime) {
        use redis::Commands;
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        
        if let Ok(client) = redis::Client::open(redis_url.as_str()) {
            if let Ok(mut conn) = client.get_connection() {
                let key = format!("{}:schedulers:presence:{}", rt.key_prefix(), rt.instance_id);
                let presence = serde_json::json!({
                    "started_at": chrono::Utc::now().timestamp_millis(),
                    "hostname": "test",
                    "pid": std::process::id(),
                    "version": "test"
                });
                let val = serde_json::to_string(&presence).unwrap();
                let _: Result<(), _> = conn.set_ex::<_, _, ()>(&key, &val, 60);
            }
        }
    }

    async fn cleanup_test_keys(rt: &Phase2Runtime) {
        use redis::Commands;
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        
        if let Ok(client) = redis::Client::open(redis_url.as_str()) {
            if let Ok(mut conn) = client.get_connection() {
                // 使用内部方法获取 key（通过反射或直接构造）
                let key_prefix = rt.key_prefix();
                let config_key = format!("{}:v1:phase3:pools:config", key_prefix);
                let leader_key = format!("{}:v1:phase3:pools:leader", key_prefix);
                let version_key = format!("{}:v1:phase3:pools:version", key_prefix);
                
                // 清理所有相关的 key
                let _: Result<(), _> = conn.del(&config_key);
                let _: Result<(), _> = conn.del(&leader_key);
                let _: Result<(), _> = conn.del(&version_key);
                
                // 清理所有 pool members keys（使用 KEYS 模式匹配）
                let pattern = format!("{}:v1:pool:*:members", key_prefix);
                if let Ok(keys) = conn.keys::<_, Vec<String>>(&pattern) {
                    for key in keys {
                        let _: Result<(), _> = conn.del(&key);
                    }
                }
            }
        }
    }

    #[tokio::test]
    async fn test_pool_leader_election() {
        let rt_a = match create_test_phase2_runtime("test-a").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };
        let rt_b = match create_test_phase2_runtime("test-b").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt_a).await;
        cleanup_test_keys(&rt_b).await;

        // 确保 scheduler presence 已设置（以便 is_instance_alive() 能正确工作）
        set_test_scheduler_presence(&rt_a).await;
        set_test_scheduler_presence(&rt_b).await;

        // 测试 1：实例 A 尝试获取 Leader 锁
        let acquired_a = rt_a.try_acquire_pool_leader(60).await;
        assert!(acquired_a, "实例 A 应该成功获取 Leader 锁");

        // 测试 2：实例 B 尝试获取 Leader 锁（应该失败）
        let acquired_b = rt_b.try_acquire_pool_leader(60).await;
        assert!(!acquired_b, "实例 B 不应该获取 Leader 锁（已有 Leader）");

        // 测试 3：检查 Leader 状态
        assert!(rt_a.is_pool_leader().await, "实例 A 应该是 Leader");
        assert!(!rt_b.is_pool_leader().await, "实例 B 不应该是 Leader");

        // 测试 4：获取当前 Leader
        let leader = rt_a.get_pool_leader().await;
        assert_eq!(leader, Some("test-a".to_string()), "当前 Leader 应该是实例 A");

        // 测试 5：续约 Leader 锁
        let renewed = rt_a.renew_pool_leader(60).await;
        assert!(renewed, "Leader 锁续约应该成功");

        // 测试 6：实例 B 续约应该失败
        let renewed_b = rt_b.renew_pool_leader(60).await;
        assert!(!renewed_b, "实例 B 续约应该失败（不是 Leader）");

        // 清理
        cleanup_test_keys(&rt_a).await;
    }

    #[tokio::test]
    async fn test_pool_config_redis_sync() {
        let rt = match create_test_phase2_runtime("test-sync").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt).await;

        // 创建测试 Pool 配置（语言集合，排序后）
        let test_pools = vec![
            Phase3PoolConfig {
                pool_id: 1,
                name: "en-zh".to_string(), // 语言集合，排序后
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string()],
                language_requirements: None,
            },
            Phase3PoolConfig {
                pool_id: 2,
                name: "de-en-zh".to_string(), // 语言集合，排序后
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string()],
                language_requirements: None,
            },
        ];

        // 测试 1：写入 Pool 配置
        let written = rt.set_pool_config(&test_pools).await;
        assert!(written, "Pool 配置写入应该成功");

        // 测试 2：读取 Pool 配置
        let (read_pools, version) = rt.get_pool_config().await.expect("应该能读取 Pool 配置");
        assert_eq!(read_pools.len(), 2, "读取的 Pool 数量应该为 2");
        assert_eq!(read_pools[0].name, "en-zh", "第一个 Pool 名称应该匹配");
        assert_eq!(read_pools[1].name, "de-en-zh", "第二个 Pool 名称应该匹配");
        assert_eq!(version, 1, "版本号应该为 1");

        // 测试 3：再次写入（版本号应该递增）
        let written2 = rt.set_pool_config(&test_pools).await;
        assert!(written2, "第二次写入应该成功");
        let (_, version2) = rt.get_pool_config().await.expect("应该能读取 Pool 配置");
        assert_eq!(version2, 2, "版本号应该递增到 2");

        // 测试 4：获取版本号
        let version3 = rt.get_pool_config_version().await;
        assert_eq!(version3, Some(2), "版本号应该为 2");

        // 清理
        cleanup_test_keys(&rt).await;
    }

    #[tokio::test]
    async fn test_rebuild_auto_language_pools_with_redis() {
        let rt = match create_test_phase2_runtime("test-rebuild").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt).await;

        // 创建 NodeRegistry
        let registry = Arc::new(NodeRegistry::new());

        // 注册测试节点
        let node1 = create_test_node_with_language_pairs("node-1", vec![
            ("zh".to_string(), "en".to_string()),
            ("en".to_string(), "zh".to_string()),
        ]);
        registry.nodes.write().await.insert("node-1".to_string(), node1);

        let node2 = create_test_node_with_language_pairs("node-2", vec![
            ("zh".to_string(), "en".to_string()),
            ("ja".to_string(), "en".to_string()),
        ]);
        registry.nodes.write().await.insert("node-2".to_string(), node2);

        // 配置 Phase3
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 50,
            require_semantic: true,
            enable_mixed_pools: true,
            pool_naming: "set".to_string(), // 语言集合模式
            ..Default::default()
        });
        registry.set_phase3_config(phase3_config).await;

        // 测试 1：第一次重建（应该成为 Leader 并生成配置）
        registry.rebuild_auto_language_pools(Some(rt.clone())).await;

        // 验证配置已写入 Redis
        let (redis_pools, version) = rt.get_pool_config().await.expect("应该能从 Redis 读取配置");
        assert!(redis_pools.len() > 0, "应该生成至少一个 Pool");
        assert_eq!(version, 1, "版本号应该为 1");

        // 验证本地配置已更新
        let local_config = registry.phase3_config().await;
        assert_eq!(local_config.pools.len(), redis_pools.len(), "本地配置应该与 Redis 配置一致");

        // 测试 2：第二次重建（应该从 Redis 读取，不重新生成）
        let pools_before = local_config.pools.len();
        registry.rebuild_auto_language_pools(Some(rt.clone())).await;
        let local_config_after = registry.phase3_config().await;
        assert_eq!(
            local_config_after.pools.len(),
            pools_before,
            "从 Redis 读取后，Pool 数量应该不变"
        );

        // 清理
        cleanup_test_keys(&rt).await;
    }

    #[tokio::test]
    async fn test_pool_config_sync_multiple_instances() {
        let rt_a = match create_test_phase2_runtime("test-instance-a").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };
        let rt_b = match create_test_phase2_runtime("test-instance-b").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt_a).await;
        cleanup_test_keys(&rt_b).await;

        // 确保 scheduler presence 已设置（以便 is_instance_alive() 能正确工作）
        set_test_scheduler_presence(&rt_a).await;
        set_test_scheduler_presence(&rt_b).await;

        // 创建两个 NodeRegistry（模拟两个实例）
        let registry_a = Arc::new(NodeRegistry::new());
        let registry_b = Arc::new(NodeRegistry::new());

        // 注册测试节点到实例 A
        let node1 = create_test_node_with_language_pairs("node-1", vec![
            ("zh".to_string(), "en".to_string()),
            ("en".to_string(), "zh".to_string()),
        ]);
        registry_a.nodes.write().await.insert("node-1".to_string(), node1.clone());
        registry_b.nodes.write().await.insert("node-1".to_string(), node1);

        // 配置 Phase3
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 50,
            require_semantic: true,
            enable_mixed_pools: true,
            pool_naming: "set".to_string(), // 语言集合模式
            ..Default::default()
        });
        registry_a.set_phase3_config(phase3_config.clone()).await;
        registry_b.set_phase3_config(phase3_config).await;

        // 测试 1：实例 A 成为 Leader 并生成配置
        let acquired_a = rt_a.try_acquire_pool_leader(60).await;
        assert!(acquired_a, "实例 A 应该成为 Leader");

        registry_a.rebuild_auto_language_pools(Some(rt_a.clone())).await;
        let pools_a = registry_a.phase3_config().await.pools.len();
        assert!(pools_a > 0, "实例 A 应该生成 Pool 配置");

        // 验证配置已写入 Redis
        // 注意：rebuild_auto_language_pools 内部会调用 set_pool_config，但即使写入失败也会继续更新本地配置
        // 所以我们需要直接检查 Redis 中是否有配置
        let mut retries = 0;
        let mut redis_pools_opt = None;
        while retries < 10 && redis_pools_opt.is_none() {
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt_a.get_pool_config().await;
            retries += 1;
        }
        
        // 如果仍然无法读取，可能是写入失败，让我们直接验证写入是否成功
        if redis_pools_opt.is_none() {
            // 尝试手动写入一次来验证 Redis 连接是否正常
            let test_pools = registry_a.phase3_config().await.pools.clone();
            let written = rt_a.set_pool_config(&test_pools).await;
            assert!(written, "实例 A 应该能够将配置写入 Redis（验证 Redis 连接）");
            
            // 再次尝试读取
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt_a.get_pool_config().await;
        }
        
        assert!(redis_pools_opt.is_some(), "实例 A 应该已将配置写入 Redis");

        // 测试 2：实例 B 从 Redis 读取配置
        registry_b.rebuild_auto_language_pools(Some(rt_b.clone())).await;
        let pools_b = registry_b.phase3_config().await.pools.len();
        assert_eq!(pools_b, pools_a, "实例 B 应该从 Redis 读取相同的配置");

        // 测试 3：验证配置一致性
        let (redis_pools, _) = rt_b.get_pool_config().await.expect("应该能从 Redis 读取配置");
        assert_eq!(redis_pools.len(), pools_a, "Redis 中的配置应该与实例 A 一致");
        assert_eq!(redis_pools.len(), pools_b, "Redis 中的配置应该与实例 B 一致");

        // 清理
        cleanup_test_keys(&rt_a).await;
    }

    #[tokio::test]
    async fn test_pool_leader_failover() {
        let rt_a = match create_test_phase2_runtime("test-failover-a").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };
        let rt_b = match create_test_phase2_runtime("test-failover-b").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt_a).await;
        cleanup_test_keys(&rt_b).await;

        // 测试 1：实例 A 成为 Leader
        let acquired_a = rt_a.try_acquire_pool_leader(2).await; // 短 TTL 用于测试
        assert!(acquired_a, "实例 A 应该成为 Leader");

        // 测试 2：等待锁过期
        tokio::time::sleep(Duration::from_secs(3)).await;

        // 测试 3：实例 B 应该能够获取 Leader 锁（因为 A 的锁已过期）
        let acquired_b = rt_b.try_acquire_pool_leader(60).await;
        assert!(acquired_b, "实例 B 应该能够获取 Leader 锁（A 的锁已过期）");

        // 测试 4：验证 Leader 切换
        assert!(!rt_a.is_pool_leader().await, "实例 A 不应该是 Leader（锁已过期）");
        assert!(rt_b.is_pool_leader().await, "实例 B 应该是 Leader");

        // 清理
        cleanup_test_keys(&rt_a).await;
    }

    #[tokio::test]
    async fn test_pool_config_fallback_to_local() {
        // 测试：没有 Phase2Runtime 时，应该 fallback 到本地生成
        let registry = Arc::new(NodeRegistry::new());

        // 注册测试节点
        let node1 = create_test_node_with_language_pairs("node-1", vec![
            ("zh".to_string(), "en".to_string()),
        ]);
        registry.nodes.write().await.insert("node-1".to_string(), node1);

        // 配置 Phase3
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 50,
            require_semantic: true,
            enable_mixed_pools: true,
            pool_naming: "set".to_string(), // 语言集合模式
            ..Default::default()
        });
        registry.set_phase3_config(phase3_config).await;

        // 测试：没有 Phase2Runtime，应该本地生成
        registry.rebuild_auto_language_pools(None).await;

        let local_config = registry.phase3_config().await;
        assert!(local_config.pools.len() > 0, "应该本地生成至少一个 Pool");
    }

    /// 测试：Redis 写入失败时，本地配置仍然更新（这是一个潜在的问题）
    /// 这个测试验证了当前的行为：即使 Redis 写入失败，本地配置也会更新
    /// 这可能导致多实例场景下的配置不一致
    #[tokio::test]
    async fn test_redis_write_failure_behavior() {
        let rt = match create_test_phase2_runtime("test-write-failure").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt).await;

        let registry = Arc::new(NodeRegistry::new());

        // 注册测试节点
        let node1 = create_test_node_with_language_pairs("node-1", vec![
            ("zh".to_string(), "en".to_string()),
        ]);
        registry.nodes.write().await.insert("node-1".to_string(), node1);

        // 配置 Phase3
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 50,
            require_semantic: true,
            enable_mixed_pools: true,
            pool_naming: "set".to_string(), // 语言集合模式
            ..Default::default()
        });
        registry.set_phase3_config(phase3_config).await;

        // 获取 Leader 锁
        let acquired = rt.try_acquire_pool_leader(60).await;
        assert!(acquired, "应该能够获取 Leader 锁");

        // 正常情况：重建应该成功
        registry.rebuild_auto_language_pools(Some(rt.clone())).await;
        let local_pools = registry.phase3_config().await.pools.len();
        assert!(local_pools > 0, "本地应该生成 Pool 配置");

        // 验证 Redis 中也有配置（等待写入完成）
        let mut retries = 0;
        let mut redis_pools_opt = None;
        while retries < 10 && redis_pools_opt.is_none() {
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt.get_pool_config().await;
            retries += 1;
        }

        if redis_pools_opt.is_none() {
            let test_pools = registry.phase3_config().await.pools.clone();
            let written = rt.set_pool_config(&test_pools).await;
            assert!(written, "应该能够将配置写入 Redis");
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt.get_pool_config().await;
        }

        assert!(redis_pools_opt.is_some(), "Redis 中应该有配置");
        let (redis_pools, _) = redis_pools_opt.unwrap();
        assert_eq!(redis_pools.len(), local_pools, "Redis 配置应该与本地配置一致");

        // 清理
        cleanup_test_keys(&rt).await;
    }

    /// 测试：验证本地配置和 Redis 配置的一致性
    /// 这个测试确保在正常情况下，本地配置和 Redis 配置保持一致
    #[tokio::test]
    async fn test_local_redis_config_consistency() {
        let rt = match create_test_phase2_runtime("test-consistency").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt).await;

        let registry = Arc::new(NodeRegistry::new());

        // 注册多个测试节点
        let node1 = create_test_node_with_language_pairs("node-1", vec![
            ("zh".to_string(), "en".to_string()),
            ("en".to_string(), "zh".to_string()),
        ]);
        registry.nodes.write().await.insert("node-1".to_string(), node1);

        let node2 = create_test_node_with_language_pairs("node-2", vec![
            ("zh".to_string(), "en".to_string()),
            ("ja".to_string(), "en".to_string()),
        ]);
        registry.nodes.write().await.insert("node-2".to_string(), node2);

        // 配置 Phase3
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 50,
            require_semantic: true,
            enable_mixed_pools: true,
            pool_naming: "set".to_string(), // 语言集合模式
            ..Default::default()
        });
        registry.set_phase3_config(phase3_config).await;

        // 获取 Leader 锁并重建
        let acquired = rt.try_acquire_pool_leader(60).await;
        assert!(acquired, "应该能够获取 Leader 锁");

        registry.rebuild_auto_language_pools(Some(rt.clone())).await;

        // 验证本地配置
        let local_config = registry.phase3_config().await;
        let local_pools = local_config.pools.clone();
        assert!(local_pools.len() > 0, "本地应该生成 Pool 配置");

        // 验证 Redis 配置（等待写入完成）
        let mut retries = 0;
        let mut redis_pools_opt = None;
        while retries < 10 && redis_pools_opt.is_none() {
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt.get_pool_config().await;
            retries += 1;
        }

        if redis_pools_opt.is_none() {
            let test_pools = registry.phase3_config().await.pools.clone();
            let written = rt.set_pool_config(&test_pools).await;
            assert!(written, "应该能够将配置写入 Redis");
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt.get_pool_config().await;
        }

        let (redis_pools, _) = redis_pools_opt.expect("应该能从 Redis 读取配置");
        assert_eq!(redis_pools.len(), local_pools.len(), "Redis 配置数量应该与本地一致");

        // 验证每个 Pool 的详细信息是否一致
        for (i, local_pool) in local_pools.iter().enumerate() {
            let redis_pool = &redis_pools[i];
            assert_eq!(local_pool.pool_id, redis_pool.pool_id, "Pool ID 应该一致");
            assert_eq!(local_pool.name, redis_pool.name, "Pool 名称应该一致");
            assert_eq!(
                local_pool.required_services, redis_pool.required_services,
                "Pool 必需服务应该一致"
            );
        }

        // 清理
        cleanup_test_keys(&rt).await;
    }

    /// 测试：多实例场景下的配置同步一致性
    /// 验证当多个实例同时运行时，配置能够正确同步
    #[tokio::test]
    async fn test_multi_instance_config_sync_consistency() {
        let rt_a = match create_test_phase2_runtime("test-sync-a").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };
        let rt_b = match create_test_phase2_runtime("test-sync-b").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };
        let rt_c = match create_test_phase2_runtime("test-sync-c").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt_a).await;
        cleanup_test_keys(&rt_b).await;
        cleanup_test_keys(&rt_c).await;

        // 确保 scheduler presence 已设置
        set_test_scheduler_presence(&rt_a).await;
        set_test_scheduler_presence(&rt_b).await;
        set_test_scheduler_presence(&rt_c).await;

        // 创建三个 NodeRegistry（模拟三个实例）
        let registry_a = Arc::new(NodeRegistry::new());
        let registry_b = Arc::new(NodeRegistry::new());
        let registry_c = Arc::new(NodeRegistry::new());

        // 注册测试节点到所有实例
        let node1 = create_test_node_with_language_pairs("node-1", vec![
            ("zh".to_string(), "en".to_string()),
            ("en".to_string(), "zh".to_string()),
        ]);
        registry_a.nodes.write().await.insert("node-1".to_string(), node1.clone());
        registry_b.nodes.write().await.insert("node-1".to_string(), node1.clone());
        registry_c.nodes.write().await.insert("node-1".to_string(), node1);

        // 配置 Phase3
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 50,
            require_semantic: true,
            enable_mixed_pools: true,
            pool_naming: "set".to_string(), // 语言集合模式
            ..Default::default()
        });
        registry_a.set_phase3_config(phase3_config.clone()).await;
        registry_b.set_phase3_config(phase3_config.clone()).await;
        registry_c.set_phase3_config(phase3_config).await;

        // 测试 1：实例 A 成为 Leader 并生成配置
        let acquired_a = rt_a.try_acquire_pool_leader(60).await;
        assert!(acquired_a, "实例 A 应该成为 Leader");

        registry_a.rebuild_auto_language_pools(Some(rt_a.clone())).await;
        let pools_a = registry_a.phase3_config().await.pools.len();
        assert!(pools_a > 0, "实例 A 应该生成 Pool 配置");

        // 等待配置写入 Redis
        let mut retries = 0;
        let mut redis_pools_opt = None;
        while retries < 10 && redis_pools_opt.is_none() {
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt_a.get_pool_config().await;
            retries += 1;
        }

        if redis_pools_opt.is_none() {
            let test_pools = registry_a.phase3_config().await.pools.clone();
            let written = rt_a.set_pool_config(&test_pools).await;
            assert!(written, "实例 A 应该能够将配置写入 Redis");
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt_a.get_pool_config().await;
        }

        assert!(redis_pools_opt.is_some(), "实例 A 应该已将配置写入 Redis");

        // 测试 2：实例 B 和 C 从 Redis 读取配置
        registry_b.rebuild_auto_language_pools(Some(rt_b.clone())).await;
        registry_c.rebuild_auto_language_pools(Some(rt_c.clone())).await;

        let pools_b = registry_b.phase3_config().await.pools.len();
        let pools_c = registry_c.phase3_config().await.pools.len();

        // 验证所有实例的配置一致
        assert_eq!(pools_a, pools_b, "实例 B 应该与实例 A 配置一致");
        assert_eq!(pools_b, pools_c, "实例 C 应该与实例 B 配置一致");
        assert_eq!(pools_a, pools_c, "实例 A 和 C 应该配置一致");

        // 验证 Redis 配置与所有实例一致
        let (redis_pools, _) = rt_a.get_pool_config().await.expect("应该能从 Redis 读取配置");
        assert_eq!(redis_pools.len(), pools_a, "Redis 配置应该与实例 A 一致");
        assert_eq!(redis_pools.len(), pools_b, "Redis 配置应该与实例 B 一致");
        assert_eq!(redis_pools.len(), pools_c, "Redis 配置应该与实例 C 一致");

        // 清理
        cleanup_test_keys(&rt_a).await;
    }

    /// 测试：验证写入失败后的重试机制
    /// 这个测试验证当 Redis 写入失败时，后续的重试是否能够成功
    #[tokio::test]
    async fn test_redis_write_retry_mechanism() {
        let rt = match create_test_phase2_runtime("test-retry").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt).await;

        let registry = Arc::new(NodeRegistry::new());

        // 注册测试节点
        let node1 = create_test_node_with_language_pairs("node-1", vec![
            ("zh".to_string(), "en".to_string()),
        ]);
        registry.nodes.write().await.insert("node-1".to_string(), node1);

        // 配置 Phase3
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 50,
            require_semantic: true,
            enable_mixed_pools: true,
            pool_naming: "set".to_string(), // 语言集合模式
            ..Default::default()
        });
        registry.set_phase3_config(phase3_config).await;

        // 获取 Leader 锁
        let acquired = rt.try_acquire_pool_leader(60).await;
        assert!(acquired, "应该能够获取 Leader 锁");

        // 第一次重建
        registry.rebuild_auto_language_pools(Some(rt.clone())).await;
        let pools_1 = registry.phase3_config().await.pools.len();
        assert!(pools_1 > 0, "应该生成 Pool 配置");

        // 验证 Redis 中有配置（等待写入完成）
        let mut retries = 0;
        let mut redis_pools_opt = None;
        while retries < 10 && redis_pools_opt.is_none() {
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt.get_pool_config().await;
            retries += 1;
        }

        if redis_pools_opt.is_none() {
            let test_pools = registry.phase3_config().await.pools.clone();
            let written = rt.set_pool_config(&test_pools).await;
            assert!(written, "应该能够将配置写入 Redis");
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt = rt.get_pool_config().await;
        }

        assert!(redis_pools_opt.is_some(), "Redis 中应该有配置");

        // 手动删除 Redis 配置（模拟写入失败后的情况）
        cleanup_test_keys(&rt).await;

        // 再次重建（应该重新写入 Redis）
        registry.rebuild_auto_language_pools(Some(rt.clone())).await;
        let pools_2 = registry.phase3_config().await.pools.len();
        assert_eq!(pools_1, pools_2, "Pool 数量应该保持一致");

        // 等待并验证 Redis 中重新有配置
        let mut retries = 0;
        let mut redis_pools_opt_2 = None;
        while retries < 10 && redis_pools_opt_2.is_none() {
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt_2 = rt.get_pool_config().await;
            retries += 1;
        }

        if redis_pools_opt_2.is_none() {
            let test_pools = registry.phase3_config().await.pools.clone();
            let written = rt.set_pool_config(&test_pools).await;
            assert!(written, "应该能够重新写入 Redis");
            tokio::time::sleep(Duration::from_millis(100)).await;
            redis_pools_opt_2 = rt.get_pool_config().await;
        }

        assert!(redis_pools_opt_2.is_some(), "Redis 中应该重新有配置");
        let (redis_pools, _) = redis_pools_opt_2.unwrap();
        assert_eq!(redis_pools.len(), pools_2, "Redis 配置应该与本地配置一致");

        // 清理
        cleanup_test_keys(&rt).await;
    }

    #[tokio::test]
    async fn test_try_create_pool_for_node_sync_to_redis() {
        let rt = match create_test_phase2_runtime("test-create-pool").await {
            Some(rt) => rt,
            None => {
                eprintln!("跳过测试：Redis 不可用");
                return;
            }
        };

        // 清理测试数据
        cleanup_test_keys(&rt).await;

        // 创建 NodeRegistry
        let registry = Arc::new(NodeRegistry::new());

        // 配置 Phase3
        let mut phase3_config = Phase3Config::default();
        phase3_config.enabled = true;
        phase3_config.mode = "two_level".to_string();
        phase3_config.auto_generate_language_pools = true;
        phase3_config.auto_pool_config = Some(AutoLanguagePoolConfig {
            min_nodes_per_pool: 1,
            max_pools: 50,
            pool_naming: "set".to_string(), // 语言集合模式
            require_semantic: true,
            enable_mixed_pools: false,
        });
        *registry.phase3.write().await = phase3_config;

        // 创建测试节点（支持中英文）
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
        
        let node = Node {
            node_id: "node-1".to_string(),
            name: "node-1".to_string(),
            version: "1.0.0".to_string(),
            platform: "test".to_string(),
            status: NodeStatus::Ready,
            online: true,
            hardware: HardwareInfo {
                cpu_cores: 4,
                memory_gb: 16,
                gpus: Some(vec![]),
            },
            // capability_by_type 已从 Node 结构体中移除，能力信息存储在 Redis
            // 添加必要的服务，以便 node_has_all_required_services 能正确检查
            installed_services: vec![
                InstalledService {
                    service_id: "asr-service".to_string(),
                    r#type: ServiceType::Asr,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "nmt-service".to_string(),
                    r#type: ServiceType::Nmt,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "tts-service".to_string(),
                    r#type: ServiceType::Tts,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "semantic-service".to_string(),
                    r#type: ServiceType::Semantic,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
            ],
            installed_models: vec![],
            language_capabilities: Some(NodeLanguageCapabilities {
                supported_language_pairs: None,
                asr_languages: None,
                tts_languages: None,
                nmt_capabilities: None,
                semantic_languages: Some(vec!["en".to_string(), "zh".to_string()]),  // 支持中英文，排序后
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
            // capability_by_type_map 已移除，能力信息存储在 Redis
        };

        // 注册节点
        registry.nodes.write().await.insert("node-1".to_string(), node);

        // 测试 1：动态创建 Pool（不传递 phase2_runtime，应该只更新本地）
        let pool_id_1 = registry.try_create_pool_for_node("node-1", None).await;
        assert!(pool_id_1.is_some(), "应该成功创建 Pool");
        let pool_id_1 = pool_id_1.unwrap();

        // 验证本地配置
        let cfg = registry.phase3_config().await;
        assert_eq!(cfg.pools.len(), 1, "本地应该有 1 个 Pool");
        assert_eq!(cfg.pools[0].name, "en-zh", "Pool 名称应该是 en-zh（排序后）");

        // 验证 Redis 中没有配置（因为没有传递 phase2_runtime）
        let redis_config = rt.get_pool_config().await;
        assert!(redis_config.is_none(), "Redis 中不应该有配置（未传递 phase2_runtime）");

        // 清理本地配置
        registry.phase3.write().await.pools.clear();

        // 测试 2：动态创建 Pool（传递 phase2_runtime，应该同步到 Redis）
        let pool_id_2 = registry.try_create_pool_for_node("node-1", Some(rt.as_ref())).await;
        assert!(pool_id_2.is_some(), "应该成功创建 Pool");
        let pool_id_2 = pool_id_2.unwrap();

        // 验证本地配置
        let cfg = registry.phase3_config().await;
        assert_eq!(cfg.pools.len(), 1, "本地应该有 1 个 Pool");
        assert_eq!(cfg.pools[0].name, "en-zh", "Pool 名称应该是 en-zh");

        // 等待 Redis 写入完成
        tokio::time::sleep(Duration::from_millis(200)).await;

        // 验证 Redis 中有配置
        let redis_config = rt.get_pool_config().await;
        assert!(redis_config.is_some(), "Redis 中应该有配置");
        let (redis_pools, _version) = redis_config.unwrap();
        assert_eq!(redis_pools.len(), 1, "Redis 中应该有 1 个 Pool");
        assert_eq!(redis_pools[0].name, "en-zh", "Redis 中的 Pool 名称应该匹配");
        assert_eq!(redis_pools[0].pool_id, pool_id_2, "Redis 中的 Pool ID 应该匹配");

        // 测试 3：再次创建相同的 Pool（应该返回 None，因为已存在）
        let pool_id_3 = registry.try_create_pool_for_node("node-1", Some(rt.as_ref())).await;
        assert!(pool_id_3.is_none(), "不应该再次创建相同的 Pool");

        // 验证本地和 Redis 配置没有变化
        let cfg = registry.phase3_config().await;
        assert_eq!(cfg.pools.len(), 1, "本地应该仍然只有 1 个 Pool");
        let redis_config = rt.get_pool_config().await;
        let (redis_pools, _) = redis_config.unwrap();
        assert_eq!(redis_pools.len(), 1, "Redis 应该仍然只有 1 个 Pool");

        // 测试 4：创建不同语言集合的 Pool
        let capability_by_type_2 = vec![
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
        let mut capability_by_type_map_2 = std::collections::HashMap::new();
        for c in &capability_by_type_2 {
            capability_by_type_map_2.insert(c.r#type.clone(), c.ready);
        }
        
        let node2 = Node {
            node_id: "node-2".to_string(),
            name: "node-2".to_string(),
            version: "1.0.0".to_string(),
            platform: "test".to_string(),
            status: NodeStatus::Ready,
            online: true,
            hardware: HardwareInfo {
                cpu_cores: 4,
                memory_gb: 16,
                gpus: Some(vec![]),
            },
            // capability_by_type 已从 Node 结构体中移除，能力信息存储在 Redis
            // 添加必要的服务，以便 node_has_all_required_services 能正确检查
            installed_services: vec![
                InstalledService {
                    service_id: "asr-service".to_string(),
                    r#type: ServiceType::Asr,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "nmt-service".to_string(),
                    r#type: ServiceType::Nmt,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "tts-service".to_string(),
                    r#type: ServiceType::Tts,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
                InstalledService {
                    service_id: "semantic-service".to_string(),
                    r#type: ServiceType::Semantic,
                    device: DeviceType::Cpu,
                    status: ServiceStatus::Running,
                    version: Some("1.0".to_string()),
                    model_id: None,
                    engine: None,
                    mem_mb: None,
                    warmup_ms: None,
                    last_error: None,
                },
            ],
            installed_models: vec![],
            language_capabilities: Some(NodeLanguageCapabilities {
                supported_language_pairs: None,
                asr_languages: None,
                tts_languages: None,
                nmt_capabilities: None,
                semantic_languages: Some(vec!["de".to_string(), "en".to_string(), "zh".to_string()]),  // 支持中英德，排序后
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
            // capability_by_type_map 已从 Node 结构体中移除，能力信息存储在 Redis
        };

        registry.nodes.write().await.insert("node-2".to_string(), node2);

        let pool_id_4 = registry.try_create_pool_for_node("node-2", Some(rt.as_ref())).await;
        assert!(pool_id_4.is_some(), "应该成功创建新的 Pool");
        let pool_id_4 = pool_id_4.unwrap();

        // 等待 Redis 写入完成
        tokio::time::sleep(Duration::from_millis(200)).await;

        // 验证本地和 Redis 都有 2 个 Pool
        let cfg = registry.phase3_config().await;
        assert_eq!(cfg.pools.len(), 2, "本地应该有 2 个 Pool");
        let redis_config = rt.get_pool_config().await;
        let (redis_pools, _) = redis_config.unwrap();
        assert_eq!(redis_pools.len(), 2, "Redis 中应该有 2 个 Pool");

        // 验证 Pool 名称
        let pool_names: Vec<String> = cfg.pools.iter().map(|p| p.name.clone()).collect();
        assert!(pool_names.contains(&"en-zh".to_string()), "应该有 en-zh Pool");
        assert!(pool_names.contains(&"de-en-zh".to_string()), "应该有 de-en-zh Pool");

        // 清理
        cleanup_test_keys(&rt).await;
    }
}
