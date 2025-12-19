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
        crate::prometheus_metrics::phase2_redis_op("xadd", ok);
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

    // ===== Phase 2：Job FSM（Redis）=====
}
