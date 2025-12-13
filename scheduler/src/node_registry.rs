use crate::messages::{FeatureFlags, HardwareInfo, InstalledModel, CapabilityState, ModelStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub node_id: String,
    pub name: String,
    pub version: String,
    pub platform: String, // "windows" | "linux" | "macos"
    pub hardware: HardwareInfo,
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

#[derive(Clone)]
pub struct NodeRegistry {
    nodes: Arc<RwLock<HashMap<String, Node>>>,
    /// 资源使用率阈值（超过此值的节点将被跳过）
    resource_threshold: f32,
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self {
            nodes: Arc::new(RwLock::new(HashMap::new())),
            resource_threshold: 25.0, // 默认 25%
        }
    }

    pub fn with_resource_threshold(threshold: f32) -> Self {
        Self {
            nodes: Arc::new(RwLock::new(HashMap::new())),
            resource_threshold: threshold,
        }
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
            return Err("节点必须有 GPU 才能注册为算力提供方".to_string());
        }
        
        let node_id = node_id.unwrap_or_else(|| {
            format!("node-{}", Uuid::new_v4().to_string()[..8].to_uppercase())
        });
        
        // 如果没有提供 capability_state，从 installed_models 推断
        let capability_state = capability_state.unwrap_or_else(|| {
            installed_models.iter()
                .map(|m| (m.model_id.clone(), ModelStatus::Ready))
                .collect()
        });

        let node = Node {
            node_id: node_id.clone(),
            name,
            version,
            platform,
            hardware,
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

        let mut nodes = self.nodes.write().await;
        nodes.insert(node_id.clone(), node.clone());
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
        
        // 筛选可用的节点
        let mut available_nodes: Vec<_> = nodes
            .values()
            .filter(|node| {
                node.online
                    && node.current_jobs < node.max_concurrent_jobs
                    && (accept_public || !node.accept_public_jobs) // 如果 accept_public=false，只选择不接受公共任务的节点
                    && self.node_has_required_models(node, src_lang, tgt_lang)
                    && self.node_supports_features(node, required_features)
                    && self.is_node_resource_available(node) // 检查资源使用率是否低于阈值
            })
            .collect();

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
        
        // 筛选可用的节点
        let mut available_nodes: Vec<_> = nodes
            .values()
            .filter(|node| {
                node.online
                    && node.current_jobs < node.max_concurrent_jobs
                    && (accept_public || !node.accept_public_jobs)
                    && self.node_has_required_models(node, src_lang, tgt_lang)
                    && self.node_has_models_ready(node, required_model_ids)
                    && self.is_node_resource_available(node) // 检查资源使用率是否低于阈值
            })
            .collect();

        if available_nodes.is_empty() {
            return None;
        }

        // 负载均衡：按 current_jobs 排序，选择任务数最少的节点
        available_nodes.sort_by_key(|node| node.current_jobs);
        Some(available_nodes[0].node_id.clone())
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

