//! 管理状态（统一管理锁）
//! 
//! 所有节点注册、下线、心跳更新、池配置更新全部走这一把锁

use super::pool_language_index::PoolLanguageIndex;
use super::types::Node;
use crate::core::config::{CoreServicesConfig, Phase3Config};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// 节点状态（管理域）
#[derive(Debug, Clone)]
pub struct NodeState {
    /// 节点基本信息
    pub node: Node,
    /// 节点所属的 Pool IDs
    pub pool_ids: Vec<u16>,
}

/// 管理状态（统一管理锁保护的数据）
#[derive(Debug, Clone)]
pub struct ManagementState {
    /// 节点状态映射
    pub nodes: HashMap<String, NodeState>,
    /// Phase 3 配置
    pub phase3_config: Phase3Config,
    /// 核心服务配置
    pub core_services: CoreServicesConfig,
    /// Pool 语言索引
    pub lang_index: PoolLanguageIndex,
}

impl ManagementState {
    /// 创建新的管理状态
    pub fn new(phase3_config: Phase3Config, core_services: CoreServicesConfig) -> Self {
        let lang_index = PoolLanguageIndex::rebuild_from_pools(&phase3_config.pools);
        
        Self {
            nodes: HashMap::new(),
            phase3_config,
            core_services,
            lang_index,
        }
    }

    /// 更新节点状态
    pub fn update_node(&mut self, node_id: String, node: Node, pool_ids: Vec<u16>) {
        let start = std::time::Instant::now();
        let is_new = !self.nodes.contains_key(&node_id);
        self.nodes.insert(
            node_id.clone(),
            NodeState { node, pool_ids: pool_ids.clone() },
        );
        let elapsed = start.elapsed();
        if is_new {
            info!(
                node_id = %node_id,
                pool_ids = ?pool_ids,
                elapsed_us = elapsed.as_micros(),
                "新增节点状态"
            );
        } else {
            debug!(
                node_id = %node_id,
                pool_ids = ?pool_ids,
                elapsed_us = elapsed.as_micros(),
                "更新节点状态"
            );
        }
    }

    /// 移除节点
    #[allow(dead_code)] // 目前未使用，节点移除通过 ManagementRegistry 处理
    pub fn remove_node(&mut self, node_id: &str) -> bool {
        let start = std::time::Instant::now();
        let removed = self.nodes.remove(node_id).is_some();
        let elapsed = start.elapsed();
        if removed {
            info!(
                node_id = %node_id,
                elapsed_us = elapsed.as_micros(),
                "移除节点状态"
            );
        } else {
            warn!(
                node_id = %node_id,
                elapsed_us = elapsed.as_micros(),
                "尝试移除不存在的节点"
            );
        }
        removed
    }

    /// 获取节点状态
    pub fn get_node(&self, node_id: &str) -> Option<&NodeState> {
        self.nodes.get(node_id)
    }


    /// 更新 Phase 3 配置并重建索引
    pub fn update_phase3_config(&mut self, config: Phase3Config) {
        info!(
            pool_count = config.pools.len(),
            enabled = config.enabled,
            "更新 Phase 3 配置"
        );
        self.phase3_config = config.clone();
        self.lang_index = PoolLanguageIndex::rebuild_from_pools(&config.pools);
    }

    /// 更新核心服务配置
    pub fn update_core_services(&mut self, config: CoreServicesConfig) {
        debug!("更新核心服务配置");
        self.core_services = config;
    }

    /// 更新节点的 Pool 分配
    #[allow(dead_code)] // 目前未使用，Pool 分配在节点注册时完成
    pub fn update_node_pools(&mut self, node_id: &str, pool_ids: Vec<u16>) {
        if let Some(node_state) = self.nodes.get_mut(node_id) {
            let pool_ids_clone = pool_ids.clone();
            node_state.pool_ids = pool_ids;
            debug!(
                node_id = %node_id,
                pool_ids = ?pool_ids_clone,
                "更新节点 Pool 分配"
            );
        } else {
            warn!(
                node_id = %node_id,
                "尝试更新不存在的节点的 Pool 分配"
            );
        }
    }

