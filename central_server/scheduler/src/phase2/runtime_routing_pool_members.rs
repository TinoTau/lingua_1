// Phase 2 Pool 成员同步

use std::collections::HashSet;

impl Phase2Runtime {
    /// 同步单个 Pool 的成员索引到 Redis Set
    /// pool_name 格式: "zh-en" 或 "*-en" (混合池)
    /// node_ids: Pool 中的节点 ID 集合
    pub async fn sync_pool_members_to_redis(
        &self,
        pool_name: &str,
        node_ids: &HashSet<String>,
    ) -> bool {
        let key = self.pool_members_key(pool_name);
        
        // 使用 Lua 脚本原子性地更新 Redis Set
        // 1. 删除旧的 Set
        // 2. 如果 ARGV 不为空，添加新成员
        // 3. 设置 TTL (1 小时)
        let script = r#"
-- 删除旧的 Set
redis.call('DEL', KEYS[1])

-- 添加新成员
if #ARGV > 0 then
    redis.call('SADD', KEYS[1], unpack(ARGV))
end

-- 设置 TTL (1 小时)
redis.call('EXPIRE', KEYS[1], 3600)

return 1
"#;
        
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key);
        
        // 将 node_ids 作为 ARGV 传递
        for node_id in node_ids {
            cmd.arg(node_id);
        }
        
