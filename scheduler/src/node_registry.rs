use crate::messages::{FeatureFlags, HardwareInfo, InstalledModel, CapabilityState, ModelStatus, NodeStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;
use tracing::{info, warn, debug};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub node_id: String,
    pub name: String,
    pub version: String,
    pub platform: String, // "windows" | "linux" | "macos"
    pub hardware: HardwareInfo,
    /// 节点生命周期状态（Scheduler 权威）
    pub status: NodeStatus,
    pub online: bool,
    pub cpu_usage: f32,
    pub gpu_usage: Option<f32>,
    pub memory_usage: f32,
    pub installed_models: Vec<InstalledModel>,
    pub features_supported: FeatureFlags,
    pub accept_public_jobs: bool,
    /// 节点模型能力图（capability_state）
    pub capability_state: CapabilityState,
    pub current_jobs: usize,
    pub max_concurrent_jobs: usize,
    pub last_heartbeat: chrono::DateTime<chrono::Utc>,
}

/// 调度过滤排除原因
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum DispatchExcludeReason {
    StatusNotReady,
    NotInPublicPool,
    GpuUnavailable,
    ModelNotAvailable,
    CapacityExceeded,
    ResourceThresholdExceeded,
}

#[derive(Clone)]
pub struct NodeRegistry {
    pub(crate) nodes: Arc<RwLock<HashMap<String, Node>>>,
    /// 资源使用率阈值（超过此值的节点将被跳过）
    resource_threshold: f32,
    /// 调度排除原因统计（用于聚合统计）
    /// key: 排除原因, value: (总次数, 示例节点 ID 列表（最多 Top-K）)
    exclude_reason_stats: Arc<RwLock<HashMap<DispatchExcludeReason, (usize, Vec<String>)>>>,
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self {
            nodes: Arc::new(RwLock::new(HashMap::new())),
            resource_threshold: 25.0, // 默认 25%
            exclude_reason_stats: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn with_resource_threshold(threshold: f32) -> Self {
        Self {
            nodes: Arc::new(RwLock::new(HashMap::new())),
            resource_threshold: threshold,
            exclude_reason_stats: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// 记录调度排除原因（聚合统计 + Top-K 示例）
    async fn record_exclude_reason(&self, reason: DispatchExcludeReason, node_id: String) {
        let mut stats = self.exclude_reason_stats.write().await;
        let entry = stats.entry(reason.clone()).or_insert_with(|| (0, Vec::new()));
        entry.0 += 1;
        
        // Top-K 示例（最多保留 5 个节点 ID）
        const TOP_K: usize = 5;
        if entry.1.len() < TOP_K && !entry.1.contains(&node_id) {
            entry.1.push(node_id.clone());
        }
        
        debug!(
            node_id = %node_id,
            reason = ?reason,
            total_count = entry.0,
            "调度过滤：节点被排除"
        );
    }
    
    /// 获取调度排除原因统计（用于日志输出）
    pub async fn get_exclude_reason_stats(&self) -> HashMap<DispatchExcludeReason, (usize, Vec<String>)> {
        self.exclude_reason_stats.read().await.clone()
    }
    
    /// 清除调度排除原因统计（定期调用，避免内存无限增长）
    pub async fn clear_exclude_reason_stats(&self) {
        let mut stats = self.exclude_reason_stats.write().await;
        stats.clear();
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
    pub async fn register_node(
        &self,
        node_id: Option<String>,
        name: String,
        version: String,
        platform: String,
        hardware: HardwareInfo,
        installed_models: Vec<InstalledModel>,
        features_supported: FeatureFlags,
        accept_public_jobs: bool,
        capability_state: Option<CapabilityState>,
    ) -> Result<Node, String> {
        // 检查节点是否有 GPU（必需）
        if hardware.gpus.is_none() || hardware.gpus.as_ref().unwrap().is_empty() {
            warn!(
                name = %name,
                version = %version,
                platform = %platform,
                "节点注册失败：没有 GPU"
            );
            return Err("节点必须有 GPU 才能注册为算力提供方".to_string());
        }
        
        let mut nodes = self.nodes.write().await;
        
        // node_id 冲突检测（最小实现）
        let final_node_id = if let Some(provided_id) = node_id {
            // 如果提供了 node_id，检查是否已存在
            if nodes.contains_key(&provided_id) {
                warn!(
                    node_id = %provided_id,
                    name = %name,
                    "节点注册失败：node_id 冲突"
                );
                return Err("节点 ID 冲突，请清除本地 node_id 后重新注册".to_string());
            }
            provided_id
        } else {
            // 生成新的 node_id
            format!("node-{}", Uuid::new_v4().to_string()[..8].to_uppercase())
        };
        
        // 如果没有提供 capability_state，从 installed_models 推断
        let capability_state = capability_state.unwrap_or_else(|| {
            installed_models.iter()
                .map(|m| (m.model_id.clone(), ModelStatus::Ready))
                .collect()
        });

        // 保存用于日志的字段（在 move 之前）
        let gpu_count = hardware.gpus.as_ref().map(|gpus| gpus.len()).unwrap_or(0);
        let model_count = installed_models.len();
        
        let node = Node {
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
            features_supported,
            accept_public_jobs,
            capability_state,
            current_jobs: 0,
            max_concurrent_jobs: 4,
            last_heartbeat: chrono::Utc::now(),
        };

        nodes.insert(final_node_id.clone(), node.clone());
        
        info!(
            node_id = %final_node_id,
            name = %name,
            version = %version,
            platform = %platform,
            gpu_count = gpu_count,
            model_count = model_count,
            accept_public_jobs = node.accept_public_jobs,
            status = ?NodeStatus::Registering,
            "节点注册成功"
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
        current_jobs: usize,
        capability_state: Option<CapabilityState>,
    ) -> bool {
        let mut nodes = self.nodes.write().await;
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
            if let Some(cap_state) = capability_state {
                node.capability_state = cap_state;
            }
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
    
    /// 获取节点状态（用于测试）
    pub async fn get_node_status(&self, node_id: &str) -> Option<NodeStatus> {
        let nodes = self.nodes.read().await;
        nodes.get(node_id).map(|node| node.status.clone())
    }
    
    /// 设置节点状态（用于测试）
    pub async fn set_node_status(&self, node_id: &str, status: NodeStatus) -> bool {
        let mut nodes = self.nodes.write().await;
        if let Some(node) = nodes.get_mut(node_id) {
            node.status = status;
            true
        } else {
            false
        }
    }

    pub async fn select_random_node(&self, src_lang: &str, tgt_lang: &str) -> Option<String> {
        // 使用功能感知选择（不要求特定功能）
        self.select_node_with_features(src_lang, tgt_lang, &None, true).await
    }

    fn node_has_required_models(&self, node: &Node, src_lang: &str, tgt_lang: &str) -> bool {
        // 检查节点是否安装了所需的模型（使用 capability_state）
        // 优先使用 capability_state，如果没有则回退到 installed_models
        
        // 检查 ASR 模型（需要至少一个 ASR 模型为 ready）
        let has_asr = node.capability_state.iter()
            .any(|(model_id, status)| {
                status == &ModelStatus::Ready && 
                node.installed_models.iter()
                    .any(|m| m.model_id == *model_id && m.kind == "asr")
            }) || node.installed_models.iter().any(|m| m.kind == "asr");
        
        // 检查 NMT 模型
        let has_nmt = node.capability_state.iter()
            .any(|(model_id, status)| {
                status == &ModelStatus::Ready &&
                node.installed_models.iter()
                    .any(|m| {
                        m.model_id == *model_id &&
                        m.kind == "nmt" &&
                        m.src_lang.as_deref() == Some(src_lang) &&
                        m.tgt_lang.as_deref() == Some(tgt_lang)
                    })
            }) || node.installed_models.iter().any(|m| {
                m.kind == "nmt"
                    && m.src_lang.as_deref() == Some(src_lang)
                    && m.tgt_lang.as_deref() == Some(tgt_lang)
            });
        
        // 检查 TTS 模型
        let has_tts = node.capability_state.iter()
            .any(|(model_id, status)| {
                status == &ModelStatus::Ready &&
                node.installed_models.iter()
                    .any(|m| {
                        m.model_id == *model_id &&
                        m.kind == "tts" &&
                        m.tgt_lang.as_deref() == Some(tgt_lang)
                    })
            }) || node.installed_models.iter().any(|m| {
                m.kind == "tts" && m.tgt_lang.as_deref() == Some(tgt_lang)
            });
        
        has_asr && has_nmt && has_tts
    }

    /// 检查节点是否具备所需的模型（通过 capability_state）
    /// 
    /// # Arguments
    /// * `node` - 节点
    /// * `required_model_ids` - 所需的模型 ID 列表
    /// 
    /// # Returns
    /// * `true` - 所有所需模型的状态都是 `Ready`
    /// * `false` - 至少有一个模型不是 `Ready`
    pub fn node_has_models_ready(&self, node: &Node, required_model_ids: &[String]) -> bool {
        required_model_ids.iter().all(|model_id| {
            node.capability_state
                .get(model_id)
                .map(|status| status == &ModelStatus::Ready)
                .unwrap_or(false)
        })
    }

    pub async fn select_node_with_features(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_features: &Option<FeatureFlags>,
        accept_public: bool,
    ) -> Option<String> {
        let nodes = self.nodes.read().await;
        
        // 筛选可用的节点（硬过滤：status == ready）
        let mut available_nodes: Vec<_> = Vec::new();
        
        for node in nodes.values() {
            // 记录排除原因（用于聚合统计）
            if node.status != NodeStatus::Ready {
                self.record_exclude_reason(DispatchExcludeReason::StatusNotReady, node.node_id.clone()).await;
                continue;
            }
            
            if !node.online {
                continue;
            }
            
            if !(accept_public || !node.accept_public_jobs) {
                self.record_exclude_reason(DispatchExcludeReason::NotInPublicPool, node.node_id.clone()).await;
                continue;
            }
            
            // 检查 GPU 可用性
            if node.hardware.gpus.is_none() || node.hardware.gpus.as_ref().unwrap().is_empty() {
                self.record_exclude_reason(DispatchExcludeReason::GpuUnavailable, node.node_id.clone()).await;
                continue;
            }
            
            if !self.node_has_required_models(node, src_lang, tgt_lang) {
                self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                continue;
            }
            
            if !self.node_supports_features(node, required_features) {
                self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                continue;
            }
            
            if node.current_jobs >= node.max_concurrent_jobs {
                self.record_exclude_reason(DispatchExcludeReason::CapacityExceeded, node.node_id.clone()).await;
                continue;
            }
            
            if !self.is_node_resource_available(node) {
                self.record_exclude_reason(DispatchExcludeReason::ResourceThresholdExceeded, node.node_id.clone()).await;
                continue;
            }
            
            // 通过所有检查，加入候选列表
            available_nodes.push(node);
        }

        if available_nodes.is_empty() {
            return None;
        }

        // 最少连接数策略：按 current_jobs 排序，选择任务数最少的节点
        available_nodes.sort_by_key(|node| node.current_jobs);
        Some(available_nodes[0].node_id.clone())
    }

    fn node_supports_features(&self, node: &Node, required_features: &Option<FeatureFlags>) -> bool {
        if let Some(ref features) = required_features {
            // 检查节点是否支持所有必需的功能
            // 只有当 required_features 中明确要求为 true 时，才检查节点是否支持
            
            // 情感检测
            if features.emotion_detection == Some(true) 
                && node.features_supported.emotion_detection != Some(true) {
                return false;
            }
            
            // 音色风格检测
            if features.voice_style_detection == Some(true)
                && node.features_supported.voice_style_detection != Some(true) {
                return false;
            }
            
            // 语速检测
            if features.speech_rate_detection == Some(true)
                && node.features_supported.speech_rate_detection != Some(true) {
                return false;
            }
            
            // 语速控制
            if features.speech_rate_control == Some(true)
                && node.features_supported.speech_rate_control != Some(true) {
                return false;
            }
            
            // 说话人识别
            if features.speaker_identification == Some(true)
                && node.features_supported.speaker_identification != Some(true) {
                return false;
            }
            
            // 角色适应
            if features.persona_adaptation == Some(true)
                && node.features_supported.persona_adaptation != Some(true) {
                return false;
            }
        }
        true
    }

    pub async fn mark_node_offline(&self, node_id: &str) {
        let mut nodes = self.nodes.write().await;
        if let Some(node) = nodes.get_mut(node_id) {
            node.online = false;
        }
    }

    /// 检查指定节点是否具备所需的模型（异步版本）
    pub async fn check_node_has_models_ready(&self, node_id: &str, required_model_ids: &[String]) -> bool {
        let nodes = self.nodes.read().await;
        if let Some(node) = nodes.get(node_id) {
            self.node_has_models_ready(node, required_model_ids)
        } else {
            false
        }
    }

    /// 根据模型需求选择节点
    /// 
    /// # Arguments
    /// * `src_lang` - 源语言
    /// * `tgt_lang` - 目标语言
    /// * `required_model_ids` - 所需的模型 ID 列表
    /// * `accept_public` - 是否接受公共任务
    /// 
    /// # Returns
    /// * `Some(node_id)` - 找到符合条件的节点
    /// * `None` - 没有符合条件的节点
    pub async fn select_node_with_models(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_model_ids: &[String],
        accept_public: bool,
    ) -> Option<String> {
        let nodes = self.nodes.read().await;
        
        // 筛选可用的节点（硬过滤：status == ready）
        let mut available_nodes: Vec<_> = Vec::new();
        
        for node in nodes.values() {
            // 记录排除原因（用于聚合统计）
            if node.status != NodeStatus::Ready {
                self.record_exclude_reason(DispatchExcludeReason::StatusNotReady, node.node_id.clone()).await;
                continue;
            }
            
            if !node.online {
                continue;
            }
            
            if !(accept_public || !node.accept_public_jobs) {
                self.record_exclude_reason(DispatchExcludeReason::NotInPublicPool, node.node_id.clone()).await;
                continue;
            }
            
            // 检查 GPU 可用性
            if node.hardware.gpus.is_none() || node.hardware.gpus.as_ref().unwrap().is_empty() {
                self.record_exclude_reason(DispatchExcludeReason::GpuUnavailable, node.node_id.clone()).await;
                continue;
            }
            
            if !self.node_has_required_models(node, src_lang, tgt_lang) {
                self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                continue;
            }
            
            if !self.node_has_models_ready(node, required_model_ids) {
                self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                continue;
            }
            
            if node.current_jobs >= node.max_concurrent_jobs {
                self.record_exclude_reason(DispatchExcludeReason::CapacityExceeded, node.node_id.clone()).await;
                continue;
            }
            
            if !self.is_node_resource_available(node) {
                self.record_exclude_reason(DispatchExcludeReason::ResourceThresholdExceeded, node.node_id.clone()).await;
                continue;
            }
            
            // 通过所有检查，加入候选列表
            available_nodes.push(node);
        }

        if available_nodes.is_empty() {
            // 记录统计信息（用于日志输出）
            let stats = self.get_exclude_reason_stats().await;
            if !stats.is_empty() {
                debug!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    required_models = ?required_model_ids,
                    exclude_stats = ?stats,
                    "调度过滤：没有可用节点"
                );
            }
            return None;
        }

        // 负载均衡：按 current_jobs 排序，选择任务数最少的节点
        available_nodes.sort_by_key(|node| node.current_jobs);
        let selected_node_id = available_nodes[0].node_id.clone();
        
        debug!(
            node_id = %selected_node_id,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            required_models = ?required_model_ids,
            candidate_count = available_nodes.len(),
            "调度过滤：选择节点"
        );
        
        Some(selected_node_id)
    }

    /// 检查节点资源使用率是否可用（低于阈值）
    /// 
    /// 根据设计理念：调度服务器只负责跳过高负载节点，具体计算压力交给节点端
    /// 节点端通过心跳传递资源使用率，调度服务器只需简单过滤即可
    /// 
    /// # 要求
    /// - GPU 使用率必须检查（所有节点都必须有 GPU）
    fn is_node_resource_available(&self, node: &Node) -> bool {
        // 检查 CPU 使用率
        if node.cpu_usage > self.resource_threshold {
            return false;
        }
        
        // 检查 GPU 使用率（必需，所有节点都必须有 GPU）
        if let Some(gpu_usage) = node.gpu_usage {
            if gpu_usage > self.resource_threshold {
                return false;
            }
        } else {
            // 如果没有 GPU 使用率，节点不可用（不应该发生，因为注册时已检查）
            return false;
        }
        
        // 检查内存使用率
        if node.memory_usage > self.resource_threshold {
            return false;
        }
        
        true
    }
}

