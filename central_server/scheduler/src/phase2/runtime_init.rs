impl Phase2Runtime {
    pub async fn new(
        cfg: crate::config::Phase2Config,
        scheduler_heartbeat_interval_seconds: u64,
    ) -> anyhow::Result<Option<Self>> {
        if !cfg.enabled {
            return Ok(None);
        }

        let instance_id = normalize_instance_id(&cfg.instance_id);
        let heartbeat_ttl_seconds = (scheduler_heartbeat_interval_seconds.max(1) * 2).max(2);

        let redis = RedisHandle::connect(&cfg.redis).await?;

        let rt = Self {
            instance_id,
            heartbeat_ttl_seconds,
            cfg,
            redis,
        };

        // 关键：在真正对外提供路由/投递之前，先确保 inbox stream 的 consumer group 已创建。
        // 否则在 worker 创建 group（XGROUP CREATE $）之前，如果其他实例先 XADD 了消息，
        // 会导致这些“早到消息”被 group 起点跳过，从而出现跨实例链路偶发丢投递（非常难排查）。
        let inbox = rt.instance_inbox_stream_key(&rt.instance_id);
        rt.ensure_group(&inbox).await;

        Ok(Some(rt))
    }

    pub fn key_prefix(&self) -> &str {
        &self.cfg.redis.key_prefix
    }

    pub fn node_snapshot_enabled(&self) -> bool {
        self.cfg.node_snapshot.enabled
    }

    fn v1_prefix(&self) -> String {
        // 对齐容量规划文档中的 key 示例：lingua:v1:...
        format!("{}:v1", self.key_prefix())
    }

    fn scheduler_presence_key(&self) -> String {
        format!("{}:schedulers:presence:{}", self.key_prefix(), self.instance_id)
    }

    fn node_owner_key(&self, node_id: &str) -> String {
        // hash tag: {node:<id>}
        format!("{}:nodes:owner:{{node:{}}}", self.key_prefix(), node_id)
    }

    fn session_owner_key(&self, session_id: &str) -> String {
        // hash tag: {session:<id>}
        format!("{}:sessions:owner:{{session:{}}}", self.key_prefix(), session_id)
    }

    fn session_bind_key(&self, session_id: &str) -> String {
        // v1 schema: lingua:v1:sessions:bind:{session:<id>}
        // hash tag: {session:<id>}
        format!("{}:v1:sessions:bind:{{session:{}}}", self.key_prefix(), session_id)
    }

    fn instance_inbox_stream_key(&self, instance_id: &str) -> String {
        // hash tag: {instance:<id>}
        format!("{}:streams:{{instance:{}}}:inbox", self.key_prefix(), instance_id)
    }

    fn instance_dlq_stream_key(&self, instance_id: &str) -> String {
        // hash tag: {instance:<id>}
        format!("{}:streams:{{instance:{}}}:dlq", self.key_prefix(), instance_id)
    }

    fn model_na_debounce_key(&self, service_id: &str, service_version: Option<&str>) -> String {
        // 文档示例：lingua:v1:debounce:model_unavailable:<model_id>@<version>
        let ver = service_version.unwrap_or("any");
        format!("{}:debounce:model_unavailable:{}@{}", self.v1_prefix(), service_id, ver)
    }

    fn model_na_node_ratelimit_key(&self, node_id: &str) -> String {
        // 文档示例：lingua:v1:ratelimit:node:<node_id>:model_na
        format!("{}:ratelimit:node:{}:model_na", self.v1_prefix(), node_id)
    }

    fn request_lock_key(&self, request_id: &str) -> String {
        // hash tag: {req:<id>}
        format!("{}:locks:{{req:{}}}", self.v1_prefix(), request_id)
    }

    fn request_binding_key(&self, request_id: &str) -> String {
        // hash tag: {req:<id>}
        format!("{}:bind:{{req:{}}}", self.v1_prefix(), request_id)
    }

    fn job_fsm_key(&self, job_id: &str) -> String {
        // 单实体：{job:<id>}，确保 Cluster 下 Lua 访问同 slot
        format!("{}:jobs:fsm:{{job:{}}}", self.v1_prefix(), job_id)
    }

    fn nodes_all_set_key(&self) -> String {
        format!("{}:nodes:all", self.v1_prefix())
    }

    fn nodes_last_seen_zset_key(&self) -> String {
        // member=node_id, score=last_seen_ms
        format!("{}:nodes:last_seen", self.v1_prefix())
    }

    fn node_presence_key(&self, node_id: &str) -> String {
        // hash tag: {node:<id>}
        format!("{}:nodes:presence:{{node:{}}}", self.v1_prefix(), node_id)
    }

    fn node_snapshot_key(&self, node_id: &str) -> String {
        // hash tag: {node:<id>}
        format!("{}:nodes:snapshot:{{node:{}}}", self.v1_prefix(), node_id)
    }

    fn node_reserved_zset_key(&self, node_id: &str) -> String {
        // ZSET：member=job_id, score=expire_at_ms
        // hash tag: {node:<id>}
        format!("{}:nodes:reserved:{{node:{}}}", self.v1_prefix(), node_id)
    }

    async fn set_scheduler_presence(&self) {
        let hostname = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "unknown".to_string());
        let presence = SchedulerPresence {
            started_at: chrono::Utc::now().timestamp_millis(),
            hostname,
            pid: std::process::id(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        };
        let key = self.scheduler_presence_key();
        let val = match serde_json::to_string(&presence) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "Phase2 presence 序列化失败");
                return;
            }
        };

        let _ = self
            .redis
            .set_ex_string(&key, &val, self.heartbeat_ttl_seconds)
            .await;
    }

    pub async fn is_instance_alive(&self, instance_id: &str) -> bool {
        let key = format!("{}:schedulers:presence:{}", self.key_prefix(), instance_id);
        self.redis.exists(&key).await.unwrap_or(false)
    }

    pub async fn resolve_node_owner(&self, node_id: &str) -> Option<String> {
        let key = self.node_owner_key(node_id);
        let owner = self.redis.get_string(&key).await.ok().flatten()?;
        if self.is_instance_alive(&owner).await {
            Some(owner)
        } else {
            None
        }
    }

    pub async fn resolve_session_owner(&self, session_id: &str) -> Option<String> {
        let key = self.session_owner_key(session_id);
        let owner = self.redis.get_string(&key).await.ok().flatten()?;
        if self.is_instance_alive(&owner).await {
            Some(owner)
        } else {
            None
        }
    }

    pub async fn set_node_owner(&self, node_id: &str) {
        let key = self.node_owner_key(node_id);
        let _ = self
            .redis
            .set_ex_string(&key, &self.instance_id, self.cfg.owner_ttl_seconds.max(2))
            .await;
    }

    pub async fn set_session_owner(&self, session_id: &str) {
        let key = self.session_owner_key(session_id);
        let _ = self
            .redis
            .set_ex_string(&key, &self.instance_id, self.cfg.owner_ttl_seconds.max(2))
            .await;
    }

    pub async fn clear_node_owner(&self, node_id: &str) {
        let _ = self.redis.del(&self.node_owner_key(node_id)).await;
    }

    pub async fn clear_session_owner(&self, session_id: &str) {
        let _ = self.redis.del(&self.session_owner_key(session_id)).await;
    }

    /// Schema compat: 写入 v1:sessions:bind（仅当 enabled 时）
    pub async fn schema_set_session_bind(&self, session_id: &str, node_id: &str, trace_id: Option<&str>) {
        if !self.cfg.schema_compat.enabled || !self.cfg.schema_compat.session_bind_enabled {
            return;
        }
        let key = self.session_bind_key(session_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let ttl = self.cfg.schema_compat.session_bind_ttl_seconds.max(1);
        let trace_id_val = trace_id.unwrap_or("");
        // 使用 Lua 脚本原子执行 HSET + EXPIRE
        let _ = self.redis.execute_lua_hset_session_bind(&key, node_id, trace_id_val, &now_ms.to_string(), ttl).await;
    }

    /// Schema compat: 清理 v1:sessions:bind（仅当 enabled 时）
    pub async fn schema_clear_session_bind(&self, session_id: &str) {
        if !self.cfg.schema_compat.enabled || !self.cfg.schema_compat.session_bind_enabled {
            return;
        }
        let key = self.session_bind_key(session_id);
        let _ = self.redis.del(&key).await;
    }

}
