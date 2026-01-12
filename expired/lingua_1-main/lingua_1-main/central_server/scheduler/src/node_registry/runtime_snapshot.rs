//! 运行时快照（调度快路径）
//! 
//! 调度路径脱离管理锁，使用 RuntimeSnapshot（节点运行快照）+ Pool 索引快照

use super::pool_language_index::PoolLanguageIndex;
use crate::messages::common::LanguagePair;
use crate::messages::NodeStatus;
use smallvec::SmallVec;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, warn};

/// 节点运行时快照
/// 只包含调度所需的最小信息，从 ManagementState 派生
/// 热路径使用，无锁读取
#[derive(Debug, Clone)]
pub struct NodeRuntimeSnapshot {
    pub node_id: String,
    pub health: NodeHealth,
    pub capabilities: NodeCapabilities,
    #[allow(dead_code)] // 保留用于未来扩展
    pub lang_pairs: SmallVec<[LanguagePair; 8]>,
    pub max_concurrency: u32,
    pub current_jobs: usize,
    pub accept_public_jobs: bool,
    #[allow(dead_code)] // 保留用于未来扩展
    pub pool_ids: SmallVec<[u16; 4]>,
    // 调度所需的其他字段
    pub has_gpu: bool,  // 是否有 GPU
    pub installed_services: Vec<crate::messages::InstalledService>,  // 已安装服务（用于类型检查）
    pub cpu_usage: f32,
    pub gpu_usage: Option<f32>,
    pub memory_usage: f32,
    pub features_supported: crate::messages::FeatureFlags,
}

/// 节点健康状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeHealth {
    Online,
    Offline,
    NotReady,
}

impl From<NodeStatus> for NodeHealth {
    fn from(status: NodeStatus) -> Self {
        match status {
            NodeStatus::Ready => NodeHealth::Online,
            NodeStatus::Registering => NodeHealth::NotReady,
            NodeStatus::Degraded => NodeHealth::Online, // 降级但仍在线
            NodeStatus::Draining => NodeHealth::Online, // 排空但仍在线
            NodeStatus::Offline => NodeHealth::Offline,
        }
    }
}

/// 节点能力（简化版）
#[derive(Debug, Clone, Default)]
pub struct NodeCapabilities {
    pub asr_languages: Vec<String>,
    pub tts_languages: Vec<String>,
    pub semantic_languages: Vec<String>,
}

/// 节点运行时映射
pub type NodeRuntimeMap = HashMap<String, Arc<NodeRuntimeSnapshot>>;

/// Pool 成员缓存
#[derive(Debug, Clone)]
pub struct PoolMembersCache {
    /// pool_id -> Vec<node_id>
    #[allow(dead_code)] // 目前未使用，Pool 成员直接从 Redis 读取
    pub members: HashMap<u16, Vec<String>>,
    /// 缓存时间戳（用于过期检查）
    #[allow(dead_code)] // 目前未使用，Pool 成员直接从 Redis 读取
    pub cached_at_ms: i64,
}

impl PoolMembersCache {
    pub fn new() -> Self {
        Self {
            members: HashMap::new(),
            cached_at_ms: 0,
        }
    }

    #[allow(dead_code)] // 目前未使用，Pool 成员直接从 Redis 读取
    pub fn update(&mut self, pool_id: u16, node_ids: Vec<String>) {
        self.members.insert(pool_id, node_ids);
        self.cached_at_ms = chrono::Utc::now().timestamp_millis();
    }

    #[allow(dead_code)] // 目前未使用，Pool 成员直接从 Redis 读取
    pub fn get(&self, pool_id: u16) -> Option<&Vec<String>> {
        self.members.get(&pool_id)
    }

}

/// 运行时快照
/// 调度路径只读快照，不阻塞管理锁
#[derive(Clone)]
pub struct RuntimeSnapshot {
    /// 节点运行时映射（只读，通过 COW 更新）
    pub nodes: Arc<NodeRuntimeMap>,
    /// Pool 成员缓存（轻量锁）
    #[allow(dead_code)] // 目前未使用，Pool 成员直接从 Redis 读取
    pub pool_members_cache: Arc<RwLock<PoolMembersCache>>,
    /// Pool 语言索引快照（只读，通过 COW 更新）
    pub lang_index: Arc<PoolLanguageIndex>,
    /// 快照版本（用于追踪更新）
    pub version: u64,
}

