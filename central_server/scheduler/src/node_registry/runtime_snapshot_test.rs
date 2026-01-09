//! 运行时快照单元测试

#[cfg(test)]
mod tests {
    use super::super::runtime_snapshot::{
        RuntimeSnapshot, NodeHealth, NodeCapabilities,
        PoolMembersCache, build_node_snapshot,
    };
    use super::super::pool_language_index::PoolLanguageIndex;
    use super::super::types::Node;
    use crate::messages::{NodeStatus, HardwareInfo, FeatureFlags, common::LanguagePair};

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
            language_capabilities: Some(crate::messages::common::NodeLanguageCapabilities {
                asr_languages: Some(vec!["zh".to_string(), "en".to_string()]),
                tts_languages: Some(vec!["zh".to_string(), "en".to_string()]),
                nmt_capabilities: None,
                semantic_languages: Some(vec!["zh".to_string(), "en".to_string()]),
                supported_language_pairs: Some(vec![
                    LanguagePair {
                        src: "zh".to_string(),
                        tgt: "en".to_string(),
                    },
                ]),
            }),
        }
    }

    #[test]
    fn test_node_health_from_status() {
        assert_eq!(NodeHealth::from(NodeStatus::Ready), NodeHealth::Online);
        assert_eq!(NodeHealth::from(NodeStatus::Registering), NodeHealth::NotReady);
        assert_eq!(NodeHealth::from(NodeStatus::Degraded), NodeHealth::Online);
        assert_eq!(NodeHealth::from(NodeStatus::Draining), NodeHealth::Online);
        assert_eq!(NodeHealth::from(NodeStatus::Offline), NodeHealth::Offline);
    }

    #[test]
    fn test_build_node_snapshot() {
        let node = create_test_node("node-1");
        let pool_ids = vec![1, 2];
        
        let snapshot = build_node_snapshot("node-1".to_string(), &node, &pool_ids);
        
        assert_eq!(snapshot.node_id, "node-1");
        assert_eq!(snapshot.health, NodeHealth::Online);
        assert_eq!(snapshot.max_concurrency, 10);
        assert_eq!(snapshot.current_jobs, 0);
        assert_eq!(snapshot.accept_public_jobs, true);
        assert_eq!(snapshot.pool_ids.len(), 2);
        assert!(snapshot.pool_ids.contains(&1));
        assert!(snapshot.pool_ids.contains(&2));
        assert_eq!(snapshot.lang_pairs.len(), 1);
    }

    #[test]
    fn test_runtime_snapshot_new() {
        let lang_index = PoolLanguageIndex::new();
        let snapshot = RuntimeSnapshot::new(lang_index);
        
        assert_eq!(snapshot.nodes.len(), 0);
        assert_eq!(snapshot.version, 0);
    }

    #[tokio::test]
    async fn test_runtime_snapshot_update_nodes() {
        let lang_index = PoolLanguageIndex::new();
        let mut snapshot = RuntimeSnapshot::new(lang_index);
        
        use std::collections::HashMap;
        use std::sync::Arc;
        
        let mut node_map = HashMap::new();
        let node = create_test_node("node-1");
        let node_snapshot = build_node_snapshot("node-1".to_string(), &node, &vec![1]);
        node_map.insert("node-1".to_string(), Arc::new(node_snapshot));
        
        snapshot.update_nodes(node_map);
        
        assert_eq!(snapshot.nodes.len(), 1);
        assert_eq!(snapshot.version, 1);
        
        let node = snapshot.get_node("node-1");
        assert!(node.is_some());
        assert_eq!(node.unwrap().node_id, "node-1");
    }

    #[tokio::test]
    async fn test_runtime_snapshot_get_all_node_ids() {
        let lang_index = PoolLanguageIndex::new();
        let mut snapshot = RuntimeSnapshot::new(lang_index);
        
        use std::collections::HashMap;
        use std::sync::Arc;
        
        let mut node_map = HashMap::new();
        for i in 1..=5 {
            let node = create_test_node(&format!("node-{}", i));
            let node_snapshot = build_node_snapshot(format!("node-{}", i), &node, &vec![]);
            node_map.insert(format!("node-{}", i), Arc::new(node_snapshot));
        }
        
        snapshot.update_nodes(node_map);
        
        let node_ids = snapshot.get_all_node_ids();
        assert_eq!(node_ids.len(), 5);
        for i in 1..=5 {
            assert!(node_ids.contains(&format!("node-{}", i)));
        }
    }

    #[tokio::test]
    async fn test_pool_members_cache() {
        let mut cache = PoolMembersCache::new();
        
        assert_eq!(cache.get(1), None);
        
        cache.update(1, vec!["node-1".to_string(), "node-2".to_string()]);
        assert_eq!(cache.get(1).unwrap().len(), 2);
        assert!(cache.get(1).unwrap().contains(&"node-1".to_string()));
        
        cache.update(1, vec!["node-3".to_string()]);
        assert_eq!(cache.get(1).unwrap().len(), 1);
        
        // clear 方法已被移除，测试通过重新创建 cache 来验证
        let mut new_cache = PoolMembersCache::new();
        assert_eq!(new_cache.get(1), None);
    }

    #[tokio::test]
    async fn test_runtime_snapshot_pool_members() {
        let lang_index = PoolLanguageIndex::new();
        let snapshot = RuntimeSnapshot::new(lang_index);
        
        snapshot.update_pool_members(1, vec!["node-1".to_string(), "node-2".to_string()]).await;
        
        let members = snapshot.get_pool_members(1).await;
        assert_eq!(members.len(), 2);
        assert!(members.contains(&"node-1".to_string()));
        assert!(members.contains(&"node-2".to_string()));
        
        // 测试不存在的 pool
        let members2 = snapshot.get_pool_members(2).await;
        assert_eq!(members2.len(), 0);
    }

    #[tokio::test]
    async fn test_runtime_snapshot_stats() {
        let lang_index = PoolLanguageIndex::new();
        let mut snapshot = RuntimeSnapshot::new(lang_index);
        
        use std::collections::HashMap;
        use std::sync::Arc;
        
        let mut node_map = HashMap::new();
        let node = create_test_node("node-1");
        let node_snapshot = build_node_snapshot("node-1".to_string(), &node, &vec![]);
        node_map.insert("node-1".to_string(), Arc::new(node_snapshot));
        
        snapshot.update_nodes(node_map);
        
        // stats 方法已被移除，直接验证节点是否存在
        assert!(snapshot.get_node("node-1").is_some());
    }

    #[test]
    fn test_node_capabilities_default() {
        let caps = NodeCapabilities::default();
        assert_eq!(caps.asr_languages.len(), 0);
        assert_eq!(caps.tts_languages.len(), 0);
        assert_eq!(caps.semantic_languages.len(), 0);
    }
}
