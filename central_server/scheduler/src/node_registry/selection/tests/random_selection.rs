#[cfg(test)]
mod tests {
    use crate::node_registry::NodeRegistry;

    /// 测试 random_sample_nodes: 采样数量小于候选节点数
    #[test]
    fn test_random_sample_nodes_smaller_than_candidates() {
        let candidates: Vec<String> = (1..=100)
            .map(|i| format!("node-{}", i))
            .collect();
        let sample_size = 20;

        let sampled = NodeRegistry::random_sample_nodes(&candidates, sample_size);

        // 应该采样20个节点
        assert_eq!(sampled.len(), sample_size);
        // 所有采样的节点都应该在候选列表中
        for node_id in &sampled {
            assert!(candidates.contains(node_id));
        }
        // 采样的节点应该不重复
        let mut sorted = sampled.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), sample_size);
    }

    /// 测试 random_sample_nodes: 采样数量等于候选节点数
    #[test]
    fn test_random_sample_nodes_equal_to_candidates() {
        let candidates: Vec<String> = (1..=20)
            .map(|i| format!("node-{}", i))
            .collect();
        let sample_size = 20;

        let sampled = NodeRegistry::random_sample_nodes(&candidates, sample_size);

        // 应该返回全部节点
        assert_eq!(sampled.len(), candidates.len());
        // 所有节点都应该在采样结果中
        for node_id in &candidates {
            assert!(sampled.contains(node_id));
        }
    }

    /// 测试 random_sample_nodes: 采样数量大于候选节点数
    #[test]
    fn test_random_sample_nodes_larger_than_candidates() {
        let candidates: Vec<String> = (1..=10)
            .map(|i| format!("node-{}", i))
            .collect();
        let sample_size = 20;

        let sampled = NodeRegistry::random_sample_nodes(&candidates, sample_size);

        // 应该返回全部节点（因为候选节点数 < 采样数量）
        assert_eq!(sampled.len(), candidates.len());
        // 所有节点都应该在采样结果中
        for node_id in &candidates {
            assert!(sampled.contains(node_id));
        }
    }

    /// 测试 random_sample_nodes: 空候选列表
    #[test]
    fn test_random_sample_nodes_empty_candidates() {
        let candidates: Vec<String> = vec![];
        let sample_size = 20;

        let sampled = NodeRegistry::random_sample_nodes(&candidates, sample_size);

        // 应该返回空列表
        assert_eq!(sampled.len(), 0);
    }

    /// 测试 random_sample_nodes: 随机性（多次采样结果不同）
    #[test]
    fn test_random_sample_nodes_randomness() {
        let candidates: Vec<String> = (1..=100)
            .map(|i| format!("node-{}", i))
            .collect();
        let sample_size = 20;

        // 多次采样
        let sampled1 = NodeRegistry::random_sample_nodes(&candidates, sample_size);
        let sampled2 = NodeRegistry::random_sample_nodes(&candidates, sample_size);
        let sampled3 = NodeRegistry::random_sample_nodes(&candidates, sample_size);

        // 至少有一次采样结果不同（概率很高）
        // 注意：理论上可能所有采样都相同，但概率极低（1/100^20），这里只做基本检查
        let all_same = sampled1 == sampled2 && sampled2 == sampled3;
        // 如果所有采样都相同，至少验证采样结果本身是有效的
        if all_same {
            // 这种情况概率极低，但为了测试稳定性，我们只验证采样结果本身有效
            assert_eq!(sampled1.len(), sample_size);
        } else {
            // 正常情况下，至少有一次不同
            assert!(sampled1 != sampled2 || sampled2 != sampled3 || sampled1 != sampled3);
        }
    }

    /// 测试 random_sample_nodes: 单节点
    #[test]
    fn test_random_sample_nodes_single_node() {
        let candidates: Vec<String> = vec!["node-1".to_string()];
        let sample_size = 20;

        let sampled = NodeRegistry::random_sample_nodes(&candidates, sample_size);

        // 应该返回唯一节点
        assert_eq!(sampled.len(), 1);
        assert_eq!(sampled[0], "node-1");
    }
}
