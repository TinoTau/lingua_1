//! 节点写入路径（无锁版本）
//! 
//! 实现节点心跳更新、注册、下线等写入操作，使用 Redis Lua 脚本保证原子性

use super::cache::{LocklessCache, CachedNodeSnapshot};
use super::pubsub::CacheEvent;
use tracing::warn;

impl LocklessCache {
    /// 更新节点心跳（原子操作，无锁）
    /// 
    /// 使用 Redis Lua 脚本保证原子性：
    /// 1. 获取当前版本号并递增
    /// 2. 更新节点数据（Hash）
    /// 3. 设置 TTL（30 秒，心跳超时自动过期）
    /// 4. 更新节点索引（在线节点集合）
    /// 5. 返回新版本号
        pub async fn update_node_heartbeat(
        &self,
        node_id: &str,
        heartbeat_data: &NodeHeartbeatData,
    ) -> Result<u64, redis::RedisError> {
        let node_key = format!("scheduler:nodes:{{node:{}}}", node_id);
        let online_index_key = "scheduler:nodes:index:online";
        
        // 步骤 1: 使用 Redis Lua 脚本保证原子性
        let script = r#"
-- 获取当前版本号
local version = redis.call('HGET', KEYS[1], 'version') or 0
version = tonumber(version) + 1

-- 更新节点数据（Hash）
-- 注意：pool_ids 已删除，Pool 归属由 PoolService 管理
redis.call('HSET', KEYS[1],
    'node_id', ARGV[1],
    'status', ARGV[2],
    'health', ARGV[3],
    'capabilities', ARGV[4],
    'resources', ARGV[5],
    'installed_services', ARGV[6],
    'features_supported', ARGV[7],
    'last_heartbeat_ms', ARGV[8],
    'version', version
)

-- 设置 TTL（30 秒，心跳超时则自动过期）
redis.call('EXPIRE', KEYS[1], 30)

-- 更新节点索引（如果是新节点或状态变化）
if ARGV[2] == 'online' then
    redis.call('SADD', KEYS[2], ARGV[1])
else
    redis.call('SREM', KEYS[2], ARGV[1])
end

-- 返回新版本号
return version
"#;
        
        // 步骤 2: 准备参数
        let capabilities_json = serde_json::to_string(&heartbeat_data.capabilities)
            .map_err(|e| redis::RedisError::from((
                redis::ErrorKind::TypeError,
                "序列化失败",
                format!("{}", e)
            )))?;
        let resources_json = serde_json::to_string(&heartbeat_data.resources)
            .map_err(|e| redis::RedisError::from((
                redis::ErrorKind::TypeError,
                "序列化失败",
                format!("{}", e)
            )))?;
        // pool_ids 已删除，不再序列化
        let services_json = serde_json::to_string(&heartbeat_data.installed_services)
            .map_err(|e| redis::RedisError::from((
                redis::ErrorKind::TypeError,
                "序列化失败",
                format!("{}", e)
            )))?;
        let features_json = serde_json::to_string(&heartbeat_data.features_supported)
            .map_err(|e| redis::RedisError::from((
                redis::ErrorKind::TypeError,
                "序列化失败",
                format!("{}", e)
            )))?;
        let timestamp_ms = chrono::Utc::now().timestamp_millis();
        
        // 步骤 3: 执行 Lua 脚本（原子操作）
        let new_version: i64 = self.redis_client.execute_lua(
            script,
            &[&node_key, online_index_key],
            &[
                node_id,
                "online",
                "Online",
                &capabilities_json,
                &resources_json,
                &services_json,
                &features_json,
                &timestamp_ms.to_string(),
            ],
        ).await?;
        
        let version = new_version as u64;
        
        // 步骤 4: 发布更新事件（通知其他实例）
        let event = CacheEvent {
            event_type: "node_heartbeat".to_string(),
            node_id: Some(node_id.to_string()),
            version: Some(version),
            timestamp_ms,
        };
        let event_json = serde_json::to_string(&event)
            .unwrap_or_else(|_| "{}".to_string());
        if let Err(e) = self.redis_client.publish_event("scheduler:events:node_update", &event_json).await {
            warn!(error = %e, node_id = %node_id, "发布节点更新事件失败");
        }
        
        // 步骤 5: 更新本地缓存（当前实例，异步执行，不阻塞心跳响应）
        let cache_clone = self.clone();
        let node_id_clone = node_id.to_string();
        let version_clone = version;
        tokio::spawn(async move {
            if let Some(node) = cache_clone.refresh_node_from_redis(&node_id_clone).await {
                let now_ms = chrono::Utc::now().timestamp_millis();
                let random_offset = (node_id_clone.len() as i64) % (cache_clone.config.random_ttl_range_ms as i64);
                let effective_ttl = cache_clone.config.l1_cache_ttl_ms + random_offset;
                cache_clone.l1_nodes.insert(node_id_clone.clone(), CachedNodeSnapshot {
                    snapshot: node,
                    version: version_clone,
                    cached_at_ms: now_ms,
                    l1_ttl_ms: effective_ttl,
                });
                cache_clone.version_manager.update_node_version(&node_id_clone, version_clone).await;
            }
        });
        
        Ok(version)
    }


