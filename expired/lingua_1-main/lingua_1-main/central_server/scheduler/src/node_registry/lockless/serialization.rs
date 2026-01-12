//! 序列化/反序列化工具
//! 
//! 负责将节点状态、配置等数据序列化为 Redis 存储格式

use crate::node_registry::runtime_snapshot::NodeRuntimeSnapshot;
use crate::core::config::Phase3Config;
use serde::{Deserialize, Serialize};
use tracing::warn;

/// Redis 中存储的节点数据格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisNodeData {
    pub node_id: String,
    pub status: String,  // "online", "offline"
    pub health: String,  // "Online", "Offline", "NotReady"
    pub capabilities: RedisNodeCapabilities,
    pub resources: RedisNodeResources,
    pub pool_ids: Vec<u16>,
    pub installed_services: Vec<String>,  // JSON 字符串数组
    pub features_supported: serde_json::Value,  // FeatureFlags 的 JSON 表示
    pub last_heartbeat_ms: i64,
    pub version: u64,
}

/// Redis 中存储的节点能力格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisNodeCapabilities {
    pub asr_languages: Vec<String>,
    pub tts_languages: Vec<String>,
    pub semantic_languages: Vec<String>,
}

/// Redis 中存储的节点资源格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisNodeResources {
    pub max_concurrency: u32,
    pub current_jobs: usize,
    pub cpu_usage: f32,
    pub gpu_usage: Option<f32>,
    pub memory_usage: f32,
}

impl RedisNodeData {
    /// 转换为 NodeRuntimeSnapshot
    pub fn to_snapshot(&self) -> Option<NodeRuntimeSnapshot> {
        // 解析 installed_services
        let installed_services: Vec<crate::messages::InstalledService> = self.installed_services
            .iter()
            .filter_map(|s| serde_json::from_str(s).ok())
            .collect();

        // 解析 features_supported
        let features_supported: crate::messages::FeatureFlags = match serde_json::from_value(self.features_supported.clone()) {
            Ok(f) => f,
            Err(e) => {
                warn!(error = %e, "解析 features_supported 失败，使用默认值");
                crate::messages::FeatureFlags::default()
            }
        };

        // 解析 health
        use crate::node_registry::runtime_snapshot::NodeHealth;
        let health = match self.health.as_str() {
            "Online" => NodeHealth::Online,
            "Offline" => NodeHealth::Offline,
            "NotReady" => NodeHealth::NotReady,
            _ => {
                warn!(health = %self.health, "未知的 health 值，使用 NotReady");
                NodeHealth::NotReady
            }
        };

        // 解析 capabilities
        use crate::node_registry::runtime_snapshot::NodeCapabilities;
        let capabilities = NodeCapabilities {
            asr_languages: self.capabilities.asr_languages.clone(),
            tts_languages: self.capabilities.tts_languages.clone(),
            semantic_languages: self.capabilities.semantic_languages.clone(),
        };

        Some(NodeRuntimeSnapshot {
            node_id: self.node_id.clone(),
            health,
            capabilities,
            lang_pairs: smallvec::SmallVec::new(), // 从 lang_index 推导
            max_concurrency: self.resources.max_concurrency,
            current_jobs: self.resources.current_jobs,
            accept_public_jobs: true, // 默认值，实际应从 Redis 读取
            pool_ids: smallvec::SmallVec::from_vec(self.pool_ids.clone()),
            has_gpu: self.resources.gpu_usage.is_some(),
            installed_services,
            cpu_usage: self.resources.cpu_usage,
            gpu_usage: self.resources.gpu_usage,
            memory_usage: self.resources.memory_usage,
            features_supported,
        })
    }

    /// 从 NodeRuntimeSnapshot 创建
    pub fn from_snapshot(snapshot: &NodeRuntimeSnapshot, version: u64) -> Self {
        // 序列化 installed_services
        let installed_services: Vec<String> = snapshot.installed_services
            .iter()
            .filter_map(|s| serde_json::to_string(s).ok())
            .collect();

        // 序列化 features_supported
        let features_supported = serde_json::to_value(&snapshot.features_supported)
            .unwrap_or_else(|_| serde_json::json!({}));

        Self {
            node_id: snapshot.node_id.clone(),
            status: match snapshot.health {
                crate::node_registry::runtime_snapshot::NodeHealth::Online => "online".to_string(),
                crate::node_registry::runtime_snapshot::NodeHealth::Offline => "offline".to_string(),
                crate::node_registry::runtime_snapshot::NodeHealth::NotReady => "not_ready".to_string(),
            },
            health: format!("{:?}", snapshot.health),
            capabilities: RedisNodeCapabilities {
                asr_languages: snapshot.capabilities.asr_languages.clone(),
                tts_languages: snapshot.capabilities.tts_languages.clone(),
                semantic_languages: snapshot.capabilities.semantic_languages.clone(),
            },
            resources: RedisNodeResources {
                max_concurrency: snapshot.max_concurrency,
                current_jobs: snapshot.current_jobs,
                cpu_usage: snapshot.cpu_usage,
                gpu_usage: snapshot.gpu_usage,
                memory_usage: snapshot.memory_usage,
            },
            pool_ids: snapshot.pool_ids.to_vec(),
            installed_services,
            features_supported,
            last_heartbeat_ms: chrono::Utc::now().timestamp_millis(),
            version,
        }
    }
}

/// Redis 中存储的 Phase3 配置格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisPhase3Config {
    pub config: Phase3Config,
    pub version: u64,
    pub updated_at_ms: i64,
}

impl RedisPhase3Config {
    pub fn from_config(config: Phase3Config, version: u64) -> Self {
        Self {
            config,
            version,
            updated_at_ms: chrono::Utc::now().timestamp_millis(),
        }
    }
}
