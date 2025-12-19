impl Phase2Runtime {
    pub async fn upsert_node_snapshot(&self, node: &RegistryNode) {
        let presence_key = self.node_presence_key(&node.node_id);
        let snapshot_key = self.node_snapshot_key(&node.node_id);
        let all_key = self.nodes_all_set_key();
        let last_seen_key = self.nodes_last_seen_zset_key();

        let snapshot_json = match serde_json::to_string(node) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, node_id = %node.node_id, "Phase2 node snapshot 序列化失败");
                return;
            }
        };

        let ttl = self.cfg.node_snapshot.presence_ttl_seconds.max(2);
        let _ = self.redis.set_ex_string(&presence_key, "1", ttl).await;
        let _ = self.redis.set_ex_string(&snapshot_key, &snapshot_json, ttl).await;
        let _ = self.redis.sadd_string(&all_key, &node.node_id).await;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let _ = self.redis.zadd_score(&last_seen_key, &node.node_id, now_ms).await;
    }

    pub async fn touch_node_presence(&self, node_id: &str) {
        let ttl = self.cfg.node_snapshot.presence_ttl_seconds.max(2);
        let _ = self
            .redis
            .set_ex_string(&self.node_presence_key(node_id), "1", ttl)
            .await;
    }

    pub async fn clear_node_presence(&self, node_id: &str) {
        let _ = self.redis.del(&self.node_presence_key(node_id)).await;
    }

    async fn run_node_snapshot_refresher(&self, state: AppState) {
        let interval = std::time::Duration::from_millis(self.cfg.node_snapshot.refresh_interval_ms.max(200));
        let mut tick = tokio::time::interval(interval);
        loop {
            tick.tick().await;
            let all_key = self.nodes_all_set_key();
            let ids = match self.redis.smembers_strings(&all_key).await {
                Ok(v) => v,
                Err(e) => {
                    debug!(error = %e, "Phase2 SMEMBERS nodes:all 失败");
                    continue;
                }
            };
            if ids.is_empty() {
                continue;
            }

            for node_id in ids {
                let presence_key = self.node_presence_key(&node_id);
                let online = self.redis.exists(&presence_key).await.unwrap_or(false);
                if !online {
                    state.node_registry.mark_node_offline(&node_id).await;
                    continue;
                }

                let snapshot_key = self.node_snapshot_key(&node_id);
                let json_opt = match self.redis.get_string(&snapshot_key).await {
                    Ok(v) => v,
                    Err(_) => None,
                };
                let Some(json) = json_opt else { continue };
                let node: RegistryNode = match serde_json::from_str(&json) {
                    Ok(v) => v,
                    Err(e) => {
                        debug!(error = %e, node_id = %node_id, "Phase2 node snapshot 反序列化失败");
                        continue;
                    }
                };
                // 将全局 reserved_count 融合进 current_jobs，确保任意实例选节点时能感知全局占用
                let reserved = self.node_reserved_count(&node_id).await as usize;
                let mut node = node;
                node.current_jobs = std::cmp::max(node.current_jobs, reserved);
                // upsert 到本地 NodeRegistry（允许跨实例选节点）
                state.node_registry.upsert_node_from_snapshot(node).await;
            }

            // 清理 nodes:all（避免长期增长）
            self.cleanup_stale_nodes().await;
        }
    }

    async fn cleanup_stale_nodes(&self) {
        let ttl_s = self.cfg.node_snapshot.remove_stale_after_seconds;
        if ttl_s == 0 {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        let cutoff_ms = now_ms - (ttl_s as i64) * 1000;

        let last_seen_key = self.nodes_last_seen_zset_key();
        let all_key = self.nodes_all_set_key();

        // 每轮最多清理 200 个，避免长时间占用 redis
        let stale_ids = self
            .redis
            .zrangebyscore_limit(&last_seen_key, 0, cutoff_ms, 200)
            .await
            .unwrap_or_default();
        if stale_ids.is_empty() {
            return;
        }
        for node_id in stale_ids {
            // 如果 presence 还存在，说明刚续约过，不删
            if self.redis.exists(&self.node_presence_key(&node_id)).await.unwrap_or(false) {
                let _ = self.redis.zadd_score(&last_seen_key, &node_id, now_ms).await;
                continue;
            }
            let _ = self.redis.srem_string(&all_key, &node_id).await;
            let _ = self.redis.zrem(&last_seen_key, &node_id).await;
            let _ = self.redis.del(&self.node_snapshot_key(&node_id)).await;
            let _ = self.redis.del(&self.node_presence_key(&node_id)).await;
        }
    }

}
