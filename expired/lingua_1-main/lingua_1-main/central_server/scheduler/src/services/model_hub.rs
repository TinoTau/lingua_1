use crate::core::config::ModelHubConfig;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ModelMetadata {
    pub model_id: String,
    pub model_type: ModelType,
    pub name: String,
    pub version: String,
    pub src_lang: Option<String>,
    pub tgt_lang: Option<String>,
    pub dialect: Option<String>,
    pub size_bytes: u64,
    pub download_url: String,
    pub sha256: String,
    pub status: ModelStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(dead_code)]
pub enum ModelType {
    ASR,
    NMT,
    TTS,
    VAD,
    Emotion,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ModelStatus {
    Stable,
    Beta,
    Deprecated,
}

#[derive(Clone)]
pub struct ModelHub {
    #[allow(dead_code)]
    config: ModelHubConfig,
    // TODO: 从数据库或文件加载模型元数据
}

impl ModelHub {
    pub fn new(config: &ModelHubConfig) -> anyhow::Result<Self> {
        // 确保存储路径存在
        std::fs::create_dir_all(&config.storage_path)?;
        
        Ok(Self {
            config: config.clone(),
        })
    }

}

