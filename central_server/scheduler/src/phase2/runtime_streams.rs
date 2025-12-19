impl Phase2Runtime {
    async fn ensure_group(&self, stream: &str) {
        let mut cmd = redis::cmd("XGROUP");
        cmd.arg("CREATE")
            .arg(stream)
            .arg(&self.cfg.stream_group)
            .arg("$")
            .arg("MKSTREAM");
        // BUSYGROUP 直接忽略
        let r: redis::RedisResult<()> = self.redis.query(cmd).await;
        if let Err(e) = r {
            let s = e.to_string();
            if !s.contains("BUSYGROUP") {
                warn!(error = %s, stream = %stream, "Phase2 XGROUP CREATE 失败");
            }
        }
    }

    async fn run_inbox_worker(&self, state: AppState) {
        let stream = self.instance_inbox_stream_key(&self.instance_id);
        self.ensure_group(&stream).await;
        info!(instance_id = %self.instance_id, stream = %stream, group = %self.cfg.stream_group, "Phase2 Streams inbox worker 已启动");

        // 先做一次 best-effort reclaim（为了覆盖：同组其他 consumer 死亡后遗留 pending）
        // 注意：XAUTOCLAIM 可能因 Redis 版本不支持而失败，失败则忽略。
        let mut last_reclaim_at = std::time::Instant::now() - std::time::Duration::from_secs(3600);
        let mut last_dlq_scan_at = std::time::Instant::now() - std::time::Duration::from_secs(3600);

        loop {
            // 周期性 reclaim（默认每 5 秒）
            if last_reclaim_at.elapsed() > std::time::Duration::from_secs(5) {
                last_reclaim_at = std::time::Instant::now();
                let _ = self.reclaim_and_process_pending(&stream, &state).await;
            }

            // 周期性 DLQ 扫描：把“投递次数过多”的 pending 移入 dlq 并 ack/del
            if self.cfg.dlq_enabled
                && last_dlq_scan_at.elapsed()
                    > std::time::Duration::from_millis(self.cfg.dlq_scan_interval_ms.max(1000))
            {
                last_dlq_scan_at = std::time::Instant::now();
                let _ = self.scan_pending_to_dlq(&stream).await;
            }

            // 读新消息
            let reply = self
                .xreadgroup(&stream, ">", self.cfg.stream_block_ms, self.cfg.stream_count)
                .await;

            match reply {
                Ok(items) => {
                    for (id, payload) in items {
                        if self.process_event_payload(&state, &stream, &id, &payload).await {
                            let _ = self.xack(&stream, &id).await;
                            let _ = self.xdel(&stream, &id).await;
                        }
                    }
                }
                Err(e) => {
                    warn!(error = %e, "Phase2 XREADGROUP 失败，稍后重试");
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                }
            }
        }
    }

    async fn reclaim_and_process_pending(&self, stream: &str, state: &AppState) -> anyhow::Result<()> {
        // XAUTOCLAIM <stream> <group> <consumer> <min-idle-time> 0-0 COUNT N
        let mut cmd = redis::cmd("XAUTOCLAIM");
        cmd.arg(stream)
            .arg(&self.cfg.stream_group)
            .arg(&self.instance_id)
            .arg(5_000u64) // min idle ms
            .arg("0-0")
            .arg("COUNT")
            .arg(self.cfg.stream_count.max(1));
        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => v,
            Err(e) => {
                // Redis 版本不支持/命令被禁用时，直接忽略
                crate::metrics::prometheus_metrics::phase2_redis_op("xautoclaim", false);
                debug!(error = %e, "Phase2 XAUTOCLAIM 不可用或失败，忽略");
                return Ok(());
            }
        };
        crate::metrics::prometheus_metrics::phase2_redis_op("xautoclaim", true);

        let items = parse_xautoclaim_payloads(value);
        for (id, payload) in items {
            if self.process_event_payload(state, stream, &id, &payload).await {
                let _ = self.xack(stream, &id).await;
                let _ = self.xdel(stream, &id).await;
            }
        }
        Ok(())
    }

    async fn scan_pending_to_dlq(&self, stream: &str) -> anyhow::Result<()> {
        // 先读 summary（total pending）用于 gauge
        if let Ok(total) = self.xpending_total(stream).await {
            crate::metrics::prometheus_metrics::set_phase2_inbox_pending(total as i64);
        }

        // XPENDING <stream> <group> - + <count>
        let mut cmd = redis::cmd("XPENDING");
        cmd.arg(stream)
            .arg(&self.cfg.stream_group)
            .arg("-")
            .arg("+")
            .arg(self.cfg.dlq_scan_count.max(1));

        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xpending", true);
                v
            }
            Err(e) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xpending", false);
                debug!(error = %e, "Phase2 XPENDING 失败，跳过 DLQ 扫描");
                return Ok(());
            }
        };

        let entries = parse_xpending_entries(value);

        for e in entries {
            if e.deliveries < self.cfg.dlq_max_deliveries.max(1) {
                continue;
            }
            if e.idle_ms < self.cfg.dlq_min_idle_ms.max(1) {
                continue;
            }
            // 先用 XCLAIM(min-idle) 抢占，避免搬走正在处理的消息
            let claimed = self
                .xclaim_payload(stream, &e.id, self.cfg.dlq_min_idle_ms.max(1))
                .await;
            let Some(payload) = claimed else { continue };

            let dlq_stream = self.instance_dlq_stream_key(&self.instance_id);
            let ok = self
                .redis
                .xadd_dlq_maxlen(
                    &dlq_stream,
                    self.cfg.dlq_maxlen.max(100),
                    &payload,
                    stream,
                    &e.id,
                    e.deliveries,
                )
                .await
                .is_ok();
            crate::metrics::prometheus_metrics::phase2_redis_op("dlq_move", ok);
            if ok {
                let _ = self.xack(stream, &e.id).await;
                let _ = self.xdel(stream, &e.id).await;
                crate::metrics::prometheus_metrics::on_phase2_dlq_moved();
            }
        }
        Ok(())
    }

    async fn xpending_total(&self, stream: &str) -> redis::RedisResult<u64> {
        // XPENDING <stream> <group>
        let mut cmd = redis::cmd("XPENDING");
        cmd.arg(stream).arg(&self.cfg.stream_group);
        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xpending_summary", true);
                v
            }
            Err(e) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xpending_summary", false);
                return Err(e);
            }
        };
        parse_xpending_summary_total(value).ok_or_else(|| {
            redis::RedisError::from((redis::ErrorKind::TypeError, "invalid XPENDING summary reply"))
        })
    }

    async fn xclaim_payload(&self, stream: &str, id: &str, min_idle_ms: u64) -> Option<String> {
        // XCLAIM <stream> <group> <consumer> <min-idle-time> <id>
        let mut cmd = redis::cmd("XCLAIM");
        cmd.arg(stream)
            .arg(&self.cfg.stream_group)
            .arg(&self.instance_id)
            .arg(min_idle_ms.max(1))
            .arg(id);

        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xclaim", true);
                v
            }
            Err(_) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xclaim", false);
                return None;
            }
        };
        // XCLAIM 返回格式与 XRANGE 相同：[[id, [field, value...]]]
        extract_payload_from_xrange(value)
    }

    async fn process_event_payload(&self, state: &AppState, stream: &str, id: &str, payload: &str) -> bool {
        let evt: InterInstanceEvent = match serde_json::from_str(payload) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, stream = %stream, id = %id, "Phase2 event 反序列化失败，直接 ack");
                return true;
            }
        };

        match evt {
            InterInstanceEvent::DispatchToNode { node_id, message } => {
                let json = match serde_json::to_string(&message) {
                    Ok(v) => v,
                    Err(e) => {
                        warn!(error = %e, "NodeMessage 序列化失败，直接 ack");
                        return true;
                    }
                };
                let ok = state.node_connections.send(&node_id, WsMessage::Text(json)).await;
                if !ok {
                    // 不 ack，让 pending 机制重试（节点重连后可送达）
                    debug!(node_id = %node_id, stream = %stream, id = %id, "本地 node 不在线，保留 pending");
                }
                ok
            }
            InterInstanceEvent::SendToSession { session_id, message } => {
                let json = match serde_json::to_string(&message) {
                    Ok(v) => v,
                    Err(e) => {
                        warn!(error = %e, "SessionMessage 序列化失败，直接 ack");
                        return true;
                    }
                };
                let ok = state
                    .session_connections
                    .send(&session_id, WsMessage::Text(json))
                    .await;
                if !ok {
                    debug!(session_id = %session_id, stream = %stream, id = %id, "本地 session 不在线，保留 pending");
                }
                ok
            }
            InterInstanceEvent::ForwardNodeMessage { message } => {
                // 转发的 NodeMessage 不依赖“本地 node 连接”，其语义是让目标实例补齐业务处理（结果队列/Job 上下文等）。
                crate::websocket::node_handler::handle_forwarded_node_message(state, message).await;
                true
            }
        }
    }

    async fn xreadgroup(
        &self,
        stream: &str,
        start_id: &str,
        block_ms: u64,
        count: usize,
    ) -> redis::RedisResult<Vec<(String, String)>> {
        // XREADGROUP GROUP <group> <consumer> COUNT <count> BLOCK <ms> STREAMS <stream> <id>
        let mut cmd = redis::cmd("XREADGROUP");
        cmd.arg("GROUP")
            .arg(&self.cfg.stream_group)
            .arg(&self.instance_id)
            .arg("COUNT")
            .arg(count.max(1))
            .arg("BLOCK")
            .arg(block_ms.max(1))
            .arg("STREAMS")
            .arg(stream)
            .arg(start_id);

        let reply: redis::streams::StreamReadReply = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xreadgroup", true);
                v
            }
            Err(e) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xreadgroup", false);
                return Err(e);
            }
        };
        Ok(extract_payloads_from_stream_reply(reply))
    }

    async fn xack(&self, stream: &str, id: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("XACK");
        cmd.arg(stream).arg(&self.cfg.stream_group).arg(id);
        let r = self.redis.query(cmd).await;
        crate::metrics::prometheus_metrics::phase2_redis_op("xack", r.is_ok());
        r
    }

    async fn xdel(&self, stream: &str, id: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("XDEL");
        cmd.arg(stream).arg(id);
        let r = self.redis.query(cmd).await;
        crate::metrics::prometheus_metrics::phase2_redis_op("xdel", r.is_ok());
        r
    }

    #[allow(dead_code)]
    async fn xrange_payload(&self, stream: &str, id: &str) -> Option<String> {
        let mut cmd = redis::cmd("XRANGE");
        cmd.arg(stream).arg(id).arg(id);
        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xrange", true);
                v
            }
            Err(_) => {
                crate::metrics::prometheus_metrics::phase2_redis_op("xrange", false);
                return None;
            }
        };
        extract_payload_from_xrange(value)
    }
}

