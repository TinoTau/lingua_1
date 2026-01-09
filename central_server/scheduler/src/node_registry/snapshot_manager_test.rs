//! 快照管理器单元测试

#[cfg(test)]
mod tests {
    use super::super::snapshot_manager::SnapshotManager;
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
    async fn test_snapshot_manager_new() {
        let (phase3, core_services) = create_test_config();
        let management = ManagementRegistry::new(phase3, core_services);
        let snapshot_manager = SnapshotManager::new(management).await;
        
        let snapshot = snapshot_manager.get_snapshot().await;
        assert_eq!(snapshot.nodes.len(), 0);
        assert_eq!(snapshot.version, 0);
    }

    #[tokio::test]
    async fn test_snapshot_manager_update_snapshot() {
        let (phase3, core_services) = create_test_config();
        let management = ManagementRegistry::new(phase3, core_services);
        let snapshot_manager = SnapshotManager::new(management.clone()).await;
        
        // 添加节点到管理状态
        management.update_node(
            "node-1".to_string(),
            create_test_node("node-1"),
            vec![1, 2],
        ).await;
        management.update_node(
            "node-2".to_string(),
            create_test_node("node-2"),
            vec![1],
        ).await;
        
        // 更新快照
        snapshot_manager.update_snapshot().await;
        
        let snapshot = snapshot_manager.get_snapshot().await;
        assert_eq!(snapshot.nodes.len(), 2);
        // update_snapshot 调用 update_nodes 和 update_lang_index，两者都会增加版本号
        // 所以版本号应该是 2（初始 0 -> update_nodes 1 -> update_lang_index 2）
        assert_eq!(snapshot.version, 2);
        
        let node1 = snapshot.get_node("node-1");
        assert!(node1.is_some());
        assert_eq!(node1.unwrap().node_id, "node-1");
    }

    #[tokio::test]
    async fn test_snapshot_manager_update_node_snapshot() {
        let (phase3, core_services) = create_test_config();
        let management = ManagementRegistry::new(phase3, core_services);
        let snapshot_manager = SnapshotManager::new(management.clone()).await;
        
        // 先全量更新
        management.update_node(
            "node-1".to_string(),
            create_test_node("node-1"),
            vec![1],
        ).await;
        snapshot_manager.update_snapshot().await;
        
        // 更新节点
        management.update_node(
            "node-1".to_string(),
            create_test_node("node-1"),
            vec![2, 3],
        ).await;
        
        // 增量更新
        snapshot_manager.update_node_snapshot("node-1").await;
        
        let snapshot = snapshot_manager.get_snapshot().await;
        let node1 = snapshot.get_node("node-1").unwrap();
        assert_eq!(node1.pool_ids.len(), 2);
        assert!(node1.pool_ids.contains(&2));
        assert!(node1.pool_ids.contains(&3));
    }

    #[tokio::test]
    async fn test_snapshot_manager_remove_node_snapshot() {
        let (phase3, core_services) = create_test_config();
        let management = ManagementRegistry::new(phase3, core_services);
        let snapshot_manager = SnapshotManager::new(management.clone()).await;
        
        // 添加节点
        management.update_node(
            "node-1".to_string(),
            create_test_node("node-1"),
            vec![1],
        ).await;
        snapshot_manager.update_snapshot().await;
        
        // 移除节点
        management.remove_node("node-1").await;
        snapshot_manager.remove_node_snapshot("node-1").await;
        
        let snapshot = snapshot_manager.get_snapshot().await;
        assert_eq!(snapshot.nodes.len(), 0);
    }

    #[tokio::test]
    async fn test_snapshot_manager_update_lang_index() {
        let (phase3, core_services) = create_test_config();
        let management = ManagementRegistry::new(phase3, core_services);
        let snapshot_manager = SnapshotManager::new(management.clone()).await;
        
        // 更新 Phase 3 配置
        let mut new_phase3 = management.read().await.phase3_config.clone();
        new_phase3.pool_count = 8;
        management.update_phase3_config(new_phase3).await;
        
        // 更新语言索引快照
        snapshot_manager.update_lang_index_snapshot().await;
        
        let snapshot = snapshot_manager.get_snapshot().await;
        assert_eq!(snapshot.version, 1);
    }

    #[tokio::test]
    async fn test_snapshot_manager_concurrent_reads() {
        let (phase3, core_services) = create_test_config();
        let management = ManagementRegistry::new(phase3, core_services);
        let snapshot_manager = SnapshotManager::new(management.clone()).await;
        
        // 添加节点
        for i in 1..=10 {
            management.update_node(
                format!("node-{}", i),
                create_test_node(&format!("node-{}", i)),
                vec![i as u16],
            ).await;
        }
        snapshot_manager.update_snapshot().await;
        
        // 并发读取（使用 futures_util 而不是 tokio::spawn，避免运行时问题）
        let handles: Vec<_> = (0..10)
            .map(|_| {
                let snapshot_manager = snapshot_manager.clone();
                async move {
                    let snapshot = snapshot_manager.get_snapshot().await;
                    snapshot.nodes.len()
                }
            })
            .collect();
        
        let results: Vec<_> = futures_util::future::join_all(handles).await;
        for result in results {
            assert_eq!(result, 10);
        }
    }
}
