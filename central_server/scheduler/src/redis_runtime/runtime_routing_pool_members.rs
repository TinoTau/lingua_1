// Phase 2 Pool 成员同步（已废弃 - 未使用）

use std::collections::HashSet;

impl RedisRuntime {
    // 以下方法已废弃，未在生产代码中使用
    #[allow(dead_code)]
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

    #[allow(dead_code)]
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

    #[allow(dead_code)]
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


    #[allow(dead_code)]
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
