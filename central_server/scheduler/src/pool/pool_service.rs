//! PoolService：Pool 管理和节点选择

use crate::redis_runtime::RedisHandle;
use anyhow::{anyhow, Result};
use std::sync::Arc;
use tracing::{debug, info, warn};

pub struct PoolService {
    redis: Arc<RedisHandle>,
    scripts: ScriptsCache,
    /// 节点级 key 的 TTL（秒）。建议 3 × 心跳周期；持续心跳则刷新，否则自动过期，实现被动清理。
    node_ttl_secs: u64,
}

struct ScriptsCache {
    heartbeat_with_pool_assign: String,
    select_node: String,
    node_offline: String,
}

impl PoolService {
    /// 创建 PoolService。
    /// `heartbeat_interval_seconds`: 节点端心跳间隔（秒）。TTL = 3 × 该值，用于被动清理。
    pub async fn new(redis: Arc<RedisHandle>, heartbeat_interval_seconds: u64) -> Result<Self> {
        let scripts = Self::load_scripts();
        let interval = heartbeat_interval_seconds.max(1);
        let node_ttl_secs = (interval * 3).max(3);

        Ok(Self {
            redis,
            scripts,
            node_ttl_secs,
        })
    }
    
    fn load_scripts() -> ScriptsCache {
        ScriptsCache {
            heartbeat_with_pool_assign: include_str!("../../scripts/lua/heartbeat_with_pool_assign.lua").to_string(),
            select_node: include_str!("../../scripts/lua/select_node.lua").to_string(),
            node_offline: include_str!("../../scripts/lua/node_offline.lua").to_string(),
        }
    }
    
    /// 节点心跳（自动分配池）。每次心跳刷新 node / node:pools 的 TTL，实现被动清理。
    pub async fn heartbeat(&self, node_id: &str) -> Result<()> {
        debug!("节点心跳: {} (TTL={}s)", node_id, self.node_ttl_secs);

        let ttl = self.node_ttl_secs.to_string();
        let result: String = self.eval_script(
            &self.scripts.heartbeat_with_pool_assign,
            &[node_id, &ttl],
        ).await?;

        if result.starts_with("OK") {
            Ok(())
        } else {
            Err(anyhow!("心跳失败: {}", result))
        }
    }
    
    /// 选择节点（用于调度）
    /// 
    /// # 参数
    /// - `src_lang`: 源语言（ASR 识别的语言）
    /// - `tgt_lang`: 目标语言（TTS + Semantic 输出的语言）
    /// - `job_id`: 任务 ID（用于 timeout finalize 绑定）
    /// 
    /// # 示例
    /// 
    /// ```rust
    /// // Manual/Timeout finalize（不绑定节点）
    /// let node_id = pool_service.select_node("zh", "en", None, Some("session-123")).await?;
    /// 
    /// // Timeout finalize（绑定到同一节点）
    /// let node_id = pool_service.select_node("zh", "en", Some(&job_id), Some("session-123")).await?;
    /// ```
    pub async fn select_node(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        job_id: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<String> {
        // 生成有向语言对 key: "src:tgt"
        let pair_key = format!("{}:{}", src_lang, tgt_lang);
        let job_id_str = job_id.unwrap_or("");
        let session_id_str = session_id.unwrap_or("");
        
        info!(
            pair_key = %pair_key,
            job_id = ?job_id,
            session_id = ?session_id,
            "【节点选择】开始查找 Pool"
        );
        
        // 调用 Lua 脚本选择节点
        let result: Option<String> = self.eval_script(
            &self.scripts.select_node,
            &[&pair_key, job_id_str, session_id_str],
        ).await?;
        
        match result {
            Some(ref node_id) => {
                info!(
                    pair_key = %pair_key,
                    node_id = %node_id,
                    "【节点选择】成功"
                );
                Ok(node_id.clone())
            }
            None => {
                warn!(
                    pair_key = %pair_key,
                    "【节点选择】没有可用的节点（语言对无池或池为空）"
                );
                Err(anyhow!("没有可用的节点（语言对: {}）", pair_key))
            }
        }
    }
    
    /// 节点下线（从池中移除）
    pub async fn node_offline(&self, node_id: &str) -> Result<()> {
        debug!("节点下线: {}", node_id);

        let result: String = self.eval_script(
            &self.scripts.node_offline,
            &[node_id],
        ).await?;

        if !result.starts_with("OK") {
            return Err(anyhow!("节点下线处理失败: {}", result));
        }

        Ok(())
    }
    
    /// 执行 Lua 脚本
    async fn eval_script<T: redis::FromRedisValue>(
        &self,
        script: &str,
        args: &[&str],
    ) -> Result<T> {
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(0);  // 0 个 KEY
        for arg in args {
            cmd.arg(arg);
        }
        
        let result: redis::Value = self.redis.query(cmd).await?;
        T::from_redis_value(&result).map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_pair_key_generation() {
        let pair_key = format!("{}:{}", "zh", "en");
        assert_eq!(pair_key, "zh:en");
        
        let pair_key = format!("{}:{}", "en", "zh");
        assert_eq!(pair_key, "en:zh");
    }
}
