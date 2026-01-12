// Phase 2 Request 绑定管理

impl Phase2Runtime {
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
}
