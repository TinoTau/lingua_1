use anyhow::{Result, anyhow};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;
use lazy_static::lazy_static;

/// 模块接口定义
#[async_trait]
pub trait InferenceModule: Send + Sync {
    fn name(&self) -> &str;
    fn is_enabled(&self) -> bool;
    async fn enable(&mut self) -> Result<()>;
    async fn disable(&mut self) -> Result<()>;
}

/// 模块状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleState {
    pub enabled: bool,
    pub model_loaded: bool,
    pub last_used: Option<chrono::DateTime<chrono::Utc>>,
}

/// 模型路径提供者 trait
/// 
/// 用于从 ModelManager 获取模型路径，解耦模块系统和模型管理系统
#[async_trait]
pub trait ModelPathProvider: Send + Sync {
    /// 获取模型路径
    /// 
    /// # Arguments
    /// * `model_id` - 模型 ID
    /// * `version` - 模型版本，None 表示使用 latest
    /// 
    /// # Returns
    /// * `Ok(Some(path))` - 模型已安装，返回路径
    /// * `Ok(None)` - 模型未安装
    /// * `Err(e)` - 获取路径时出错
    async fn get_model_path(&self, model_id: &str, version: Option<&str>) -> Result<Option<std::path::PathBuf>>;
}

/// 模块管理器
pub struct ModuleManager {
    states: Arc<RwLock<HashMap<String, ModuleState>>>,
    /// 模型路径提供者（可选，如果为 None，则跳过模型检查）
    model_path_provider: Option<Arc<dyn ModelPathProvider>>,
}