    /// 移除节点（原子操作）
    /// 
    /// 使用 Redis Lua 脚本保证原子性：
    /// 1. 从节点数据 Hash 中删除
    /// 2. 从在线节点索引中移除
    /// 3. 从 Pool 成员索引中移除（如果节点在 Pool 中）
        pub async fn remove_node(&self, node_id: &str) -> Result<(), redis::RedisError> {
        let node_key = format!("scheduler:nodes:{{node:{}}}", node_id);
        let online_index_key = "scheduler:nodes:index:online";
        
        // 步骤 1: 使用 Redis Lua 脚本保证原子性
        let script = r#"
-- 获取节点的 pool_ids（如果存在）
local pool_ids_json = redis.call('HGET', KEYS[1], 'pool_ids')
local pool_ids = {}
if pool_ids_json then
    pool_ids = cjson.decode(pool_ids_json)
end

-- 从节点数据 Hash 中删除
redis.call('DEL', KEYS[1])

-- 从在线节点索引中移除
redis.call('SREM', KEYS[2], ARGV[1])

-- 从 Pool 成员索引中移除
for _, pool_id in ipairs(pool_ids) do
    redis.call('SREM', 'scheduler:pool:' .. pool_id .. ':members', ARGV[1])
end

return 1
"#;
        
        // 步骤 2: 执行 Lua 脚本（原子操作）
        self.redis_client.execute_lua::<i64>(
            script,
            &[&node_key, online_index_key],
            &[node_id],
        ).await?;
        
        // 步骤 3: 发布下线事件
        let event = CacheEvent {
            event_type: "node_offline".to_string(),
            node_id: Some(node_id.to_string()),
            version: None,
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
        };
        let event_json = serde_json::to_string(&event)
            .unwrap_or_else(|_| "{}".to_string());
        if let Err(e) = self.redis_client.publish_event("scheduler:events:node_update", &event_json).await {
            warn!(error = %e, node_id = %node_id, "发布节点下线事件失败");
        }
        
        // 步骤 4: 从本地缓存中移除
        self.l1_nodes.remove(node_id);
        {
            let mut l2_cache = self.l2_nodes.write().await;
            l2_cache.remove(node_id);
        }
        self.version_manager.remove_node_version(node_id).await;
        
        Ok(())
    }

}

/// 节点心跳数据
/// 
/// 注意：pool_ids 已删除，Pool 归属由 PoolService 管理
#[derive(Debug, Clone)]
pub struct NodeHeartbeatData {
    pub capabilities: super::serialization::RedisNodeCapabilities,
    pub resources: super::serialization::RedisNodeResources,
    pub installed_services: Vec<String>, // JSON 字符串数组
    pub features_supported: serde_json::Value,
}

/// 节点注册数据
/// 
/// 注意：pool_ids 已删除，Pool 归属由 PoolService 管理
#[derive(Debug, Clone)]
pub struct NodeRegistrationData {
    pub capabilities: super::serialization::RedisNodeCapabilities,
    pub resources: super::serialization::RedisNodeResources,
    pub installed_services: Vec<String>, // JSON 字符串数组
    pub features_supported: serde_json::Value,
}
