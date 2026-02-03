// Phase 2 实例间通信

impl RedisRuntime {
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
        crate::metrics::prometheus_metrics::redis_runtime_redis_op("xadd", ok);
        ok
    }

    /// Phase 2：MODEL_NOT_AVAILABLE 去抖（跨实例一致）
    /// 返回 true 表示"窗口内首次命中"（可打印昂贵日志/指标）
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
}
