use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub node_id: String,
    pub name: String,
    pub online: bool,
    pub cpu_usage: f32,
    pub gpu_usage: Option<f32>,
    pub memory_usage: f32,
    pub installed_models: Vec<String>,
    pub current_jobs: usize,
    pub max_concurrent_jobs: usize,
    pub last_heartbeat: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
pub struct NodeRegistry {
    nodes: Arc<RwLock<HashMap<String, Node>>>,
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self {
            nodes: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register_node(&self, name: String) -> Node {
        let node_id = format!("node-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        let node = Node {
            node_id: node_id.clone(),
            name,
            online: true,
            cpu_usage: 0.0,
            gpu_usage: None,
            memory_usage: 0.0,
            installed_models: Vec::new(),
            current_jobs: 0,
            max_concurrent_jobs: 4,
            last_heartbeat: chrono::Utc::now(),
        };

        let mut nodes = self.nodes.write().await;
        nodes.insert(node_id, node.clone());
        node
    }

    pub async fn update_node_heartbeat(
        &self,
        node_id: &str,
        cpu_usage: f32,
        gpu_usage: Option<f32>,
        memory_usage: f32,
        installed_models: Vec<String>,
        current_jobs: usize,
    ) -> bool {
        let mut nodes = self.nodes.write().await;
        if let Some(node) = nodes.get_mut(node_id) {
            node.online = true;
            node.cpu_usage = cpu_usage;
            node.gpu_usage = gpu_usage;
            node.memory_usage = memory_usage;
            node.installed_models = installed_models;
            node.current_jobs = current_jobs;
            node.last_heartbeat = chrono::Utc::now();
            true
        } else {
            false
        }
    }

    pub async fn is_node_available(&self, node_id: &str) -> bool {
        let nodes = self.nodes.read().await;
        if let Some(node) = nodes.get(node_id) {
            node.online && node.current_jobs < node.max_concurrent_jobs
        } else {
            false
        }
    }

    pub async fn select_random_node(&self, src_lang: &str, tgt_lang: &str) -> Option<String> {
        let nodes = self.nodes.read().await;
        
        // 筛选可用的节点（在线且未满载，且安装了所需的模型）
        let available_nodes: Vec<_> = nodes
            .values()
            .filter(|node| {
                node.online
                    && node.current_jobs < node.max_concurrent_jobs
                    && self.node_has_required_models(node, src_lang, tgt_lang)
            })
            .collect();

        if available_nodes.is_empty() {
            return None;
        }

        // 简单随机选择（实际应该考虑负载均衡）
        // 使用第一个可用节点（TODO: 实现真正的负载均衡）
        Some(available_nodes[0].node_id.clone())
    }

    fn node_has_required_models(&self, node: &Node, src_lang: &str, tgt_lang: &str) -> bool {
        // 简化检查：节点需要安装 ASR、NMT、TTS 模型
        // TODO: 更精确的模型匹配逻辑
        !node.installed_models.is_empty()
    }

    pub async fn mark_node_offline(&self, node_id: &str) {
        let mut nodes = self.nodes.write().await;
        if let Some(node) = nodes.get_mut(node_id) {
            node.online = false;
        }
    }
}