impl RuntimeSnapshot {
    /// 创建新的运行时快照
    pub fn new(lang_index: PoolLanguageIndex) -> Self {
        Self {
            nodes: Arc::new(HashMap::new()),
            pool_members_cache: Arc::new(RwLock::new(PoolMembersCache::new())),
            lang_index: Arc::new(lang_index),
            version: 0,
        }
    }

    /// 更新节点快照（COW 模式）
    pub fn update_nodes(&mut self, nodes: NodeRuntimeMap) {
        let start = std::time::Instant::now();
        self.nodes = Arc::new(nodes);
        self.version += 1;
        let elapsed = start.elapsed();
        
        if elapsed.as_millis() > 50 {
            warn!(
                snapshot_version = self.version,
                update_time_ms = elapsed.as_millis(),
                "快照更新耗时较长"
            );
        } else {
            debug!(
                snapshot_version = self.version,
                node_count = self.nodes.len(),
                update_time_ms = elapsed.as_millis(),
                "快照更新完成"
            );
        }
    }

    /// 更新语言索引快照（COW 模式）
    pub fn update_lang_index(&mut self, lang_index: PoolLanguageIndex) {
        self.lang_index = Arc::new(lang_index);
        self.version += 1;
        debug!(
            snapshot_version = self.version,
            "语言索引快照更新完成"
        );
    }

    /// 获取节点快照（无锁读取）
    #[allow(dead_code)] // 目前未使用，但保留用于调试和未来扩展
    pub fn get_node(&self, node_id: &str) -> Option<Arc<NodeRuntimeSnapshot>> {
        self.nodes.get(node_id).cloned()
    }

    /// 获取所有节点 ID（无锁读取）
    #[allow(dead_code)] // 目前未使用，但保留用于调试和未来扩展
    pub fn get_all_node_ids(&self) -> Vec<String> {
        self.nodes.keys().cloned().collect()
    }

    /// 更新 Pool 成员缓存（轻量锁）
    #[allow(dead_code)] // 目前未使用，Pool 成员直接从 Redis 读取
    pub async fn update_pool_members(&self, pool_id: u16, node_ids: Vec<String>) {
        let mut cache = self.pool_members_cache.write().await;
        cache.update(pool_id, node_ids);
        debug!(
            pool_id = pool_id,
            node_count = cache.get(pool_id).map(|v| v.len()).unwrap_or(0),
            "Pool 成员缓存更新"
        );
    }

    /// 获取 Pool 成员（轻量锁读取）
    #[allow(dead_code)] // 目前未使用，Pool 成员直接从 Redis 读取
    pub async fn get_pool_members(&self, pool_id: u16) -> Vec<String> {
        let cache = self.pool_members_cache.read().await;
        cache.get(pool_id).cloned().unwrap_or_default()
    }

}

/// 从 ManagementState 构建节点运行时快照
pub fn build_node_snapshot(
    node_id: String,
    node: &super::types::Node,
    pool_ids: &[u16],
) -> NodeRuntimeSnapshot {
    let health = NodeHealth::from(node.status.clone());
    
    let mut lang_pairs = SmallVec::new();
    if let Some(ref caps) = node.language_capabilities {
        if let Some(ref pairs) = caps.supported_language_pairs {
            for pair in pairs {
                lang_pairs.push(pair.clone());
            }
        }
    }

    let capabilities = NodeCapabilities {
        asr_languages: node
            .language_capabilities
            .as_ref()
            .and_then(|c| c.asr_languages.clone())
            .unwrap_or_default(),
        tts_languages: node
            .language_capabilities
            .as_ref()
            .and_then(|c| c.tts_languages.clone())
            .unwrap_or_default(),
        semantic_languages: node
            .language_capabilities
            .as_ref()
            .and_then(|c| c.semantic_languages.clone())
            .unwrap_or_default(),
    };

    let mut pool_ids_vec = SmallVec::new();
    pool_ids_vec.extend_from_slice(pool_ids);

    // 检查是否有 GPU
    let has_gpu = node.hardware.gpus.is_some() 
        && !node.hardware.gpus.as_ref().unwrap().is_empty();

    NodeRuntimeSnapshot {
        node_id,
        health,
        capabilities,
        lang_pairs,
        max_concurrency: node.max_concurrent_jobs as u32,
        current_jobs: node.current_jobs,
        accept_public_jobs: node.accept_public_jobs,
        pool_ids: pool_ids_vec,
        has_gpu,
        installed_services: node.installed_services.clone(),
        cpu_usage: node.cpu_usage,
        gpu_usage: node.gpu_usage,
        memory_usage: node.memory_usage,
        features_supported: node.features_supported.clone(),
    }
}
