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

    /// Phase 2：节点并发占用（从 Redis Hash 读取）
    pub async fn node_reserved_count(&self, node_id: &str) -> u64 {
        let key = self.node_cap_key(node_id);
        match self.redis.query::<i64>({
            let mut c = redis::cmd("HGET");
            c.arg(&key).arg("reserved");
            c
        }).await {
            Ok(v) if v > 0 => v as u64,
            _ => 0,
        }
    }

    /// Phase 2：预留节点槽位（使用新的 Redis Hash 实现）
    /// 返回: Ok(true) 表示成功, Ok(false) 表示失败（节点已满等）, Err(SchedulerDependencyDown) 表示 Redis 不可用
    pub async fn reserve_node_slot(
        &self,
        node_id: &str,
        job_id: &str,
        attempt_id: u32,
        ttl_seconds: u64,
    ) -> Result<bool, crate::messages::ErrorCode> {
        use tracing::{error, warn};
        
        let node_cap_key = self.node_cap_key(node_id);
        let node_meta_key = self.node_meta_key(node_id);
        let resv_id = format!("{}:{}:{}", job_id, attempt_id, node_id);
        let resv_key = self.resv_key(&resv_id);
        
        let resv_value = serde_json::json!({
            "node_id": node_id,
            "job_id": job_id,
            "attempt_id": attempt_id,
            "created_ms": chrono::Utc::now().timestamp_millis(),
            "ttl_ms": ttl_seconds * 1000,
        });
        let resv_value_json = match serde_json::to_string(&resv_value) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "预留值序列化失败");
                return Ok(false);
            }
        };
        
        match self.redis.try_reserve(&node_cap_key, &node_meta_key, &resv_key, ttl_seconds * 1000, &resv_value_json).await {
            Ok((1, _)) => {
                // 记录成功
                crate::metrics::prometheus_metrics::on_reserve_attempt(true);
                Ok(true)
            }
            Ok((status, reason)) => {
                // 记录失败原因
                crate::metrics::prometheus_metrics::on_reserve_attempt(false);
                if status == 2 {
                    // FULL - 节点过载
                    crate::metrics::prometheus_metrics::on_node_overload_reject(node_id, "full");
                } else if status == 3 {
                    // NOT_READY - 节点不健康
                    crate::metrics::prometheus_metrics::on_node_overload_reject(node_id, "not_ready");
                } else {
                    crate::metrics::prometheus_metrics::on_node_overload_reject(node_id, "other");
                }
                warn!(
                    node_id = %node_id,
                    job_id = %job_id,
                    attempt_id = attempt_id,
                    status = status,
                    reason = %reason,
                    "预留节点槽位失败"
                );
                Ok(false)
            }
            Err(e) => {
                // Redis 连接错误：返回 SCHEDULER_DEPENDENCY_DOWN
                crate::metrics::prometheus_metrics::on_reserve_error();
                error!(
                    error = %e,
                    node_id = %node_id,
                    job_id = %job_id,
                    attempt_id = attempt_id,
                    "Redis 不可用，无法预留节点槽位"
                );
                Err(crate::messages::ErrorCode::SchedulerDependencyDown)
            }
        }
    }

    /// Phase 2：释放节点槽位（使用新的 Redis Hash 实现）
    pub async fn release_node_slot(&self, node_id: &str, job_id: &str, attempt_id: u32) {
        let node_cap_key = self.node_cap_key(node_id);
        let resv_id = format!("{}:{}:{}", job_id, attempt_id, node_id);
        let resv_key = self.resv_key(&resv_id);
        let _ = self.redis.release_reserve(&node_cap_key, &resv_key).await;
    }

    /// Phase 2：提交预留（reserved -> running）
    pub async fn commit_node_reservation(&self, node_id: &str, job_id: &str, attempt_id: u32) -> bool {
        let node_cap_key = self.node_cap_key(node_id);
        let resv_id = format!("{}:{}:{}", job_id, attempt_id, node_id);
        let resv_key = self.resv_key(&resv_id);
        self.redis.commit_reserve(&node_cap_key, &resv_key).await.unwrap_or(false)
    }

    /// Phase 2：递减运行中任务数（任务完成时调用）
    pub async fn dec_node_running(&self, node_id: &str) {
        let node_cap_key = self.node_cap_key(node_id);
        let _ = self.redis.dec_running(&node_cap_key).await;
    }

    /// Phase 2：同步节点容量到 Redis
    pub async fn sync_node_capacity_to_redis(
        &self,
        node_id: &str,
        max_concurrent_jobs: usize,
        current_running: usize,
        health: &str,
    ) {
        let node_cap_key = self.node_cap_key(node_id);
        let node_meta_key = self.node_meta_key(node_id);
        
        // 更新容量信息
        let _ = self.redis.query::<i64>({
            let mut c = redis::cmd("HMSET");
            c.arg(&node_cap_key)
                .arg("max").arg(max_concurrent_jobs as i64)
                .arg("running").arg(current_running as i64)
                .arg("reserved").arg(0i64);  // 初始化为 0，实际值从预留操作更新
            c
        }).await;
        
        // 更新元数据
        let _ = self.redis.query::<i64>({
            let mut c = redis::cmd("HSET");
            c.arg(&node_meta_key).arg("health").arg(health);
            c
        }).await;
        
        // 设置 TTL（1 小时）
        let _ = self.redis.query::<i64>({
            let mut c = redis::cmd("EXPIRE");
            c.arg(&node_cap_key).arg(3600);
            c
        }).await;
        let _ = self.redis.query::<i64>({
            let mut c = redis::cmd("EXPIRE");
            c.arg(&node_meta_key).arg(3600);
            c
        }).await;
    }

    /// Phase 2：同步节点能力到 Redis
    /// 将节点能力信息存储到 Redis Hash 中，不占用内存
    pub async fn sync_node_capabilities_to_redis(
        &self,
        node_id: &str,
        capabilities: &[crate::messages::CapabilityByType],
    ) {
        use crate::messages::ServiceType;
        use tracing::{info, warn};

        let capabilities_key = self.node_capabilities_key(node_id);
        
        info!(
            node_id = %node_id,
            capability_count = capabilities.len(),
            "开始同步节点能力信息到 Redis"
        );
        
        // 构建能力映射
        let mut capability_map = std::collections::HashMap::<String, String>::new();
        for cap in capabilities {
            let service_type_str = match &cap.r#type {
                ServiceType::Asr => "asr",
                ServiceType::Nmt => "nmt",
                ServiceType::Tts => "tts",
                ServiceType::Tone => "tone",
                ServiceType::Semantic => "semantic",
            };
            capability_map.insert(service_type_str.to_string(), cap.ready.to_string());
        }

        // 使用 HMSET 批量设置
        if !capability_map.is_empty() {
            let mut cmd = redis::cmd("HMSET");
            cmd.arg(&capabilities_key);
            for (key, value) in &capability_map {
                cmd.arg(key).arg(value);
            }
            // HMSET 返回 "OK" 字符串，不是数字
            match self.redis.query::<String>(cmd).await {
                Ok(_) => {
                    info!(
                        node_id = %node_id,
                        capability_count = capability_map.len(),
                        "节点能力信息已同步到 Redis"
                    );
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        node_id = %node_id,
                        "节点能力信息同步到 Redis 失败"
                    );
                }
            }
        }

        // 设置 TTL（1 小时，与容量信息一致）
        let _ = self.redis.query::<i64>({
            let mut c = redis::cmd("EXPIRE");
            c.arg(&capabilities_key).arg(3600);
            c
        }).await;
    }

    /// Phase 2：从 Redis 读取节点能力
    /// 返回 ServiceType -> ready 的映射
    pub async fn get_node_capabilities_from_redis(
        &self,
        node_id: &str,
    ) -> Option<std::collections::HashMap<crate::messages::ServiceType, bool>> {
        use crate::messages::ServiceType;
        use tracing::{debug, warn};

        let capabilities_key = self.node_capabilities_key(node_id);
        
        debug!(
            node_id = %node_id,
            "从 Redis 读取节点能力信息"
        );
        
        // 读取所有字段
        let result: Result<std::collections::HashMap<String, String>, _> = self.redis.query({
            let mut c = redis::cmd("HGETALL");
            c.arg(&capabilities_key);
            c
        }).await;

        match result {
            Ok(map) => {
                let mut capabilities = std::collections::HashMap::new();
                for (key, value) in map {
                    let service_type = match key.as_str() {
                        "asr" => ServiceType::Asr,
                        "nmt" => ServiceType::Nmt,
                        "tts" => ServiceType::Tts,
                        "tone" => ServiceType::Tone,
                        "semantic" => ServiceType::Semantic,
                        _ => {
                            warn!(
                                node_id = %node_id,
                                unknown_key = %key,
                                "未知的服务类型键"
                            );
                            continue;
                        }
                    };
                    let ready = value == "true";
                    capabilities.insert(service_type, ready);
                }
                debug!(
                    node_id = %node_id,
                    capability_count = capabilities.len(),
                    "成功从 Redis 读取节点能力信息"
                );
                Some(capabilities)
            }
            Err(e) => {
                warn!(
                    error = %e,
                    node_id = %node_id,
                    "从 Redis 读取节点能力失败"
                );
                None
            }
        }
    }

    /// Phase 2：检查节点是否有某个服务能力（从 Redis 读取）
    pub async fn has_node_capability(
        &self,
        node_id: &str,
        service_type: &crate::messages::ServiceType,
    ) -> bool {
        use tracing::debug;
        
        if let Some(capabilities) = self.get_node_capabilities_from_redis(node_id).await {
            let ready = capabilities.get(service_type).copied().unwrap_or(false);
            debug!(
                node_id = %node_id,
                service_type = ?service_type,
                ready = ready,
                "检查节点服务能力"
            );
            ready
        } else {
            debug!(
                node_id = %node_id,
                service_type = ?service_type,
                "无法从 Redis 读取节点能力，返回 false"
            );
            false
        }
    }
}

