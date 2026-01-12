//! 管理状态单元测试

#[cfg(test)]
mod tests {
    use super::super::management_state::ManagementRegistry;
    use super::super::types::Node;
    use crate::core::config::{Phase3Config, CoreServicesConfig};
    use crate::messages::{NodeStatus, HardwareInfo, FeatureFlags};

    fn create_test_node(node_id: &str) -> Node {
        Node {
            node_id: node_id.to_string(),
            name: format!("node-{}", node_id),
            version: "1.0.0".to_string(),
            platform: "linux".to_string(),
            hardware: HardwareInfo {
                cpu_cores: 4,
                memory_gb: 8,
                gpus: None,
            },
            status: NodeStatus::Ready,
            online: true,
            cpu_usage: 0.5,
            gpu_usage: None,
            memory_usage: 0.6,
            installed_models: vec![],
            installed_services: vec![],
            features_supported: FeatureFlags::default(),
            accept_public_jobs: true,
            current_jobs: 0,
            max_concurrent_jobs: 10,
            last_heartbeat: chrono::Utc::now(),
            registered_at: chrono::Utc::now(),
            processing_metrics: None,
            language_capabilities: None,
        }
    }

    fn create_test_config() -> (Phase3Config, CoreServicesConfig) {
        let phase3 = Phase3Config {
            enabled: true,
            mode: "two_level".to_string(),
            pool_count: 4,
            hash_seed: 0,
            fallback_scan_all_pools: true,
            pools: vec![],
            tenant_overrides: vec![],
            pool_match_scope: "core_only".to_string(),
            pool_match_mode: "contains".to_string(),
            strict_pool_eligibility: false,
            auto_generate_language_pools: false,
            auto_pool_config: None,
            random_sample_size: 20,
            enable_session_affinity: false,
        };

        let core_services = CoreServicesConfig {
            asr_service_id: "asr".to_string(),
            nmt_service_id: "nmt".to_string(),
            tts_service_id: "tts".to_string(),
        };

        (phase3, core_services)
    }

    #[tokio::test]
    async fn test_management_registry_new() {
        let (phase3, core_services) = create_test_config();
        let registry = ManagementRegistry::new(phase3.clone(), core_services.clone());
        
        let state = registry.read().await;
        assert_eq!(state.nodes.len(), 0);
        assert_eq!(state.phase3_config.enabled, phase3.enabled);
    }

    #[tokio::test]
    async fn test_management_registry_update_node() {
        let (phase3, core_services) = create_test_config();
        let registry = ManagementRegistry::new(phase3, core_services);
        
        let node = create_test_node("node-1");
        registry.update_node("node-1".to_string(), node.clone(), vec![1, 2]).await;
        
        let state = registry.read().await;
        assert_eq!(state.nodes.len(), 1);
        let node_state = state.get_node("node-1").unwrap();
        assert_eq!(node_state.node.node_id, "node-1");
        assert_eq!(node_state.pool_ids, vec![1, 2]);
    }

    #[tokio::test]
    async fn test_management_registry_remove_node() {
        let (phase3, core_services) = create_test_config();
        let registry = ManagementRegistry::new(phase3, core_services);
        
        let node = create_test_node("node-1");
        registry.update_node("node-1".to_string(), node, vec![1]).await;
        
        // 添加超时保护，避免测试卡住
        let removed = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            registry.remove_node("node-1")
        ).await;
        
        match removed {
            Ok(true) => {
                let state = registry.read().await;
                assert_eq!(state.nodes.len(), 0);
            },
            Ok(false) => panic!("应该成功移除节点"),
            Err(_) => panic!("remove_node 操作超时"),
        }
        
        // 测试移除不存在的节点
        let removed2 = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            registry.remove_node("node-2")
        ).await;
        
        match removed2 {
            Ok(false) => {
                // 预期结果：节点不存在，返回 false
            },
            Ok(true) => panic!("不应该成功移除不存在的节点"),
            Err(_) => panic!("remove_node 操作超时"),
        }
    }

    #[tokio::test]
    async fn test_management_registry_update_phase3_config() {
        let (phase3, core_services) = create_test_config();
        let registry = ManagementRegistry::new(phase3.clone(), core_services);
        
        let mut new_phase3 = phase3.clone();
        new_phase3.pool_count = 8;
        registry.update_phase3_config(new_phase3.clone()).await;
        
        let state = registry.read().await;
        assert_eq!(state.phase3_config.pool_count, 8);
    }

    #[tokio::test]
    async fn test_management_registry_update_node_pools() {
        let (phase3, core_services) = create_test_config();
        let registry = ManagementRegistry::new(phase3, core_services);
        
        let node = create_test_node("node-1");
        registry.update_node("node-1".to_string(), node, vec![1]).await;
        
        let new_pool_ids = vec![2, 3];
        registry.update_node_pools("node-1", new_pool_ids.clone()).await;
        
        let state = registry.read().await;
        let node_state = state.get_node("node-1").unwrap();
        assert_eq!(node_state.pool_ids, new_pool_ids);
    }

    #[tokio::test]
    async fn test_management_registry_get_all_node_ids() {
        let (phase3, core_services) = create_test_config();
        let registry = ManagementRegistry::new(phase3, core_services);
        
        registry.update_node("node-1".to_string(), create_test_node("node-1"), vec![]).await;
        registry.update_node("node-2".to_string(), create_test_node("node-2"), vec![]).await;
        registry.update_node("node-3".to_string(), create_test_node("node-3"), vec![]).await;
        
        let state = registry.read().await;
        let node_ids: Vec<String> = state.nodes.keys().cloned().collect();
        assert_eq!(node_ids.len(), 3);
        assert!(node_ids.contains(&"node-1".to_string()));
        assert!(node_ids.contains(&"node-2".to_string()));
        assert!(node_ids.contains(&"node-3".to_string()));
    }

    #[tokio::test]
    async fn test_management_state_concurrent_reads() {
        let (phase3, core_services) = create_test_config();
        let registry = ManagementRegistry::new(phase3, core_services);
        
        // 添加一些节点
        for i in 1..=10 {
            registry.update_node(
                format!("node-{}", i),
                create_test_node(&format!("node-{}", i)),
                vec![i as u16],
            ).await;
        }
        
        // 并发读取（使用 futures_util 而不是 tokio::spawn，避免运行时问题）
        let handles: Vec<_> = (0..10)
            .map(|_| {
                let registry = registry.clone();
                async move {
                    let state = registry.read().await;
                    state.nodes.len()
                }
            })
            .collect();
        
        let results: Vec<_> = futures_util::future::join_all(handles).await;
        for result in results {
            assert_eq!(result, 10);
        }
    }
}
