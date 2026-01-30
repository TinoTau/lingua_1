//! 节点数据模型
//! 
//! Redis 直查架构的核心数据结构

use serde::{Deserialize, Serialize};
use crate::messages::{HardwareInfo, InstalledService, FeatureFlags};

/// 无方向多语言互译集合（已排序去重）
/// 例如：["en", "zh"] 表示支持中英互译
pub type LangSet = Vec<String>;

/// 节点在 Redis 中的数据模型（完整版）
/// 
/// 阶段2：包含所有调度所需字段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeData {
    /// 节点唯一标识
    pub node_id: String,
    
    /// 支持的语言集合列表
    /// 例如：[["en","zh"], ["en","ja","zh"]]
    pub lang_sets: Vec<LangSet>,
    
    /// 最后心跳时间戳（Unix 秒）
    pub last_heartbeat_ts: i64,
    
    /// 节点状态：online | offline | not_ready
    pub status: String,
    
    /// 地理区域（例如：cn-east, us-west）
    #[serde(default)]
    pub region: Option<String>,
    
    /// GPU 层级（例如：high, medium, low）
    #[serde(default)]
    pub gpu_tier: Option<String>,
    
    /// 硬件信息
    #[serde(default)]
    pub hardware: Option<HardwareInfo>,
    
    /// 最大并发任务数
    #[serde(default)]
    pub max_concurrency: u32,
    
    /// 当前任务数
    #[serde(default)]
    pub current_jobs: usize,
    
    /// 是否接受公共任务
    #[serde(default = "default_accept_public")]
    pub accept_public_jobs: bool,
    
    /// 是否有 GPU
    #[serde(default)]
    pub has_gpu: bool,
    
    /// 已安装服务列表
    #[serde(default)]
    pub installed_services: Vec<InstalledService>,
    
    /// CPU 使用率（0.0-1.0）
    #[serde(default)]
    pub cpu_usage: f32,
    
    /// GPU 使用率（0.0-1.0）
    #[serde(default)]
    pub gpu_usage: Option<f32>,
    
    /// 内存使用率（0.0-1.0）
    #[serde(default)]
    pub memory_usage: f32,
    
    /// 支持的特性标志
    #[serde(default)]
    pub features_supported: FeatureFlags,
    
    /// 是否在线（WebSocket 连接状态）
    #[serde(default)]
    pub online: bool,
}

fn default_accept_public() -> bool {
    true
}

impl NodeData {
    /// 创建新的节点数据（简化版，用于测试）
    #[cfg(test)]
    pub fn new(
        node_id: String,
        lang_sets: Vec<LangSet>,
        last_heartbeat_ts: i64,
        status: String,
    ) -> Self {
        Self {
            node_id,
            lang_sets,
            last_heartbeat_ts,
            status,
            region: None,
            gpu_tier: None,
            hardware: None,
            max_concurrency: 10,
            current_jobs: 0,
            accept_public_jobs: true,
            has_gpu: false,
            installed_services: Vec::new(),
            cpu_usage: 0.0,
            gpu_usage: None,
            memory_usage: 0.0,
            features_supported: FeatureFlags::default(),
            online: true,
        }
    }
    
    /// 创建完整的节点数据
    #[allow(clippy::too_many_arguments)]
    pub fn new_full(
        node_id: String,
        lang_sets: Vec<LangSet>,
        last_heartbeat_ts: i64,
        status: String,
        region: Option<String>,
        gpu_tier: Option<String>,
        hardware: Option<HardwareInfo>,
        max_concurrency: u32,
        current_jobs: usize,
        accept_public_jobs: bool,
        has_gpu: bool,
        installed_services: Vec<InstalledService>,
        cpu_usage: f32,
        gpu_usage: Option<f32>,
        memory_usage: f32,
        features_supported: FeatureFlags,
        online: bool,
    ) -> Self {
        Self {
            node_id,
            lang_sets,
            last_heartbeat_ts,
            status,
            region,
            gpu_tier,
            hardware,
            max_concurrency,
            current_jobs,
            accept_public_jobs,
            has_gpu,
            installed_services,
            cpu_usage,
            gpu_usage,
            memory_usage,
            features_supported,
            online,
        }
    }
    
