use crate::node_registry::NodeRegistry;
use crate::core::dispatcher::JobRedisRepository;
use crate::redis_runtime::RedisHandle;
use std::sync::Arc;

#[derive(Clone)]
pub struct JobDispatcher {
    /// Job Redis 仓储（SSOT）
    pub(crate) job_repo: JobRedisRepository,
    pub(crate) lease_seconds: u64,
    pub(crate) reserved_ttl_seconds: u64,
    pub(crate) spread_enabled: bool,
    pub(crate) spread_window_ms: i64,
    /// Phase 2：Redis 运行时（request_id bind/lock + node reserved）
    #[doc(hidden)]
    pub phase2: Option<Arc<crate::redis_runtime::Phase2Runtime>>,
}

impl JobDispatcher {
    pub fn new(_node_registry: Arc<NodeRegistry>, redis: Arc<RedisHandle>) -> Self {
        let job_repo = JobRedisRepository::new(redis);
        Self {
            job_repo,
            lease_seconds: 90,
            reserved_ttl_seconds: 90,
            spread_enabled: false,
            spread_window_ms: 30_000,
            phase2: None,
        }
    }

    pub fn new_with_task_binding_config(
        node_registry: Arc<NodeRegistry>,
        redis: Arc<RedisHandle>,
        cfg: crate::core::config::TaskBindingConfig,
    ) -> Self {
        let mut s = Self::new(node_registry, redis);
        s.lease_seconds = cfg.lease_seconds.max(1);
        s.reserved_ttl_seconds = cfg.reserved_ttl_seconds.max(1);
        s.spread_enabled = cfg.spread_enabled;
        s.spread_window_ms = (cfg.spread_window_seconds.max(1) as i64) * 1000;
        s
    }

    pub fn set_phase2(&mut self, phase2: Option<Arc<crate::redis_runtime::Phase2Runtime>>) {
        self.phase2 = phase2;
    }
}

