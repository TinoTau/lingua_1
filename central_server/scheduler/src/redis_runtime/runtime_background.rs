impl RedisRuntime {
    pub fn spawn_background_tasks(self: Arc<Self>, state: AppState) {
        // 1) presence + owner 续约
        let rt = self.clone();
        let state_for_owners = state.clone();
        tokio::spawn(async move {
            // 续约频率：
            // - owner 需要在 owner_ttl/2 左右续约
            // - presence 需要在 presence_ttl/2 左右续约（否则会出现“实例存活但 presence 过期”的幽灵状态）
            // 因此取两者的 min，避免 presence TTL < tick interval 导致跨实例路由偶发失败。
            // 使用配置值替代硬编码
            let owner_ttl_base = rt.cfg.owner_ttl_seconds.max(rt.owner_ttl_base_seconds);
            let owner_tick_s = (owner_ttl_base / rt.owner_ttl_divisor).max(rt.owner_ttl_min_seconds);
            
            let presence_ttl_base = rt.heartbeat_ttl_seconds.max(rt.presence_ttl_min_seconds);
            let presence_tick_s = (presence_ttl_base / rt.presence_ttl_divisor).max(rt.presence_ttl_absolute_min_seconds);
            let interval_s = std::cmp::min(owner_tick_s, presence_tick_s);
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_s));
            loop {
                interval.tick().await;
                rt.set_scheduler_presence().await;

                let session_ids = state_for_owners.session_connections.list_session_ids().await;
                let node_ids = state_for_owners.node_connections.list_node_ids().await;
                for sid in session_ids {
                    rt.set_session_owner(&sid).await;
                }
                for nid in node_ids {
                    rt.set_node_owner(&nid).await;
                }
            }
        });

        // 2) Streams inbox worker
        let rt = self.clone();
        let state_for_inbox = state.clone();
        tokio::spawn(async move {
            rt.run_inbox_worker(state_for_inbox).await;
        });

        // 3) Node snapshot refresh (Redis -> local NodeRegistry)
        if self.cfg.node_snapshot.enabled {
            let _rt = self.clone();
            // run_node_snapshot_refresher 已废弃（Redis 直查架构不再需要定期刷新）
        }
    }
}