impl Phase2Runtime {
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

    // ===== Phase 3：Pool 成员索引同步到 Redis =====

    /// 同步单个 Pool 的成员索引到 Redis Set
    /// pool_name 格式: "zh-en" 或 "*-en" (混合池)
    /// node_ids: Pool 中的节点 ID 集合
    pub async fn sync_pool_members_to_redis(
        &self,
        pool_name: &str,
        node_ids: &std::collections::HashSet<String>,
    ) -> bool {
        use tracing::{debug, warn};
        
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
    ) -> Option<std::collections::HashSet<String>> {
        let key = self.pool_members_key(pool_name);
        match self.redis.smembers_strings(&key).await {
            Ok(members) => {
                Some(members.into_iter().collect())
            }
            Err(e) => {
                tracing::warn!(
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
    ) -> std::collections::HashMap<String, std::collections::HashSet<String>> {
        
        let mut result = std::collections::HashMap::new();
        
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
                    result.insert(pool_name.to_string(), std::collections::HashSet::new());
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
        pool_index: &std::collections::HashMap<u16, std::collections::HashSet<String>>,
        pool_configs: &[crate::core::config::Phase3PoolConfig],
    ) {
        use tracing::debug;
        
        // 建立 pool_id -> pool_name 映射
        let pool_id_to_name: std::collections::HashMap<u16, String> = pool_configs
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
        pool_ids: &std::collections::HashSet<u16>,
        pool_configs: &[crate::core::config::Phase3PoolConfig],
        pool_index: &std::collections::HashMap<u16, std::collections::HashSet<String>>,
    ) {
        
        // 建立 pool_id -> pool_name 映射
        let pool_id_to_name: std::collections::HashMap<u16, String> = pool_configs
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
        pool_configs: &[crate::core::config::Phase3PoolConfig],
    ) -> std::collections::HashMap<u16, std::collections::HashSet<String>> {
        use tracing::debug;
        
        let mut result = std::collections::HashMap::new();
        
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
                result.insert(pool_id, std::collections::HashSet::new());
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
        pool_configs: &[crate::core::config::Phase3PoolConfig],
    ) -> std::collections::HashMap<u16, usize> {
        let mut result = std::collections::HashMap::new();
        
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

    // ===== Phase 2：Job FSM（Redis）=====
}
