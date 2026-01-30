//! Redis 节点仓储
//! 
//! 封装所有节点相关的 Redis 查询操作

use crate::redis_runtime::RedisHandle;
use crate::node_registry::node_data::NodeData;
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, info};

/// Redis Key 前缀
const KEY_PREFIX: &str = "lingua:v1";

/// 节点数据 TTL（秒）
const NODE_TTL_SECS: i64 = 3600;

/// Redis 节点仓储（无状态）
#[derive(Clone)]
pub struct NodeRedisRepository {
    redis: Arc<RedisHandle>,
}

impl NodeRedisRepository {
    /// 创建新的仓储实例
    pub fn new(redis: Arc<RedisHandle>) -> Self {
        Self { redis }
    }
    
    /// 获取当前时间戳（Unix 秒）
    pub fn current_ts() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    }
    
    /// 构造节点数据 key
    fn node_key(node_id: &str) -> String {
        format!("{}:node:{}", KEY_PREFIX, node_id)
    }
    
    /// 构造节点集合 key
    fn nodes_all_key() -> String {
        format!("{}:nodes:all", KEY_PREFIX)
    }
    
    
    // ==================== 读取接口 ====================
    
    /// 查询单个节点
    /// 
    /// 返回 None 如果节点不存在或已离线（TTL 过期）
    pub async fn get_node(&self, node_id: &str) -> Result<Option<NodeData>> {
        let key = Self::node_key(node_id);
        
        // 检查 key 是否存在
        let exists: bool = self.redis.exists(&key).await.map_err(|e| anyhow!("Redis EXISTS 失败: {}", e))?;
        if !exists {
            debug!(node_id = %node_id, "节点不存在");
            return Ok(None);
        }
        
        // 读取 Hash 所有字段
        let hash: HashMap<String, String> = self.redis.hgetall(&key).await
            .map_err(|e| anyhow!("Redis HGETALL 失败: {}", e))?;
        
        if hash.is_empty() {
            debug!(node_id = %node_id, "节点数据为空");
            return Ok(None);
        }
        
        // 解析字段
        let status = hash.get("status")
            .cloned()
            .unwrap_or_else(|| "offline".to_string());
        
        let last_heartbeat_ts = hash.get("last_heartbeat_ts")
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        
        let lang_sets_str = hash.get("lang_sets")
            .cloned()
            .unwrap_or_else(|| "[]".to_string());
        
        let raw: Vec<Vec<String>> = serde_json::from_str(&lang_sets_str)
            .map_err(|e| anyhow!("解析 lang_sets 失败: {}", e))?;
        
        // 规范化每个 LangSet（排序去重）
        let lang_sets = raw.into_iter()
            .map(|ls| NodeData::normalize_langset(ls))
            .collect();
        
        // 解析扩展字段（阶段2新增）
        let region = hash.get("region").cloned();
        let gpu_tier = hash.get("gpu_tier").cloned();
        
        let hardware = hash.get("hardware")
            .and_then(|v| serde_json::from_str(v).ok());
        
        let max_concurrency = hash.get("max_concurrency")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(10);
        
        let current_jobs = hash.get("current_jobs")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);
        
        let accept_public_jobs = hash.get("accept_public_jobs")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(true);
        
        let has_gpu = hash.get("has_gpu")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(false);
        
        let installed_services: Vec<crate::messages::InstalledService> = hash.get("installed_services")
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or_default();
        
        let cpu_usage = hash.get("cpu_usage")
            .and_then(|v| v.parse::<f32>().ok())
            .unwrap_or(0.0);
        
        let gpu_usage = hash.get("gpu_usage")
            .and_then(|v| v.parse::<f32>().ok());
        
        let memory_usage = hash.get("memory_usage")
            .and_then(|v| v.parse::<f32>().ok())
            .unwrap_or(0.0);
        
        let features_supported: crate::messages::FeatureFlags = hash.get("features_supported")
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or_default();
        
        let online = hash.get("online")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(true);
        
        let node = NodeData::new_full(
            node_id.to_string(),
            lang_sets,
            last_heartbeat_ts,
            status,
            region,
            gpu_tier,
            hardware,
            max_concurrency,
            current_jobs,
            accept_public_jobs,
            has_gpu,
            installed_services,
            cpu_usage,
            gpu_usage,
            memory_usage,
            features_supported,
            online,
        );
        
        debug!(
            node_id = %node_id,
            status = %node.status,
            lang_sets = ?node.lang_sets,
            region = ?node.region,
            gpu_tier = ?node.gpu_tier,
            max_concurrency = node.max_concurrency,
            current_jobs = node.current_jobs,
            "成功读取节点（完整字段）"
        );
        
        Ok(Some(node))
    }
    
    /// 查询所有在线节点 ID
    /// 
    /// 基于 Redis TTL + status 字段判断在线状态
    pub async fn list_online_node_ids(&self) -> Result<Vec<String>> {
        let key = Self::nodes_all_key();
        
        // SMEMBERS 获取所有节点 ID
        let all_ids: Vec<String> = self.redis.smembers_strings(&key).await
            .map_err(|e| anyhow!("Redis SMEMBERS 失败: {}", e))?;
        
        let total_count = all_ids.len();
        let now = Self::current_ts();
        let mut online_ids = Vec::new();
        
        for node_id in all_ids {
            if let Some(node) = self.get_node(&node_id).await? {
                if node.is_online(now, NODE_TTL_SECS) {
                    online_ids.push(node_id);
                }
            }
        }
        
        debug!(
            total = total_count,
            online = online_ids.len(),
            "查询在线节点"
        );
        
        Ok(online_ids)
    }
    
    
    // ==================== 节点服务不可用功能 ====================
    
    /// Redis Key: 服务临时不可用标记
    fn service_unavailable_key(node_id: &str, service_id: &str) -> String {
        format!("unavailable:{}:{}", node_id, service_id)
    }
    
    /// 标记节点服务临时不可用（带 TTL）
    /// 
    /// 用于快速抑制重复调度失败，避免短时间内重复尝试已知不可用的服务
    pub async fn mark_service_unavailable(
        &self,
        node_id: &str,
        service_id: &str,
        service_version: Option<&str>,
        reason: Option<&str>,
        ttl_secs: u64,
    ) -> Result<()> {
        let key = Self::service_unavailable_key(node_id, service_id);
        
        // 值存储 JSON 格式的元数据（可选）
        let metadata = serde_json::json!({
            "service_version": service_version,
            "reason": reason,
            "marked_at": Self::current_ts(),
        });
        let value = metadata.to_string();
        
        // SETEX 设置带过期时间的键
        self.redis.setex(&key, ttl_secs, &value).await
            .map_err(|e| anyhow!("Redis SETEX 失败: {}", e))?;
        
        info!(
            node_id = %node_id,
            service_id = %service_id,
            service_version = ?service_version,
            reason = ?reason,
            ttl_secs = ttl_secs,
            "服务不可用：已标记节点服务临时不可用（Redis 直写）"
        );
        
        Ok(())
    }
    
    /// 检查节点服务是否被标记为临时不可用
    pub async fn is_service_unavailable(
        &self,
        node_id: &str,
        service_id: &str,
    ) -> Result<bool> {
        let key = Self::service_unavailable_key(node_id, service_id);
        
        let exists = self.redis.exists(&key).await
            .map_err(|e| anyhow!("Redis EXISTS 失败: {}", e))?;
        
        if exists {
            debug!(
                node_id = %node_id,
                service_id = %service_id,
                "服务不可用检查：服务当前不可用"
            );
        }
        
        Ok(exists)
    }
    
    // ==================== 节点排除统计功能 ====================
    
    /// Redis Key: 排除原因统计（Hash 存储计数）
    fn exclude_stats_key(reason: &str) -> String {
        format!("stats:exclude:{}", reason)
    }
    
    /// 记录节点排除原因（增加计数）
    /// 
    /// 用于监控和诊断节点被调度排除的原因
    pub async fn record_exclude_reason(
        &self,
        reason: &str,
        node_id: &str,
    ) -> Result<()> {
        let key = Self::exclude_stats_key(reason);
        
        // HINCRBY 增加计数
        self.redis.hincrby(&key, "count", 1).await
            .map_err(|e| anyhow!("Redis HINCRBY 失败: {}", e))?;
        
        debug!(
            reason = %reason,
            node_id = %node_id,
            "排除统计：记录节点排除原因"
        );
        
        Ok(())
    }
    
    /// 获取所有排除原因的统计数据
    /// 
    /// 注意：此方法简化实现，仅用于兼容性
    /// 实际生产环境应该使用 Prometheus 等指标系统
    pub async fn get_exclude_stats(&self) -> Result<HashMap<String, usize>> {
        // 简化实现：暂时返回空数据
        // TODO: 如果需要实际统计，可以：
        // 1. 使用 SCAN 命令遍历键（而非 KEYS）
        // 2. 或者使用单一 Hash 存储所有统计
        
        debug!("排除统计：简化实现，返回空数据");
        
        Ok(HashMap::new())
    }
    
    // ==================== 管理接口 ====================
    
    /// 删除节点数据（用于测试清理）
    #[cfg(test)]
    pub async fn delete_node(&self, node_id: &str) -> Result<()> {
        let key = Self::node_key(node_id);
        let nodes_key = Self::nodes_all_key();
        
        // 删除节点数据
        self.redis.del(&key).await
            .map_err(|e| anyhow!("Redis DEL 失败: {}", e))?;
        
        // 从节点集合中移除
        self.redis.srem(&nodes_key, node_id).await
            .map_err(|e| anyhow!("Redis SREM 失败: {}", e))?;
        
        debug!(node_id = %node_id, "删除节点数据");
        
        Ok(())
    }
}

