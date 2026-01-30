use rand::seq::SliceRandom;
use rand::thread_rng;

use super::super::NodeRegistry;

impl NodeRegistry {
    /// 从候选节点中随机采样 k 个节点
    /// 如果候选节点数 <= k，返回全部节点
    /// 
    /// 注意：此方法仅用于测试，已废弃的Pool选择逻辑已删除
    #[cfg(test)]
    pub fn random_sample_nodes(candidates: &[String], sample_size: usize) -> Vec<String> {
        Self::random_sample_nodes_impl(candidates, sample_size)
    }

    fn random_sample_nodes_impl(candidates: &[String], sample_size: usize) -> Vec<String> {
        if candidates.len() <= sample_size {
            return candidates.to_vec();
        }
        let mut rng = thread_rng();
        let mut sampled: Vec<String> = candidates.choose_multiple(&mut rng, sample_size).cloned().collect();
        // 打乱顺序以保证随机性
        sampled.shuffle(&mut rng);
        sampled
    }

    // 以下方法已删除（Phase3废弃代码）：
    // - prefetch_pool_members() 
    // - select_node_from_pool()
    // 
    // 当前使用 PoolService.select_node() 进行节点选择
    // 参考：src/pool/pool_service.rs
}
