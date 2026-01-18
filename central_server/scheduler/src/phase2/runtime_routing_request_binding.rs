// Phase 2 Request 绑定管理

impl Phase2Runtime {
    /// Phase 2：获取 request_id 绑定（跨实例幂等）
    pub async fn get_request_binding(&self, request_id: &str) -> Option<RequestBinding> {
        let key = self.request_binding_key(request_id);
        let json = self.redis.get_string(&key).await.ok().flatten()?;
        serde_json::from_str(&json).ok()
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

}
