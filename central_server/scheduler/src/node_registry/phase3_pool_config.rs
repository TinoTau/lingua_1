//! Phase 3 Pool 配置管理

use super::NodeRegistry;

impl NodeRegistry {
    pub async fn phase3_config(&self) -> crate::core::config::Phase3Config {
        self.phase3.read().await.clone()
    }

    pub async fn set_phase3_config(&self, cfg: crate::core::config::Phase3Config) {
        let mut w = self.phase3.write().await;
        let should_auto_generate = cfg.auto_generate_language_pools && cfg.pools.is_empty();
        *w = cfg.clone();
        drop(w);
        
        // 同步到 ManagementRegistry（如果已启用锁优化）
        self.sync_phase3_config_to_management(cfg.clone()).await;
        
        // 如果启用自动生成且 pools 为空，则自动生成
        // 注意：这里无法访问 phase2_runtime，会在后续的定期任务中从 Redis 读取
        if should_auto_generate {
            self.rebuild_auto_language_pools(None).await;
        }
        
        self.rebuild_phase3_pool_index(None).await;
        // Phase 3：pool 映射变化（pool_count/hash_seed 等）会影响 core cache 的 pool_id 归属
        self.rebuild_phase3_core_cache().await;
    }
}
