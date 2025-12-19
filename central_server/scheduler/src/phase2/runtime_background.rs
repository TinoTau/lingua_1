impl Phase2Runtime {
    pub fn spawn_background_tasks(self: Arc<Self>, state: AppState) {
        // 1) presence + owner 续约
        let rt = self.clone();
        let state_for_owners = state.clone();
        tokio::spawn(async move {
            // 续约频率：
            // - owner 需要在 owner_ttl/2 左右续约
            // - presence 需要在 presence_ttl/2 左右续约（否则会出现“实例存活但 presence 过期”的幽灵状态）
            // 因此取两者的 min，避免 presence TTL < tick interval 导致跨实例路由偶发失败。
            let owner_tick_s = (rt.cfg.owner_ttl_seconds.max(10) / 2).max(5);
            let presence_tick_s = (rt.heartbeat_ttl_seconds.max(2) / 2).max(1);
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
            let rt = self.clone();
            let state_for_nodes = state.clone();
            tokio::spawn(async move {
                rt.run_node_snapshot_refresher(state_for_nodes).await;
            });
        }
    }

    /// Phase 2：写入 node presence + snapshot（跨实例可见）
}
