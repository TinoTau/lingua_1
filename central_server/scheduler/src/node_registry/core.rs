use super::NodeRegistry;
use crate::messages::{
    CapabilityByType, FeatureFlags, HardwareInfo, InstalledModel, InstalledService, NodeStatus, ServiceType,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;

impl NodeRegistry {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            nodes: Arc::new(RwLock::new(HashMap::new())),
            resource_threshold: 85.0, // 默认 85%（CPU、GPU、内存使用率超过此值将被跳过）
            exclude_reason_stats: Arc::new(RwLock::new(HashMap::new())),
            unavailable_services: Arc::new(RwLock::new(HashMap::new())),
            reserved_jobs: Arc::new(RwLock::new(HashMap::new())),
            phase3: Arc::new(RwLock::new(crate::core::config::Phase3Config::default())),
            phase3_pool_index: Arc::new(RwLock::new(HashMap::new())),
            phase3_node_pool: Arc::new(RwLock::new(HashMap::new())),
            core_services: Arc::new(RwLock::new(crate::core::config::CoreServicesConfig::default())),
            phase3_core_cache: Arc::new(RwLock::new(super::phase3_core_cache::Phase3CoreCacheState::default())),
        }
    }

    pub fn with_resource_threshold(threshold: f32) -> Self {
        Self {
            nodes: Arc::new(RwLock::new(HashMap::new())),
            resource_threshold: threshold,
            exclude_reason_stats: Arc::new(RwLock::new(HashMap::new())),
            unavailable_services: Arc::new(RwLock::new(HashMap::new())),
            reserved_jobs: Arc::new(RwLock::new(HashMap::new())),
            phase3: Arc::new(RwLock::new(crate::core::config::Phase3Config::default())),
            phase3_pool_index: Arc::new(RwLock::new(HashMap::new())),
            phase3_node_pool: Arc::new(RwLock::new(HashMap::new())),
            core_services: Arc::new(RwLock::new(crate::core::config::CoreServicesConfig::default())),
            phase3_core_cache: Arc::new(RwLock::new(super::phase3_core_cache::Phase3CoreCacheState::default())),
        }
    }

    /// Phase 2：从 Redis 快照 upsert 节点（允许跨实例拥有“全量节点视图”）
    pub async fn upsert_node_from_snapshot(&self, mut node: super::Node) {
        // 快照节点默认视为在线（presence 已在 Redis 校验）
        node.online = true;
        let node_id = node.node_id.clone();

        let t0 = Instant::now();
        let mut nodes = self.nodes.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.nodes.write", t0.elapsed().as_millis() as u64);

        let updated = if let Some(existing) = nodes.get_mut(&node.node_id) {
            // status 合并：尽量保留“更活跃”的状态
            let merged_status = if existing.status == NodeStatus::Ready || node.status == NodeStatus::Ready {
                NodeStatus::Ready
            } else if existing.status == NodeStatus::Degraded || node.status == NodeStatus::Degraded {
                NodeStatus::Degraded
            } else if existing.status == NodeStatus::Draining || node.status == NodeStatus::Draining {
                NodeStatus::Draining
            } else {
                node.status.clone()
            };

            *existing = node;
            existing.status = merged_status;
            existing.clone()
        } else {
            nodes.insert(node.node_id.clone(), node.clone());
            node
        };
        drop(nodes);

        // Phase 3：更新 pool index（node_id -> pool）
        self.phase3_upsert_node_to_pool_index(&node_id).await;
        self.phase3_core_cache_upsert_node(updated).await;
    }

    /// Phase 2：获取节点快照（用于写入 Redis）
    pub async fn get_node_snapshot(&self, node_id: &str) -> Option<super::Node> {
        let nodes = self.nodes.read().await;
        nodes.get(node_id).cloned()
    }

    /// 注册节点
    ///
    /// # 要求
    /// - 节点必须有 GPU（hardware.gpus 不能为空）
    /// - GPU 是保证翻译效率的必要条件，没有 GPU 的节点无法注册为算力提供方
    ///
    /// # 返回
    /// - `Ok(Node)` - 注册成功
    /// - `Err(String)` - 注册失败（没有 GPU）
    #[allow(dead_code)]
    pub async fn register_node(
        &self,
        node_id: Option<String>,
        name: String,
        version: String,
        platform: String,
        hardware: HardwareInfo,
        installed_models: Vec<InstalledModel>,
        installed_services: Option<Vec<InstalledService>>,
        features_supported: FeatureFlags,
        accept_public_jobs: bool,
        capability_by_type: Vec<CapabilityByType>,
    ) -> Result<super::Node, String> {
        self.register_node_with_policy(
            node_id,
            name,
            version,
            platform,
            hardware,
            installed_models,
            installed_services,
            features_supported,
            accept_public_jobs,
            capability_by_type,
            false,
        )
        .await
    }

    /// Phase 2：注册节点（允许覆盖已有 node_id，用于节点重连/跨实例快照同步后的注册）
    pub async fn register_node_with_policy(
        &self,
        node_id: Option<String>,
        name: String,
        version: String,
        platform: String,
        hardware: HardwareInfo,
        installed_models: Vec<InstalledModel>,
        installed_services: Option<Vec<InstalledService>>,
        features_supported: FeatureFlags,
        accept_public_jobs: bool,
        capability_by_type: Vec<CapabilityByType>,
        allow_existing_id: bool,
    ) -> Result<super::Node, String> {
        // 检查节点是否有 GPU（必需）
        if hardware.gpus.is_none() || hardware.gpus.as_ref().unwrap().is_empty() {
            warn!(
                name = %name,
                version = %version,
                platform = %platform,
                "Node registration failed: No GPU"
            );
            return Err("节点必须有 GPU 才能注册为算力提供方".to_string());
        }

        let t0 = Instant::now();
        let mut nodes = self.nodes.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.nodes.write", t0.elapsed().as_millis() as u64);

        // node_id 冲突检测（最小实现）
        let final_node_id = if let Some(provided_id) = node_id {
            // 如果提供了 node_id，检查是否已存在
            if nodes.contains_key(&provided_id) {
                if allow_existing_id {
                    // Phase 2：允许覆盖（通常意味着节点重连或本实例之前只同步了远端快照）
                    warn!(
                        node_id = %provided_id,
                        name = %name,
                        "Node registration: node_id exists, overwrite enabled (phase2)"
                    );
                    nodes.remove(&provided_id);
                } else {
                    warn!(
                        node_id = %provided_id,
                        name = %name,
                        "Node registration failed: node_id conflict"
                    );
                    return Err("节点 ID 冲突，请清除本地 node_id 后重新注册".to_string());
                }
            }
            provided_id
        } else {
            // 生成新的 node_id
            format!("node-{}", Uuid::new_v4().to_string()[..8].to_uppercase())
        };

        let capability_by_type = capability_by_type;
        let capability_by_type_map = capability_by_type
            .iter()
            .map(|c| (c.r#type.clone(), c.ready))
            .collect::<std::collections::HashMap<ServiceType, bool>>();

        // 保存用于日志的字段（在 move 之前）
        let gpu_count = hardware.gpus.as_ref().map(|gpus| gpus.len()).unwrap_or(0);
        let model_count = installed_models.len();

        let now = chrono::Utc::now();
        let node = super::Node {
            node_id: final_node_id.clone(),
            name: name.clone(),
            version: version.clone(),
            platform: platform.clone(),
            hardware,
            status: NodeStatus::Registering, // 初始状态为 registering
            online: true,
            cpu_usage: 0.0,
            gpu_usage: Some(0.0), // 初始化为 0.0，因为节点必须有 GPU
            memory_usage: 0.0,
            installed_models,
            installed_services: installed_services.unwrap_or_default(),
            features_supported,
            accept_public_jobs,
            capability_by_type,
            capability_by_type_map,
            current_jobs: 0,
            max_concurrent_jobs: 4,
            last_heartbeat: now,
            registered_at: now, // 记录注册时间
            processing_metrics: None, // 初始化为 None，等待心跳更新
        };

        nodes.insert(final_node_id.clone(), node.clone());
        drop(nodes);

        // Phase 3：更新 pool index（node_id -> pool）
        self.phase3_upsert_node_to_pool_index(&final_node_id).await;
        // Phase 3：更新 pool 核心能力缓存（用于快速定位/跳过明显不满足的 pools）
        self.phase3_core_cache_upsert_node(node.clone()).await;

        info!(
            node_id = %final_node_id,
            name = %name,
            version = %version,
            platform = %platform,
            gpu_count = gpu_count,
            model_count = model_count,
            accept_public_jobs = node.accept_public_jobs,
            status = ?NodeStatus::Registering,
            "Node registered successfully"
        );

        Ok(node)
    }

    /// 更新节点心跳
    ///
    /// # 要求
    /// - GPU 使用率必须提供（不能为 None），因为所有节点都必须有 GPU
    pub async fn update_node_heartbeat(
        &self,
        node_id: &str,
        cpu_usage: f32,
        gpu_usage: Option<f32>,
        memory_usage: f32,
        installed_models: Option<Vec<InstalledModel>>,
        installed_services: Option<Vec<InstalledService>>,
        current_jobs: usize,
        capability_by_type: Option<Vec<CapabilityByType>>,
        processing_metrics: Option<crate::messages::common::ProcessingMetrics>,
    ) -> bool {
        let mut updated: Option<super::Node> = None;
        let ok = {
            let t0 = Instant::now();
            let mut nodes = self.nodes.write().await;
            crate::metrics::observability::record_lock_wait("node_registry.nodes.write", t0.elapsed().as_millis() as u64);
            if let Some(node) = nodes.get_mut(node_id) {
            // GPU 使用率必须提供（所有节点都必须有 GPU）
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
            if let Some(cap_by_type) = capability_by_type {
                node.capability_by_type = cap_by_type;
                node.capability_by_type_map = node
                    .capability_by_type
                    .iter()
                    .map(|c| (c.r#type.clone(), c.ready))
                    .collect();
            }
            if let Some(metrics) = processing_metrics {
                node.processing_metrics = Some(metrics);
            }
            node.current_jobs = current_jobs;
            node.last_heartbeat = chrono::Utc::now();
            updated = Some(node.clone());
                true
            } else {
                false
            }
        };
        if let Some(n) = updated {
            // Phase 3：installed_services/capability_by_type 可能变化，需更新 pool 归属
            self.phase3_upsert_node_to_pool_index(node_id).await;
            self.phase3_core_cache_upsert_node(n).await;
        }
        ok
    }

    pub async fn is_node_available(&self, node_id: &str) -> bool {
        let nodes = self.nodes.read().await;
        if let Some(node) = nodes.get(node_id) {
            node.online && node.current_jobs < node.max_concurrent_jobs
        } else {
            false
        }
    }

    /// 获取节点状态（用于测试）
    #[allow(dead_code)]
    pub async fn get_node_status(&self, node_id: &str) -> Option<NodeStatus> {
        let nodes = self.nodes.read().await;
        nodes.get(node_id).map(|node| node.status.clone())
    }

    /// 设置节点状态（用于测试）
    #[allow(dead_code)]
    pub async fn set_node_status(&self, node_id: &str, status: NodeStatus) -> bool {
        let mut updated: Option<super::Node> = None;
        let ok = {
            let mut nodes = self.nodes.write().await;
            if let Some(node) = nodes.get_mut(node_id) {
                node.status = status;
                updated = Some(node.clone());
                true
            } else {
                false
            }
        };
        if let Some(n) = updated {
            self.phase3_core_cache_upsert_node(n).await;
        }
        ok
    }

    pub async fn mark_node_offline(&self, node_id: &str) {
        let mut updated: Option<super::Node> = None;
        {
            let mut nodes = self.nodes.write().await;
            if let Some(node) = nodes.get_mut(node_id) {
                node.online = false;
                updated = Some(node.clone());
            }
        }
        if let Some(n) = updated {
            self.phase3_core_cache_upsert_node(n).await;
        } else {
            // 若节点不存在，确保缓存也不残留
            self.phase3_core_cache_remove_node(node_id).await;
        }
    }

    /// 检查指定节点是否具备所需的模型（异步版本）
    pub async fn check_node_has_types_ready(&self, node_id: &str, required_types: &[ServiceType]) -> bool {
        let nodes = self.nodes.read().await;
        if let Some(node) = nodes.get(node_id) {
            super::validation::node_has_required_types_ready(node, required_types)
        } else {
            false
        }
    }

    /// 测试辅助方法：获取节点信息（仅用于测试）
    #[allow(dead_code)]
    pub async fn get_node_for_test(&self, node_id: &str) -> Option<super::Node> {
        let nodes = self.nodes.read().await;
        nodes.get(node_id).cloned()
    }

    /// 测试辅助方法：列出所有节点 ID（仅用于测试）
    #[allow(dead_code)]
    pub async fn list_node_ids_for_test(&self) -> Vec<String> {
        let nodes = self.nodes.read().await;
        nodes.keys().cloned().collect()
    }
}