    /// 判断节点是否在线
    /// 
    /// 基于 status 字段和心跳时间戳
    pub fn is_online(&self, now_ts: i64, timeout_secs: i64) -> bool {
        self.status == "online" && (now_ts - self.last_heartbeat_ts) <= timeout_secs
    }
    
    /// 判断节点是否准备就绪（可调度）
    #[cfg(test)]
    pub fn is_ready_for_dispatch(&self, now_ts: i64, timeout_secs: i64) -> bool {
        self.is_online(now_ts, timeout_secs) 
            && self.status != "not_ready" 
            && self.current_jobs < self.max_concurrency as usize
    }
    
    /// 判断节点是否有可用容量
    #[cfg(test)]
    pub fn has_capacity(&self) -> bool {
        self.current_jobs < self.max_concurrency as usize
    }
    
    /// 检查资源使用率是否超过阈值
    #[cfg(test)]
    pub fn exceeds_resource_threshold(&self, threshold: f32) -> bool {
        self.cpu_usage >= threshold 
            || self.gpu_usage.map_or(false, |g| g >= threshold)
            || self.memory_usage >= threshold
    }
    
    /// 规范化 LangSet（排序去重）
    pub fn normalize_langset(mut langset: LangSet) -> LangSet {
        langset.sort();
        langset.dedup();
        langset
    }
    
    /// 检查节点是否支持指定的语言集合
    #[cfg(test)]
    pub fn supports_langset(&self, target: &LangSet) -> bool {
        let normalized_target = Self::normalize_langset(target.clone());
        self.lang_sets.iter().any(|ls| ls == &normalized_target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_normalize_langset() {
        let langset = vec!["zh".to_string(), "en".to_string(), "zh".to_string()];
        let normalized = NodeData::normalize_langset(langset);
        assert_eq!(normalized, vec!["en", "zh"]);
    }
    
    #[test]
    fn test_is_online() {
        let node = NodeData::new(
            "node1".to_string(),
            vec![],
            1000,
            "online".to_string(),
        );
        
        // 在超时范围内
        assert!(node.is_online(1100, 3600));
        
        // 超时
        assert!(!node.is_online(5000, 3600));
        
        // 状态为 offline
        let offline_node = NodeData {
            status: "offline".to_string(),
            ..node
        };
        assert!(!offline_node.is_online(1100, 3600));
    }
    
    #[test]
    fn test_is_ready_for_dispatch() {
        let node = NodeData::new(
            "node1".to_string(),
            vec![],
            1000,
            "online".to_string(),
        );
        
        // 正常情况：在线且有容量
        assert!(node.is_ready_for_dispatch(1100, 3600));
        
        // 任务已满
        let full_node = NodeData {
            current_jobs: 10,
            ..node.clone()
        };
        assert!(!full_node.is_ready_for_dispatch(1100, 3600));
        
        // 超时
        assert!(!node.is_ready_for_dispatch(5000, 3600));
    }
    
    #[test]
    fn test_has_capacity() {
        let node = NodeData::new(
            "node1".to_string(),
            vec![],
            1000,
            "online".to_string(),
        );
        
        assert!(node.has_capacity());
        
        let full_node = NodeData {
            current_jobs: 10,
            ..node
        };
        assert!(!full_node.has_capacity());
    }
    
    #[test]
    fn test_exceeds_resource_threshold() {
        let node = NodeData {
            cpu_usage: 0.5,
            gpu_usage: Some(0.6),
            memory_usage: 0.4,
            ..NodeData::new(
                "node1".to_string(),
                vec![],
                1000,
                "online".to_string(),
            )
        };
        
        // 未超过阈值
        assert!(!node.exceeds_resource_threshold(0.9));
        
        // 超过阈值
        assert!(node.exceeds_resource_threshold(0.5));
    }
    
    #[test]
    fn test_supports_langset() {
        let node = NodeData::new(
            "node1".to_string(),
            vec![
                vec!["en".to_string(), "zh".to_string()],
                vec!["en".to_string(), "ja".to_string(), "zh".to_string()],
            ],
            1000,
            "online".to_string(),
        );
        
        // 支持的语言集合
        assert!(node.supports_langset(&vec!["zh".to_string(), "en".to_string()]));
        assert!(node.supports_langset(&vec!["en".to_string(), "ja".to_string(), "zh".to_string()]));
        
        // 不支持的语言集合
        assert!(!node.supports_langset(&vec!["fr".to_string(), "en".to_string()]));
    }
}