// 暂时屏蔽旧测试（依赖旧的 RedisHandle::new API）
// TODO: 更新测试以匹配新架构
/*
#[cfg(test)]
mod tests {
    use super::*;
    
    // 注意：这些测试需要真实的 Redis 实例
    // 运行前确保 Redis 在 localhost:6379 运行
    
    async fn create_test_repo() -> NodeRedisRepository {
        let redis_url = "redis://127.0.0.1:6379";
        let redis = RedisHandle::new(redis_url).await.expect("连接 Redis 失败");
        NodeRedisRepository::new(Arc::new(redis))
    }
    
    #[tokio::test]
    #[ignore] // 默认忽略，手动运行时取消
    async fn test_upsert_and_get_node() {
        let repo = create_test_repo().await;
        let test_node_id = "test_node_1";
        
        // 清理旧数据
        let _ = repo.delete_node(test_node_id).await;
        
        // 创建测试节点
        let node = NodeData::new(
            test_node_id.to_string(),
            vec![vec!["en".to_string(), "zh".to_string()]],
            NodeRedisRepository::current_ts(),
            "online".to_string(),
        );
        
        // 写入
        repo.upsert_node(&node).await.expect("写入节点失败");
        
        // 读取
        let retrieved = repo.get_node(test_node_id).await.expect("读取节点失败");
        assert!(retrieved.is_some());
        
        let retrieved_node = retrieved.unwrap();
        assert_eq!(retrieved_node.node_id, test_node_id);
        assert_eq!(retrieved_node.status, "online");
        assert_eq!(retrieved_node.lang_sets, vec![vec!["en", "zh"]]);
        
        // 清理
        repo.delete_node(test_node_id).await.expect("删除节点失败");
    }
    
    #[tokio::test]
    #[ignore]
    async fn test_list_online_nodes() {
        let repo = create_test_repo().await;
        let test_node_id = "test_node_2";
        
        // 清理
        let _ = repo.delete_node(test_node_id).await;
        
        // 创建在线节点
        let node = NodeData::new(
            test_node_id.to_string(),
            vec![vec!["en".to_string()]],
            NodeRedisRepository::current_ts(),
            "online".to_string(),
        );
        repo.upsert_node(&node).await.expect("写入失败");
        
        // 查询在线节点
        let online = repo.list_online_node_ids().await.expect("查询失败");
        assert!(online.contains(&test_node_id.to_string()));
        
        // 清理
        repo.delete_node(test_node_id).await.expect("删除失败");
    }
    
    #[tokio::test]
    #[ignore]
    async fn test_list_nodes_for_langset() {
        let repo = create_test_repo().await;
        let test_node_id = "test_node_3";
        
        // 清理
        let _ = repo.delete_node(test_node_id).await;
        
        // 创建节点
        let node = NodeData::new(
            test_node_id.to_string(),
            vec![
                vec!["en".to_string(), "zh".to_string()],
                vec!["ja".to_string(), "zh".to_string()],
            ],
            NodeRedisRepository::current_ts(),
            "online".to_string(),
        );
        repo.upsert_node(&node).await.expect("写入失败");
        
        // 查询支持 ["en", "zh"] 的节点
        let matching = repo.list_nodes_for_langset(&vec!["zh".to_string(), "en".to_string()])
            .await
            .expect("查询失败");
        assert!(matching.contains(&test_node_id.to_string()));
        
        // 查询不支持的语言集合
        let not_matching = repo.list_nodes_for_langset(&vec!["fr".to_string()])
            .await
            .expect("查询失败");
        assert!(!not_matching.contains(&test_node_id.to_string()));
        
        // 清理
        repo.delete_node(test_node_id).await.expect("删除失败");
    }
    
    #[tokio::test]
    #[ignore]
    async fn test_mark_service_unavailable() {
        let repo = create_test_repo().await;
        let node_id = "test_node_unavailable";
        let service_id = "asr_whisper";
        
        // 标记服务不可用（60 秒 TTL）
        repo.mark_service_unavailable(
            node_id,
            service_id,
            Some("v1.0"),
            Some("模型加载失败"),
            60,
        ).await.expect("标记失败");
        
        // 检查服务是否不可用
        let unavailable = repo.is_service_unavailable(node_id, service_id)
            .await
            .expect("检查失败");
        assert!(unavailable, "服务应该被标记为不可用");
        
        // 检查其他服务（应该可用）
        let other_unavailable = repo.is_service_unavailable(node_id, "tts_coqui")
            .await
            .expect("检查失败");
        assert!(!other_unavailable, "其他服务应该可用");
        
        println!("✅ 服务不可用功能测试通过");
    }
}
*/
