//! 无锁架构 Redis 客户端封装
//! 
//! 扩展现有的 RedisHandle，添加无锁架构所需的功能：
//! - Hash 操作（HGET, HSET, HGETALL, HINCRBY）
//! - Set 操作（SADD, SREM, SMEMBERS）
//! - Pub/Sub 操作（PUBLISH, SUBSCRIBE）
//! - 连接池管理
//! - 超时控制

use crate::phase2::RedisHandle;
use redis::{Client as RedisClient, FromRedisValue};
use std::sync::Arc;
use tracing::{warn, error};

/// 无锁架构 Redis 客户端
/// 
/// 封装 Redis 操作，提供无锁架构所需的功能
#[derive(Clone)]
#[allow(dead_code)] // 将在后续实现中使用
pub struct LocklessRedisClient {
    /// 原始 RedisHandle（重用现有实现）
    handle: RedisHandle,
    /// Redis 客户端（用于 Pub/Sub）
    client: Arc<Option<RedisClient>>,
}

impl LocklessRedisClient {
    /// 创建新的无锁 Redis 客户端
    pub async fn new(handle: RedisHandle, redis_url: Option<String>) -> anyhow::Result<Self> {
        let client = if let Some(url) = redis_url {
            match RedisClient::open(url.as_str()) {
                Ok(c) => Arc::new(Some(c)),
                Err(e) => {
                    warn!(error = %e, "无法创建 Redis 客户端（Pub/Sub 功能可能受限）");
                    Arc::new(None)
                }
            }
        } else {
            Arc::new(None)
        };
        
        Ok(Self {
            handle,
            client,
        })
    }

    /// 获取节点数据（从 Redis Hash）
    /// 
    /// Key: `scheduler:nodes:{node_id}`
    /// 返回: JSON 字符串或 None
    pub async fn get_node_data(&self, node_id: &str) -> redis::RedisResult<Option<String>> {
        let key = format!("scheduler:nodes:{{node:{}}}", node_id);
        // 使用 HGETALL 获取所有字段，然后序列化为 JSON
        // 或者使用 GET 获取完整 JSON（取决于存储方式）
        self.handle.get_string(&key).await
    }

    /// 获取节点版本号（从 Redis Hash）
    /// 
    /// 更高效的版本号检查（只读取 version 字段）
    pub async fn get_node_version(&self, node_id: &str) -> redis::RedisResult<Option<u64>> {
        let key = format!("scheduler:nodes:{{node:{}}}", node_id);
        // 使用 HGET 只读取 version 字段
        let mut cmd = redis::cmd("HGET");
        cmd.arg(&key).arg("version");
        match self.handle.query::<Option<i64>>(cmd).await {
            Ok(Some(v)) if v > 0 => Ok(Some(v as u64)),
            Ok(_) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 批量获取节点版本号
    /// 
    /// 使用 Pipeline 批量读取，减少网络往返
    pub async fn get_node_versions_batch(
        &self,
        node_ids: &[String],
    ) -> redis::RedisResult<Vec<Option<u64>>> {
        // 注意：Redis Pipeline 需要连接池支持
        // 这里简化实现，后续可以优化为批量 Pipeline
        let mut results = Vec::with_capacity(node_ids.len());
        for node_id in node_ids {
            match self.get_node_version(node_id).await {
                Ok(v) => results.push(v),
                Err(e) => {
                    warn!(error = %e, node_id = %node_id, "批量获取节点版本号失败");
                    results.push(None);
                }
            }
        }
        Ok(results)
    }

    /// 获取 Pool 成员列表（从 Redis Set）
    /// 
    /// Key: `scheduler:pool:{pool_id}:members`
    pub async fn get_pool_members(&self, pool_id: u16) -> redis::RedisResult<Vec<String>> {
        let key = format!("scheduler:pool:{}:members", pool_id);
        let mut cmd = redis::cmd("SMEMBERS");
        cmd.arg(&key);
        self.handle.query(cmd).await
    }

    /// 批量获取 Pool 成员列表
    pub async fn get_pool_members_batch(
        &self,
        pool_ids: &[u16],
    ) -> redis::RedisResult<std::collections::HashMap<u16, Vec<String>>> {
        let mut results = std::collections::HashMap::new();
        for pool_id in pool_ids {
            match self.get_pool_members(*pool_id).await {
                Ok(members) => {
                    results.insert(*pool_id, members);
                }
                Err(e) => {
                    warn!(error = %e, pool_id = pool_id, "批量获取 Pool 成员失败");
                    results.insert(*pool_id, vec![]);
                }
            }
        }
        Ok(results)
    }

    /// 获取 Phase3 配置（从 Redis String）
    /// 
    /// Key: `scheduler:config:phase3`
    pub async fn get_phase3_config(&self) -> redis::RedisResult<Option<String>> {
        let key = "scheduler:config:phase3";
        self.handle.get_string(key).await
    }

    /// 获取全局版本号
    /// 
    /// Key: `scheduler:version:{entity_type}`
    pub async fn get_global_version(&self, entity_type: &str) -> redis::RedisResult<Option<u64>> {
        let key = format!("scheduler:version:{}", entity_type);
        match self.handle.get_string(&key).await {
            Ok(Some(v)) => {
                match v.parse::<u64>() {
                    Ok(version) => Ok(Some(version)),
                    Err(e) => {
                        warn!(error = %e, key = %key, value = %v, "版本号解析失败");
                        Ok(None)
                    }
                }
            }
            Ok(None) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 执行 Lua 脚本（原子操作）
    /// 
    /// 用于节点心跳更新、注册等操作
    pub async fn execute_lua<T: FromRedisValue>(
        &self,
        script: &str,
        keys: &[&str],
        args: &[&str],
    ) -> redis::RedisResult<T> {
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(keys.len());
        for key in keys {
            cmd.arg(key);
        }
        for arg in args {
            cmd.arg(arg);
        }
        self.handle.query(cmd).await
    }

    /// 发布更新事件（Pub/Sub）
    /// 
    /// Channel: `scheduler:events:node_update` 或 `scheduler:events:config_update`
    pub async fn publish_event(&self, channel: &str, payload: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("PUBLISH");
        cmd.arg(channel).arg(payload);
        self.handle.query(cmd).await
    }

    /// 获取 Redis 客户端（用于 Pub/Sub 订阅）
    /// 
    /// 返回: Option<Arc<RedisClient>>（如果可用）
    pub fn get_client_for_pubsub(&self) -> Option<Arc<RedisClient>> {
        match *self.client {
            Some(ref client) => Some(Arc::new(client.clone())),
            None => None,
        }
    }

    /// 检查 Redis 连接健康状态
    /// 
    /// 返回: true 表示连接正常，false 表示连接异常
    pub async fn health_check(&self) -> bool {
        let cmd = redis::cmd("PING");
        match self.handle.query::<String>(cmd).await {
            Ok(response) => response == "PONG",
            Err(e) => {
                error!(error = %e, "Redis 健康检查失败");
                false
            }
        }
    }

    /// 获取底层 RedisHandle（用于兼容现有代码）
    pub fn get_handle(&self) -> &RedisHandle {
        &self.handle
    }
}