        match self.redis.query::<i64>(cmd).await {
            Ok(v) if v == 1 => {
                debug!(
                    pool_name = %pool_name,
                    node_count = node_ids.len(),
                    "Pool 成员索引已同步到 Redis"
                );
                true
            }
            Ok(_) => {
                warn!(
                    pool_name = %pool_name,
                    "Pool 成员索引同步到 Redis 失败"
                );
                false
            }
            Err(e) => {
                warn!(
                    error = %e,
                    pool_name = %pool_name,
                    "Pool 成员索引同步到 Redis 错误"
                );
                false
            }
        }
    }

    /// 从 Redis 读取 Pool 成员索引
    pub async fn get_pool_members_from_redis(
        &self,
        pool_name: &str,
    ) -> Option<HashSet<String>> {
        let key = self.pool_members_key(pool_name);
        match self.redis.smembers_strings(&key).await {
            Ok(members) => {
                Some(members.into_iter().collect())
            }
            Err(e) => {
                warn!(
                    error = %e,
                    pool_name = %pool_name,
                    "从 Redis 读取 Pool 成员索引失败"
                );
                None
            }
        }
    }

    /// 批量从 Redis 读取多个 Pool 的成员索引（并行）
    /// 返回 HashMap<pool_name, HashSet<node_id>>
    pub async fn get_pool_members_batch_from_redis(
        &self,
        pool_names: &[&str],
    ) -> HashMap<String, HashSet<String>> {
        let mut result = HashMap::new();
        
        // 并行读取多个 Pool 的成员（使用 tokio::join_all 优化性能）
        // 注意：这里使用 tokio::spawn 和 futures::future::join_all 来并行执行
        // 但为了简化，我们使用顺序读取（因为 Redis 连接可能不支持并发）
        // 如果需要真正的并行，可以使用 tokio::spawn 和 futures::future::join_all
        for pool_name in pool_names {
            match self.get_pool_members_from_redis(pool_name).await {
                Some(members) => {
                    result.insert(pool_name.to_string(), members);
                }
                None => {
                    // 如果读取失败，使用空集合
                    result.insert(pool_name.to_string(), HashSet::new());
                }
            }
        }
        
        result
    }

    /// 同步所有 Pool 成员索引到 Redis
    /// pool_index: HashMap<pool_id, HashSet<node_id>>
    /// pool_configs: Pool 配置列表（用于 pool_id -> pool_name 映射）
    pub async fn sync_all_pool_members_to_redis(
        &self,
        pool_index: &HashMap<u16, HashSet<String>>,
        pool_configs: &[Phase3PoolConfig],
    ) {
        // 建立 pool_id -> pool_name 映射
        let pool_id_to_name: HashMap<u16, String> = pool_configs
            .iter()
            .map(|p| (p.pool_id, p.name.clone()))
            .collect();
        
        // 同步每个 Pool 的成员索引
        for (pool_id, node_ids) in pool_index {
            if let Some(pool_name) = pool_id_to_name.get(pool_id) {
                let _ = self.sync_pool_members_to_redis(pool_name, node_ids).await;
            } else {
                // 如果找不到 pool_name，使用 pool_id 作为名称（fallback）
                let pool_name = format!("pool-{}", pool_id);
                debug!(
                    pool_id = pool_id,
                    "Pool 配置未找到，使用 pool_id 作为名称: {}",
                    pool_name
                );
                let _ = self.sync_pool_members_to_redis(&pool_name, node_ids).await;
            }
        }
    }

    /// 同步单个节点的 Pool 成员索引到 Redis
    /// 用于节点注册/心跳时更新
    pub async fn sync_node_pools_to_redis(
        &self,
        _node_id: &str,
        pool_ids: &HashSet<u16>,
        pool_configs: &[Phase3PoolConfig],
        pool_index: &HashMap<u16, HashSet<String>>,
    ) {
        // 建立 pool_id -> pool_name 映射
        let pool_id_to_name: HashMap<u16, String> = pool_configs
            .iter()
            .map(|p| (p.pool_id, p.name.clone()))
            .collect();
        
        // 为每个 Pool 更新成员索引
        for pool_id in pool_ids {
            if let Some(pool_name) = pool_id_to_name.get(pool_id) {
                // 从 pool_index 获取该 Pool 的所有节点
                if let Some(all_node_ids) = pool_index.get(pool_id) {
                    let _ = self.sync_pool_members_to_redis(pool_name, all_node_ids).await;
                }
            }
        }
    }

    /// 从 Redis 读取所有 Pool 的成员索引（pool_id -> HashSet<node_id>）
    /// 需要提供 pool_configs 以建立 pool_id -> pool_name 映射
    pub async fn get_all_pool_members_from_redis(
        &self,
        pool_configs: &[Phase3PoolConfig],
    ) -> HashMap<u16, HashSet<String>> {
        let mut result = HashMap::new();
        
        // 收集所有 pool_name
        let pool_names: Vec<(&str, u16)> = pool_configs
            .iter()
            .map(|p| (p.name.as_str(), p.pool_id))
            .collect();
        
        if pool_names.is_empty() {
            return result;
        }
        
        // 批量读取
        let pool_name_strs: Vec<&str> = pool_names.iter().map(|(name, _)| *name).collect();
        let members_map = self.get_pool_members_batch_from_redis(&pool_name_strs).await;
        
        // 将结果映射到 pool_id
        for (pool_name, pool_id) in pool_names {
            if let Some(members) = members_map.get(pool_name) {
                result.insert(pool_id, members.clone());
            } else {
                debug!(
                    pool_id = pool_id,
                    pool_name = %pool_name,
                    "从 Redis 读取 Pool 成员为空"
                );
                result.insert(pool_id, HashSet::new());
            }
        }
        
        result
    }

    /// 从 Redis 读取单个 Pool 的大小（节点数）
    pub async fn get_pool_size_from_redis(
        &self,
        pool_name: &str,
    ) -> usize {
        match self.get_pool_members_from_redis(pool_name).await {
            Some(members) => members.len(),
            None => 0,
        }
    }

    /// 从 Redis 批量读取多个 Pool 的大小
    pub async fn get_pool_sizes_from_redis(
        &self,
        pool_configs: &[Phase3PoolConfig],
    ) -> HashMap<u16, usize> {
        let mut result = HashMap::new();
        
        for pool_config in pool_configs {
            let size = self.get_pool_size_from_redis(&pool_config.name).await;
            result.insert(pool_config.pool_id, size);
        }
        
        result
    }

    /// 从 Redis 读取 Pool 的示例节点 ID（最多 limit 个）
    pub async fn get_pool_sample_node_ids_from_redis(
        &self,
        pool_name: &str,
        limit: usize,
    ) -> Vec<String> {
        match self.get_pool_members_from_redis(pool_name).await {
            Some(members) => {
                let mut node_ids: Vec<String> = members.into_iter().collect();
                node_ids.sort();
                node_ids.truncate(limit);
                node_ids
            }
            None => vec![],
        }
    }
}