impl ModuleManager {
    pub fn new() -> Self {
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
            model_path_provider: None,
        }
    }

    /// 创建带模型路径提供者的 ModuleManager
    pub fn with_model_path_provider(provider: Arc<dyn ModelPathProvider>) -> Self {
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
            model_path_provider: Some(provider),
        }
    }

    /// 设置模型路径提供者
    pub fn set_model_path_provider(&mut self, provider: Arc<dyn ModelPathProvider>) {
        self.model_path_provider = Some(provider);
    }

    pub async fn register_module(&self, name: String, state: ModuleState) {
        let mut states = self.states.write().await;
        states.insert(name, state);
    }

    pub async fn is_module_enabled(&self, name: &str) -> bool {
        let states = self.states.read().await;
        states
            .get(name)
            .map(|s| s.enabled && s.model_loaded)
            .unwrap_or(false)
    }

    /// 启用模块（完整流程）
    /// 
    /// 按照 v2 技术说明书的要求：
    /// 1. 检查模块元数据是否存在
    /// 2. 检查依赖循环
    /// 3. 检查冲突模块
    /// 4. 检查模块依赖
    /// 5. 检查所需模型是否可用
    /// 6. 加载模型（由具体模块实现）
    /// 7. 标记为已启用
    pub async fn enable_module(&self, name: &str) -> Result<()> {
        // 步骤 1: 获取模块元数据
        let metadata = MODULE_TABLE.get(name)
            .ok_or_else(|| anyhow!("Module {} not found in MODULE_TABLE", name))?;

        // 步骤 2: 检查依赖循环
        Self::check_dependency_cycle(name)?;

        // 步骤 3: 检查冲突模块
        self.check_conflicts(name).await?;

        // 步骤 4: 检查模块依赖
        self.check_dependencies(name).await?;

        // 步骤 5: 检查所需模型是否可用
        if let Some(ref provider) = self.model_path_provider {
            for model_req in &metadata.required_models {
                let version_str = model_req.version.as_deref();
                match provider.get_model_path(&model_req.model_id, version_str).await {
                    Ok(Some(_)) => {
                        // 模型已安装，继续
                    }
                    Ok(None) => {
                        return Err(anyhow!(
                            "Required model {} (version: {:?}) is not installed",
                            model_req.model_id,
                            version_str
                        ));
                    }
                    Err(e) => {
                        return Err(anyhow!(
                            "Failed to check model {}: {}",
                            model_req.model_id,
                            e
                        ));
                    }
                }
            }
        } else {
            // 如果没有模型路径提供者，跳过模型检查（用于测试或开发环境）
            tracing::warn!("ModelPathProvider not set, skipping model availability check for module {}", name);
        }

        // 步骤 6: 更新模块状态（模型加载由具体模块实现）
        let mut states = self.states.write().await;
        if let Some(state) = states.get_mut(name) {
            state.enabled = true;
            state.last_used = Some(chrono::Utc::now());
            // model_loaded 将在实际加载模型后设置为 true
        } else {
            // 注册新模块
            states.insert(
                name.to_string(),
                ModuleState {
                    enabled: true,
                    model_loaded: false, // 需要加载模型
                    last_used: Some(chrono::Utc::now()),
                },
            );
        }

        Ok(())
    }

    pub async fn disable_module(&self, name: &str) -> Result<()> {
        let mut states = self.states.write().await;
        if let Some(state) = states.get_mut(name) {
            state.enabled = false;
        }
        Ok(())
    }

    pub async fn get_all_states(&self) -> HashMap<String, ModuleState> {
        let states = self.states.read().await;
        states.clone()
    }

    /// 获取模块元数据
    pub fn get_module_metadata(module_name: &str) -> Option<&ModuleMetadata> {
        MODULE_TABLE.get(module_name)
    }

    /// 检查模块依赖循环
    pub fn check_dependency_cycle(module_name: &str) -> Result<()> {
        let mut visited = HashSet::new();
        let mut rec_stack = HashSet::new();
        
        Self::dfs_check_cycle(module_name, &mut visited, &mut rec_stack)?;
        Ok(())
    }

    fn dfs_check_cycle(
        module_name: &str,
        visited: &mut HashSet<String>,
        rec_stack: &mut HashSet<String>,
    ) -> Result<()> {
        let name = module_name.to_string();
        
        if rec_stack.contains(&name) {
            return Err(anyhow!("Circular dependency detected involving module: {}", module_name));
        }
        
        if visited.contains(&name) {
            return Ok(());
        }
        
        visited.insert(name.clone());
        rec_stack.insert(name.clone());
        
        if let Some(metadata) = MODULE_TABLE.get(module_name) {
            for dep in &metadata.dependencies {
                Self::dfs_check_cycle(dep, visited, rec_stack)?;
            }
        }
        
        rec_stack.remove(&name);
        Ok(())
    }

    /// 检查模块冲突
    pub async fn check_conflicts(&self, module_name: &str) -> Result<()> {
        let metadata = MODULE_TABLE.get(module_name)
            .ok_or_else(|| anyhow!("Module {} not found in MODULE_TABLE", module_name))?;
        
        let states = self.states.read().await;
        
        for conflict_module in &metadata.conflicts {
            if let Some(state) = states.get(conflict_module) {
                if state.enabled {
                    return Err(anyhow!(
                        "Module {} conflicts with enabled module {}",
                        module_name,
                        conflict_module
                    ));
                }
            }
        }
        
        Ok(())
    }

    /// 检查模块依赖是否满足
    pub async fn check_dependencies(&self, module_name: &str) -> Result<()> {
        let metadata = MODULE_TABLE.get(module_name)
            .ok_or_else(|| anyhow!("Module {} not found in MODULE_TABLE", module_name))?;
        
        let states = self.states.read().await;
        
        for dep in &metadata.dependencies {
            if let Some(state) = states.get(dep) {
                if !state.enabled || !state.model_loaded {
                    return Err(anyhow!(
                        "Module {} requires dependency {} to be enabled and loaded",
                        module_name,
                        dep
                    ));
                }
            } else {
                // 核心模块（asr, nmt, tts, vad）可能不在 states 中，因为它们总是启用的
                // 这里我们需要特殊处理
                if !["asr", "nmt", "tts", "vad"].contains(&dep.as_str()) {
                    return Err(anyhow!(
                        "Module {} requires dependency {} which is not registered",
                        module_name,
                        dep
                    ));
                }
            }
        }
        
        Ok(())
    }
}

