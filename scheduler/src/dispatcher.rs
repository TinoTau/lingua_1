use crate::node_registry::NodeRegistry;
use crate::messages::{FeatureFlags, PipelineConfig};
use crate::module_resolver::ModuleResolver;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub job_id: String,
    pub session_id: String,
    pub utterance_index: u64,
    pub src_lang: String,  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
    pub tgt_lang: String,
    pub dialect: Option<String>,
    pub features: Option<FeatureFlags>,
    pub pipeline: PipelineConfig,
    pub audio_data: Vec<u8>,
    pub audio_format: String,
    pub sample_rate: u32,
    pub assigned_node_id: Option<String>,
    pub status: JobStatus,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// 翻译模式："one_way" | "two_way_auto"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// 双向模式的语言 A（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_a: Option<String>,
    /// 双向模式的语言 B（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_b: Option<String>,
    /// 自动识别时限制的语言范围（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_langs: Option<Vec<String>>,
    /// 是否启用流式 ASR（部分结果输出）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_streaming_asr: Option<bool>,
    /// 部分结果更新间隔（毫秒），仅在 enable_streaming_asr 为 true 时有效
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_update_interval_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobStatus {
    Pending,
    Assigned,
    Processing,
    Completed,
    Failed,
}

#[derive(Clone)]
pub struct JobDispatcher {
    node_registry: Arc<NodeRegistry>,
    jobs: Arc<RwLock<std::collections::HashMap<String, Job>>>,
}

impl JobDispatcher {
    pub fn new(node_registry: Arc<NodeRegistry>) -> Self {
        Self {
            node_registry,
            jobs: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    pub async fn create_job(
        &self,
        session_id: String,
        utterance_index: u64,
        src_lang: String,
        tgt_lang: String,
        dialect: Option<String>,
        features: Option<FeatureFlags>,
        pipeline: PipelineConfig,
        audio_data: Vec<u8>,
        audio_format: String,
        sample_rate: u32,
        preferred_node_id: Option<String>,
        mode: Option<String>,
        lang_a: Option<String>,
        lang_b: Option<String>,
        auto_langs: Option<Vec<String>>,
        enable_streaming_asr: Option<bool>,
        partial_update_interval_ms: Option<u64>,
    ) -> Job {
        let job_id = format!("job-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        
        // 根据 v2 技术说明书，使用模块依赖展开算法选择节点
        let assigned_node_id = if let Some(node_id) = preferred_node_id {
            // 如果指定了节点，检查节点是否可用
            if self.node_registry.is_node_available(&node_id).await {
                // 还需要检查节点是否具备所需的模型能力
                if let Some(features) = &features {
                    if let Ok(required_models) = self.get_required_models_for_features(Some(features), &src_lang, &tgt_lang) {
                        if !self.node_registry.check_node_has_models_ready(&node_id, &required_models).await {
                            // 节点不具备所需模型，回退到功能感知选择
                            self.select_node_with_module_expansion(&src_lang, &tgt_lang, Some(features.clone()), true).await
                        } else {
                            Some(node_id)
                        }
                    } else {
                        Some(node_id)
                    }
                } else {
                    Some(node_id)
                }
            } else {
                // 回退到功能感知选择
                self.select_node_with_module_expansion(&src_lang, &tgt_lang, features.clone(), true).await
            }
        } else {
            // 使用模块依赖展开算法选择节点
            self.select_node_with_module_expansion(&src_lang, &tgt_lang, features.clone(), true).await
        };

        let job = Job {
            job_id: job_id.clone(),
            session_id,
            utterance_index,
            src_lang,
            tgt_lang,
            dialect,
            features,
            pipeline,
            audio_data,
            audio_format,
            sample_rate,
            assigned_node_id: assigned_node_id.clone(),
            status: if assigned_node_id.is_some() {
                JobStatus::Assigned
            } else {
                JobStatus::Pending
            },
            created_at: chrono::Utc::now(),
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr,
            partial_update_interval_ms,
        };

        let mut jobs = self.jobs.write().await;
        jobs.insert(job_id, job.clone());
        job
    }

    pub async fn get_job(&self, job_id: &str) -> Option<Job> {
        let jobs = self.jobs.read().await;
        jobs.get(job_id).cloned()
    }

    pub async fn update_job_status(&self, job_id: &str, status: JobStatus) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            job.status = status;
            true
        } else {
            false
        }
    }

    /// 使用模块依赖展开算法选择节点
    /// 
    /// 按照 v2 技术说明书的步骤：
    /// 1. 解析用户请求 features
    /// 2. 递归展开依赖链
    /// 3. 收集 required_models
    /// 4. 过滤 capability_state == ready 的节点
    /// 5. 负载均衡选节点
    async fn select_node_with_module_expansion(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        features: Option<FeatureFlags>,
        accept_public: bool,
    ) -> Option<String> {
        // 步骤 1: 解析用户请求 features
        let module_names = if let Some(ref features) = features {
            ModuleResolver::parse_features_to_modules(features)
        } else {
            // 如果没有 features，只使用核心模块
            vec!["asr".to_string(), "nmt".to_string(), "tts".to_string()]
        };

        // 步骤 2: 递归展开依赖链
        let _expanded_modules = match ModuleResolver::expand_dependencies(&module_names) {
            Ok(modules) => modules,
            Err(e) => {
                tracing::warn!("Failed to expand module dependencies: {}", e);
                // 回退到原来的方法
                return self.node_registry.select_node_with_features(src_lang, tgt_lang, &features, accept_public).await;
            }
        };

        // 步骤 3: 收集 required_models
        let required_models = match self.get_required_models_for_features(features.as_ref(), src_lang, tgt_lang) {
            Ok(models) => models,
            Err(e) => {
                tracing::warn!("Failed to collect required models: {}", e);
                // 回退到原来的方法
                return self.node_registry.select_node_with_features(src_lang, tgt_lang, &features, accept_public).await;
            }
        };

        // 步骤 4 & 5: 过滤 capability_state == ready 的节点，并负载均衡
        self.node_registry.select_node_with_models(src_lang, tgt_lang, &required_models, accept_public).await
    }

    /// 获取功能所需的模型列表
    fn get_required_models_for_features(
        &self,
        features: Option<&FeatureFlags>,
        _src_lang: &str,
        _tgt_lang: &str,
    ) -> anyhow::Result<Vec<String>> {
        let mut model_ids = Vec::new();

        // 核心模块的模型（这里简化处理，实际应该从配置或请求中获取具体模型 ID）
        // TODO: 从配置或请求中获取 ASR/NMT/TTS 的具体模型 ID
        // 当前先跳过，只收集可选模块的模型

        // 可选模块的模型
        if let Some(features) = features {
            let module_names = ModuleResolver::parse_features_to_modules(features);
            let optional_models = ModuleResolver::collect_required_models(&module_names)?;
            model_ids.extend(optional_models);
        }

        Ok(model_ids)
    }
}

