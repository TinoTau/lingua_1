use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

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

/// 模块管理器
pub struct ModuleManager {
    states: Arc<RwLock<HashMap<String, ModuleState>>>,
}

impl ModuleManager {
    pub fn new() -> Self {
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
        }
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

    pub async fn enable_module(&self, name: &str) -> Result<()> {
        let mut states = self.states.write().await;
        if let Some(state) = states.get_mut(name) {
            state.enabled = true;
            state.last_used = Some(chrono::Utc::now());
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

