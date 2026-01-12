// Phase 2 Pool 配置同步

use crate::node_registry::phase3_pool_constants::POOL_CONFIG_REDIS_TTL_SECONDS;

#[derive(Serialize, Deserialize)]
struct PoolConfigSnapshot {
    pools: Vec<Phase3PoolConfig>,
    version: u64,
    generated_at: i64,
    generated_by: String,
}

impl Phase2Runtime {
    /// 尝试获取 Pool 配置生成的 Leader 锁
    /// 返回 true 表示成功获取锁（成为 leader）
    pub async fn try_acquire_pool_leader(&self, ttl_seconds: u64) -> bool {
        let key = self.phase3_pool_leader_key();
        let ttl_ms = ttl_seconds.max(1) * 1000;
        let acquired = self
            .redis
            .set_nx_px(&key, &self.instance_id, ttl_ms)
            .await
            .unwrap_or(false);
        
        if acquired {
            info!(
                instance_id = %self.instance_id,
                ttl_seconds = ttl_seconds,
                "成功获取 Pool Leader 锁"
            );
        } else {
            debug!(
                instance_id = %self.instance_id,
                "未能获取 Pool Leader 锁（可能已有其他实例成为 Leader）"
            );
        }
        
        acquired
    }

    /// 续约 Pool Leader 锁
    pub async fn renew_pool_leader(&self, ttl_seconds: u64) -> bool {
        let key = self.phase3_pool_leader_key();
        // 检查当前 leader 是否是自己
        let current_leader = self.redis.get_string(&key).await.ok().flatten();
        if current_leader.as_deref() != Some(&self.instance_id) {
            debug!(
                instance_id = %self.instance_id,
                current_leader = ?current_leader,
                "当前实例不是 Pool Leader，无法续约"
            );
            return false;
        }
        // 续约锁（使用 SET EX，不是 SET NX PX）
        let ok = self
            .redis
            .set_ex_string(&key, &self.instance_id, ttl_seconds.max(1))
            .await
            .is_ok();
        
        if !ok {
            warn!(
                instance_id = %self.instance_id,
                "Pool Leader 锁续约失败"
            );
        }
        
        ok
    }

    /// 检查当前实例是否是 Pool Leader
    pub async fn is_pool_leader(&self) -> bool {
        let key = self.phase3_pool_leader_key();
        let current_leader = self.redis.get_string(&key).await.ok().flatten();
        current_leader.as_deref() == Some(&self.instance_id)
    }

    /// 将 Pool 配置写入 Redis
    pub async fn set_pool_config(&self, pools: &[Phase3PoolConfig]) -> bool {
        let key = self.phase3_pool_config_key();
        let version_key = self.phase3_pool_version_key();

        // 获取并递增版本号
        let version = self
            .redis
            .incr_u64(&version_key, 1)
            .await
            .unwrap_or(1);

        let snapshot = PoolConfigSnapshot {
            pools: pools.to_vec(),
            version,
            generated_at: chrono::Utc::now().timestamp_millis(),
            generated_by: self.instance_id.clone(),
        };

        let json = match serde_json::to_string(&snapshot) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "Pool 配置序列化失败");
                return false;
            }
        };

        // 写入配置（TTL = 1 小时，足够长）
        let ok = self
            .redis
            .set_ex_string(&key, &json, POOL_CONFIG_REDIS_TTL_SECONDS)
            .await
            .is_ok();

        if ok {
            info!(
                pool_count = pools.len(),
                version = version,
                "Pool 配置已写入 Redis"
            );
        } else {
            warn!("Pool 配置写入 Redis 失败");
        }

        ok
    }

    /// 从 Redis 读取 Pool 配置
    pub async fn get_pool_config(&self) -> Option<(Vec<Phase3PoolConfig>, u64)> {
        let key = self.phase3_pool_config_key();
        let json = match self.redis.get_string(&key).await {
            Ok(Some(v)) => v,
            Ok(None) => {
                debug!(
                    key = %key,
                    "Redis 中不存在 Pool 配置"
                );
                return None;
            }
            Err(e) => {
                warn!(
                    error = %e,
                    key = %key,
                    "从 Redis 读取 Pool 配置失败"
                );
                return None;
            }
        };

        let snapshot: PoolConfigSnapshot = match serde_json::from_str(&json) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    error = %e,
                    key = %key,
                    "Pool 配置反序列化失败"
                );
                return None;
            }
        };

        info!(
            pool_count = snapshot.pools.len(),
            version = snapshot.version,
            generated_by = %snapshot.generated_by,
            generated_at = snapshot.generated_at,
            "从 Redis 读取 Pool 配置成功"
        );

        Some((snapshot.pools, snapshot.version))
    }

    /// 获取 Pool 配置版本号
    pub async fn get_pool_config_version(&self) -> Option<u64> {
        let version_key = self.phase3_pool_version_key();
        let version_str = self.redis.get_string(&version_key).await.ok().flatten()?;
        version_str.parse().ok()
    }
}