    /// 更新节点心跳（只更新心跳相关字段，快速操作）
    /// 返回更新后的节点（如果存在）
    pub fn update_node_heartbeat(
        &mut self,
        node_id: &str,
        cpu_usage: f32,
        gpu_usage: Option<f32>,
        memory_usage: f32,
        installed_models: Option<Vec<crate::messages::InstalledModel>>,
        installed_services: Option<Vec<crate::messages::InstalledService>>,
        current_jobs: usize,
        processing_metrics: Option<crate::messages::common::ProcessingMetrics>,
        language_capabilities: Option<crate::messages::common::NodeLanguageCapabilities>,
    ) -> Option<Node> {
        if let Some(node_state) = self.nodes.get_mut(node_id) {
            let node = &mut node_state.node;
            let gpu_usage = gpu_usage.unwrap_or(0.0);
            
            node.online = true;
            node.cpu_usage = cpu_usage;
            node.gpu_usage = Some(gpu_usage);
            node.memory_usage = memory_usage;
            if let Some(models) = installed_models {
                node.installed_models = models;
            }
            if let Some(services) = installed_services {
                node.installed_services = services;
            }
            if let Some(metrics) = processing_metrics {
                node.processing_metrics = Some(metrics);
            }
            if let Some(lang_caps) = language_capabilities {
                node.language_capabilities = Some(lang_caps);
            }
            node.current_jobs = current_jobs;
            node.last_heartbeat = chrono::Utc::now();
            
            Some(node.clone())
        } else {
            None
        }
    }
}

/// 管理注册表（统一管理锁）
#[derive(Clone)]
pub struct ManagementRegistry {
    /// 管理状态（由一把锁保护）
    pub state: Arc<RwLock<ManagementState>>,
}

impl ManagementRegistry {
    /// 创建新的管理注册表
    pub fn new(phase3_config: Phase3Config, core_services: CoreServicesConfig) -> Self {
        let state = ManagementState::new(phase3_config, core_services);
        Self {
            state: Arc::new(RwLock::new(state)),
        }
    }

    /// 读取管理状态（读锁）
    pub async fn read(&self) -> tokio::sync::RwLockReadGuard<'_, ManagementState> {
        let start = std::time::Instant::now();
        let guard = self.state.read().await;
        let elapsed = start.elapsed();
        if elapsed.as_millis() > 10 {
            warn!(
                lock_wait_ms = elapsed.as_millis(),
                "管理锁读锁等待时间较长"
            );
        }
        guard
    }

    /// 写入管理状态（写锁）
    pub async fn write(&self) -> tokio::sync::RwLockWriteGuard<'_, ManagementState> {
        let start = std::time::Instant::now();
        let guard = self.state.write().await;
        let elapsed = start.elapsed();
        if elapsed.as_millis() > 10 {
            warn!(
                lock_wait_ms = elapsed.as_millis(),
                "管理锁写锁等待时间较长"
            );
        }
        guard
    }

    /// 更新节点（写锁）
    #[allow(dead_code)] // 目前未使用，节点更新通过 register_node_with_policy 处理
    pub async fn update_node(&self, node_id: String, node: Node, pool_ids: Vec<u16>) {
        let mut state = self.write().await;
        state.update_node(node_id, node, pool_ids);
    }

    /// 移除节点（写锁）
    #[allow(dead_code)] // 目前未使用，节点移除通过其他路径处理
    pub async fn remove_node(&self, node_id: &str) -> bool {
        let mut state = self.write().await;
        state.remove_node(node_id)
    }

    /// 获取节点状态（读锁）
    #[allow(dead_code)] // 目前未使用，节点查询通过其他路径处理
    pub async fn get_node(&self, node_id: &str) -> Option<NodeState> {
        let state = self.read().await;
        state.get_node(node_id).cloned()
    }

    /// 更新 Phase 3 配置（写锁）
    pub async fn update_phase3_config(&self, config: Phase3Config) {
        let mut state = self.write().await;
        state.update_phase3_config(config);
    }

    /// 更新核心服务配置（写锁）
    pub async fn update_core_services(&self, config: CoreServicesConfig) {
        let mut state = self.write().await;
        state.update_core_services(config);
    }

    /// 更新节点的 Pool 分配（写锁）
    #[allow(dead_code)] // 目前未使用，Pool 分配在节点注册时完成
    pub async fn update_node_pools(&self, node_id: &str, pool_ids: Vec<u16>) {
        let mut state = self.write().await;
        state.update_node_pools(node_id, pool_ids);
    }

    /// 更新节点心跳（写锁，快速操作，锁持有时间 < 10ms）
    /// 返回更新后的节点（如果存在）
    pub async fn update_node_heartbeat(
        &self,
        node_id: &str,
        cpu_usage: f32,
        gpu_usage: Option<f32>,
        memory_usage: f32,
        installed_models: Option<Vec<crate::messages::InstalledModel>>,
        installed_services: Option<Vec<crate::messages::InstalledService>>,
        current_jobs: usize,
        processing_metrics: Option<crate::messages::common::ProcessingMetrics>,
        language_capabilities: Option<crate::messages::common::NodeLanguageCapabilities>,
    ) -> Option<Node> {
        let mut state = self.write().await;
        state.update_node_heartbeat(
            node_id,
            cpu_usage,
            gpu_usage,
            memory_usage,
            installed_models,
            installed_services,
            current_jobs,
            processing_metrics,
            language_capabilities,
        )
    }
}
