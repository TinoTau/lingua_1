use crate::node_registry::NodeRegistry;
use crate::core::config::CoreServicesConfig;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct JobDispatcher {
    #[allow(dead_code)] // 在 job_selection.rs 中使用
    pub(crate) node_registry: Arc<NodeRegistry>,
    #[doc(hidden)]
    pub jobs: Arc<RwLock<std::collections::HashMap<String, crate::core::dispatcher::Job>>>,
    pub(crate) lease_seconds: u64,
    pub(crate) reserved_ttl_seconds: u64,
    pub(crate) spread_enabled: bool,
    pub(crate) spread_window_ms: i64,
    pub(crate) core_services: CoreServicesConfig,
    /// Phase 2：Redis 运行时（request_id bind/lock + node reserved）
    #[doc(hidden)]
    pub phase2: Option<Arc<crate::phase2::Phase2Runtime>>,
}

impl JobDispatcher {
    pub fn new(node_registry: Arc<NodeRegistry>) -> Self {
        Self {
            node_registry,
            jobs: Arc::new(RwLock::new(std::collections::HashMap::new())),
            lease_seconds: 90,
            reserved_ttl_seconds: 90,
            spread_enabled: false,
            spread_window_ms: 30_000,
            core_services: crate::core::config::CoreServicesConfig::default(),
            phase2: None,
        }
    }

    pub fn new_with_task_binding_config(
        node_registry: Arc<NodeRegistry>,
        cfg: crate::core::config::TaskBindingConfig,
    ) -> Self {
        let mut s = Self::new(node_registry);
        s.lease_seconds = cfg.lease_seconds.max(1);
        s.reserved_ttl_seconds = cfg.reserved_ttl_seconds.max(1);
        s.spread_enabled = cfg.spread_enabled;
        s.spread_window_ms = (cfg.spread_window_seconds.max(1) as i64) * 1000;
        s
    }

    /// 创建 JobDispatcher（带核心服务配置）
    pub fn new_with_config(
        node_registry: Arc<NodeRegistry>,
        task_binding: crate::core::config::TaskBindingConfig,
        core_services: crate::core::config::CoreServicesConfig,
    ) -> Self {
        let mut s = Self::new_with_task_binding_config(node_registry, task_binding);
        s.core_services = core_services;
        s
    }

    pub fn set_phase2(&mut self, phase2: Option<Arc<crate::phase2::Phase2Runtime>>) {
        self.phase2 = phase2;
    }
}