/// 模型需求定义
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ModelRequirement {
    pub model_id: String,
    /// None 表示使用 latest 版本
    pub version: Option<String>,
}

/// 模块元数据（SSOT - Single Source of Truth）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleMetadata {
    pub module_name: String,
    /// 模块所需的模型列表
    pub required_models: Vec<ModelRequirement>,
    /// 模块依赖的其他模块（模块名称列表）
    pub dependencies: Vec<String>,
    /// 与当前模块冲突的模块（不能同时启用）
    pub conflicts: Vec<String>,
    /// 模块输出的字段列表（用于 PipelineContext）
    pub outputs: Vec<String>,
}

/// 模块配置表（MODULE_TABLE）
/// 这是系统中模块定义的唯一可信源（SSOT）
lazy_static! {
    pub static ref MODULE_TABLE: HashMap<&'static str, ModuleMetadata> = {
        let mut m = HashMap::new();
        
        // 核心模块（必需，不需要元数据，因为它们总是启用的）
        // 但为了完整性，我们也可以定义它们
        
        // 可选模块：情感检测
        m.insert("emotion_detection", ModuleMetadata {
            module_name: "emotion_detection".to_string(),
            required_models: vec![
                ModelRequirement {
                    model_id: "emotion-xlm-r".to_string(),
                    version: Some("1.0.0".to_string()),
                }
            ],
            dependencies: vec!["asr".to_string()],
            conflicts: vec![],
            outputs: vec!["emotion".to_string()],
        });
        
        // 可选模块：音色识别
        m.insert("speaker_identification", ModuleMetadata {
            module_name: "speaker_identification".to_string(),
            required_models: vec![
                ModelRequirement {
                    model_id: "speaker-id-ecapa".to_string(),
                    version: Some("1.0.0".to_string()),
                }
            ],
            dependencies: vec![],
            conflicts: vec![],
            outputs: vec!["speaker_id".to_string()],
        });
        
        // 可选模块：音色生成/克隆
        m.insert("voice_cloning", ModuleMetadata {
            module_name: "voice_cloning".to_string(),
            required_models: vec![
                ModelRequirement {
                    model_id: "vc-model-v1".to_string(),
                    version: None, // latest
                }
            ],
            dependencies: vec!["speaker_identification".to_string()],
            conflicts: vec![],
            outputs: vec!["voice_id".to_string()],
        });
        
        // 可选模块：语速识别
        m.insert("speech_rate_detection", ModuleMetadata {
            module_name: "speech_rate_detection".to_string(),
            required_models: vec![
                ModelRequirement {
                    model_id: "sr-d-v1".to_string(),
                    version: Some("1.0.0".to_string()),
                }
            ],
            dependencies: vec!["asr".to_string()],
            conflicts: vec![],
            outputs: vec!["speech_rate".to_string()],
        });
        
        // 可选模块：语速控制
        m.insert("speech_rate_control", ModuleMetadata {
            module_name: "speech_rate_control".to_string(),
            required_models: vec![
                ModelRequirement {
                    model_id: "tts-vocoder-v1".to_string(),
                    version: None, // latest
                }
            ],
            dependencies: vec!["speech_rate_detection".to_string(), "tts".to_string()],
            conflicts: vec![],
            outputs: vec!["tts_audio".to_string()],
        });
        
        // 可选模块：个性化适配
        m.insert("persona_adaptation", ModuleMetadata {
            module_name: "persona_adaptation".to_string(),
            required_models: vec![
                ModelRequirement {
                    model_id: "persona-style-transformer".to_string(),
                    version: None, // latest
                }
            ],
            dependencies: vec!["asr".to_string()],
            conflicts: vec![],
            outputs: vec!["persona_style".to_string()],
        });
        
        m
    };
}

/// 功能请求集合
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FeatureSet {
    pub speaker_identification: bool,
    pub voice_cloning: bool,
    pub speech_rate_detection: bool,
    pub speech_rate_control: bool,
    pub emotion_detection: bool,
    pub persona_adaptation: bool,
}

