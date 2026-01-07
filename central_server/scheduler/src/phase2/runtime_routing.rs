impl Phase2Runtime {
    pub async fn enqueue_to_instance(&self, target_instance_id: &str, event: &InterInstanceEvent) -> bool {
        let stream = self.instance_inbox_stream_key(target_instance_id);
        let payload = match serde_json::to_string(event) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "Phase2 event 序列化失败");
                return false;
            }
        };
        let ok = self
            .redis
            .xadd_payload_maxlen(&stream, &payload, self.cfg.stream_maxlen.max(100))
            .await
            .is_ok();
        crate::metrics::prometheus_metrics::phase2_redis_op("xadd", ok);
        ok
    }

    /// Phase 2：MODEL_NOT_AVAILABLE 去抖（跨实例一致）
    /// 返回 true 表示“窗口内首次命中”（可打印昂贵日志/指标）
    pub async fn model_na_debounce_first_hit(
        &self,
        service_id: &str,
        service_version: Option<&str>,
        window_ms: u64,
    ) -> bool {
        let key = self.model_na_debounce_key(service_id, service_version);
        self.redis
            .set_nx_px(&key, &self.instance_id, window_ms.max(1))
            .await
            .unwrap_or(false)
    }

    /// Phase 2：MODEL_NOT_AVAILABLE 节点级限流（跨实例一致）
    /// 返回 true 表示允许继续处理
    pub async fn model_na_node_ratelimit_allow(
        &self,
        node_id: &str,
        window_ms: u64,
        max: u32,
    ) -> bool {
        let key = self.model_na_node_ratelimit_key(node_id);

        // 先尝试 SET NX EX（窗口首次）
        if self
            .redis
            .set_nx_ex_u64(&key, 1, (window_ms / 1000).max(1))
            .await
            .unwrap_or(false)
        {
            return true;
        }

        // 窗口内计数
        let v = self.redis.incr_u64(&key, 1).await.unwrap_or(u64::MAX);
        v <= (max.max(1) as u64)
    }

    /// Phase 2：获取 request_id 绑定（跨实例幂等）
    pub async fn get_request_binding(&self, request_id: &str) -> Option<RequestBinding> {
        let key = self.request_binding_key(request_id);
        let json = self.redis.get_string(&key).await.ok().flatten()?;
        serde_json::from_str(&json).ok()
    }

    /// Phase 2：写入 request_id 绑定（带 lease）
    pub async fn set_request_binding(
        &self,
        request_id: &str,
        job_id: &str,
        node_id: Option<&str>,
        lease_seconds: u64,
        dispatched_to_node: bool,
    ) {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let exp_ms = now_ms + (lease_seconds.max(1) as i64) * 1000;
        let bind = RequestBinding {
            request_id: request_id.to_string(),
            job_id: job_id.to_string(),
            node_id: node_id.map(|s| s.to_string()).filter(|s| !s.is_empty()),
            dispatched_to_node,
            expire_at_ms: exp_ms,
        };
        let json = match serde_json::to_string(&bind) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, request_id = %request_id, "Phase2 request binding 序列化失败");
                return;
            }
        };
        let _ = self
            .redis
            .set_ex_string(&self.request_binding_key(request_id), &json, lease_seconds.max(1))
            .await;
    }

    pub async fn mark_request_dispatched(&self, request_id: &str) {
        if let Some(mut b) = self.get_request_binding(request_id).await {
            b.dispatched_to_node = true;
            let ttl_ms = b.expire_at_ms - chrono::Utc::now().timestamp_millis();
            let ttl_s = (ttl_ms.max(0) as u64) / 1000;
            // TTL 接近 0 时不再写回
            if ttl_s == 0 {
                return;
            }
            let json = match serde_json::to_string(&b) {
                Ok(v) => v,
                Err(_) => return,
            };
            let _ = self
                .redis
                .set_ex_string(&self.request_binding_key(request_id), &json, ttl_s.max(1))
                .await;
        }
    }

    pub async fn update_request_binding_node(&self, request_id: &str, node_id: &str) {
        if let Some(mut b) = self.get_request_binding(request_id).await {
            b.node_id = Some(node_id.to_string());
            b.dispatched_to_node = false;
            let ttl_ms = b.expire_at_ms - chrono::Utc::now().timestamp_millis();
            let ttl_s = (ttl_ms.max(0) as u64) / 1000;
            if ttl_s == 0 {
                return;
            }
            let json = match serde_json::to_string(&b) {
                Ok(v) => v,
                Err(_) => return,
            };
            let _ = self
                .redis
                .set_ex_string(&self.request_binding_key(request_id), &json, ttl_s.max(1))
                .await;
        }
    }

    /// Phase 2：request 级分布式锁（避免同一 request_id 并发创建/占用）
    pub async fn acquire_request_lock(&self, request_id: &str, owner: &str, ttl_ms: u64) -> bool {
        let key = self.request_lock_key(request_id);
        self.redis.set_nx_px(&key, owner, ttl_ms.max(1)).await.unwrap_or(false)
    }

    pub async fn release_request_lock(&self, request_id: &str, owner: &str) {
        let key = self.request_lock_key(request_id);
        let _ = self.redis.del_if_value_matches(&key, owner).await;
    }

    /// Phase 2：节点并发占用（Redis ZSET + Lua 清理过期）
    pub async fn node_reserved_count(&self, node_id: &str) -> u64 {
        let key = self.node_reserved_zset_key(node_id);
        self.redis.zcard_clean_expired(&key).await.unwrap_or(0)
    }

    pub async fn reserve_node_slot(
        &self,
        node_id: &str,
        job_id: &str,
        ttl_seconds: u64,
        running_jobs: usize,
        max_jobs: usize,
    ) -> bool {
        let key = self.node_reserved_zset_key(node_id);
        self.redis
            .zreserve_with_capacity(
                &key,
                job_id,
                ttl_seconds.max(1),
                running_jobs as u64,
                max_jobs.max(1) as u64,
            )
            .await
            .unwrap_or(false)
    }

    pub async fn release_node_slot(&self, node_id: &str, job_id: &str) {
        let key = self.node_reserved_zset_key(node_id);
        let _ = self.redis.zrem(&key, job_id).await;
    }

    // ===== Phase 3：Pool 配置同步到 Redis =====

    /// 尝试获取 Pool 配置生成的 Leader 锁
    /// 返回 true 表示成功获取锁（成为 leader）
    pub async fn try_acquire_pool_leader(&self, ttl_seconds: u64) -> bool {
        use tracing::{debug, info};
        
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
        use tracing::{debug, warn};
        
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

    /// 获取当前 Pool Leader 实例 ID
    pub async fn get_pool_leader(&self) -> Option<String> {
        use tracing::debug;
        
        let key = self.phase3_pool_leader_key();
        let leader = self.redis.get_string(&key).await.ok().flatten()?;
        // 验证 leader 是否仍然存活
        if self.is_instance_alive(&leader).await {
            debug!(
                leader = %leader,
                "当前 Pool Leader: {}",
                leader
            );
            Some(leader)
        } else {
            debug!(
                leader = %leader,
                "Pool Leader {} 已失效（presence 不存在）",
                leader
            );
            None
        }
    }

    /// 将 Pool 配置写入 Redis
    pub async fn set_pool_config(&self, pools: &[crate::core::config::Phase3PoolConfig]) -> bool {
        use crate::core::config::Phase3PoolConfig;
        use serde::{Deserialize, Serialize};

        #[derive(Serialize, Deserialize)]
        struct PoolConfigSnapshot {
            pools: Vec<Phase3PoolConfig>,
            version: u64,
            generated_at: i64,
            generated_by: String,
        }

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
        use crate::node_registry::phase3_pool_constants::POOL_CONFIG_REDIS_TTL_SECONDS;
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
    pub async fn get_pool_config(&self) -> Option<(Vec<crate::core::config::Phase3PoolConfig>, u64)> {
        use crate::core::config::Phase3PoolConfig;
        use serde::{Deserialize, Serialize};

        #[derive(Serialize, Deserialize)]
        struct PoolConfigSnapshot {
            pools: Vec<Phase3PoolConfig>,
            version: u64,
            generated_at: i64,
            generated_by: String,
        }

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

    // ===== Phase 2：Job FSM（Redis）=====
}
