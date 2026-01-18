//! 模块依赖解析器
//! 
//! 根据 v2 技术说明书，实现模块依赖展开和模型需求收集

use std::collections::{HashMap, HashSet};
use anyhow::{Result, anyhow};

/// 模块元数据（简化版，用于调度服务器）
/// 
/// 注意：完整的 ModuleMetadata 定义在 node-inference 中
/// 这里只包含调度服务器需要的字段
#[derive(Debug, Clone)]
pub struct ModuleMetadata {
    #[allow(dead_code)]
    pub module_name: String,
    pub required_models: Vec<String>,  // 简化为模型 ID 列表
}

// 模块配置表（简化版）
// 
// 注意：完整的 MODULE_TABLE 在 node-inference 中
// 这里只包含调度服务器需要的模块信息
lazy_static::lazy_static! {
    pub static ref MODULE_TABLE: HashMap<&'static str, ModuleMetadata> = {
        let mut m = HashMap::new();
        
        // 可选模块：情感检测
        m.insert("emotion_detection", ModuleMetadata {
            module_name: "emotion_detection".to_string(),
            required_models: vec!["emotion-xlm-r".to_string()],
        });
        
        // 可选模块：音色识别
        m.insert("speaker_identification", ModuleMetadata {
            module_name: "speaker_identification".to_string(),
            required_models: vec!["speaker-id-ecapa".to_string()],
        });
        
        // 可选模块：音色生成/克隆
        m.insert("voice_cloning", ModuleMetadata {
            module_name: "voice_cloning".to_string(),
            required_models: vec!["vc-model-v1".to_string()],
        });
        
        // 可选模块：语速识别
        m.insert("speech_rate_detection", ModuleMetadata {
            module_name: "speech_rate_detection".to_string(),
            required_models: vec!["sr-d-v1".to_string()],
        });
        
        // 可选模块：语速控制
        m.insert("speech_rate_control", ModuleMetadata {
            module_name: "speech_rate_control".to_string(),
            required_models: vec!["tts-vocoder-v1".to_string()],
        });
        
        // 可选模块：个性化适配
        m.insert("persona_adaptation", ModuleMetadata {
            module_name: "persona_adaptation".to_string(),
            required_models: vec!["persona-style-transformer".to_string()],
        });
        
        m
    };
}

/// 模块依赖解析器
pub struct ModuleResolver;

impl ModuleResolver {

    /// 收集所有模块所需的模型 ID
    /// 
    /// # Arguments
    /// * `module_names` - 模块名称列表
    /// 
    /// # Returns
    /// * `Ok(Vec<String>)` - 所有所需的模型 ID 列表（去重）
    /// * `Err` - 如果模块不存在
    pub fn collect_required_models(module_names: &[String]) -> Result<Vec<String>> {
        let mut model_ids = HashSet::new();
        
        for module_name in module_names {
            // 核心模块的模型需求需要特殊处理
            // 这里简化处理，实际应该从配置或请求中获取
            match module_name.as_str() {
                "asr" => {
                    // ASR 模型 ID 需要从请求中获取，这里先跳过
                }
                "nmt" => {
                    // NMT 模型 ID 需要从请求中获取，这里先跳过
                }
                "tts" => {
                    // TTS 模型 ID 需要从请求中获取，这里先跳过
                }
                "vad" => {
                    // VAD 模型 ID 需要从请求中获取，这里先跳过
                }
                _ => {
                    if let Some(metadata) = MODULE_TABLE.get(module_name.as_str()) {
                        for model_id in &metadata.required_models {
                            model_ids.insert(model_id.clone());
                        }
                    } else {
                        return Err(anyhow!("Module {} not found in MODULE_TABLE", module_name));
                    }
                }
            }
        }
        
        Ok(model_ids.into_iter().collect())
    }

    /// 从 FeatureFlags 解析出模块名称列表
    /// 
    /// # Arguments
    /// * `features` - 功能标志
    /// 
    /// # Returns
    /// * `Vec<String>` - 启用的模块名称列表
    pub fn parse_features_to_modules(features: &crate::messages::FeatureFlags) -> Vec<String> {
        let mut modules = Vec::new();
        
        // 核心模块总是需要的
        modules.push("asr".to_string());
        modules.push("nmt".to_string());
        modules.push("tts".to_string());
        
        // 可选模块
        if features.emotion_detection == Some(true) {
            modules.push("emotion_detection".to_string());
        }
        if features.speaker_identification == Some(true) {
            modules.push("speaker_identification".to_string());
        }
        if features.voice_style_detection == Some(true) {
            // voice_style_detection 可能对应 voice_cloning
            modules.push("voice_cloning".to_string());
        }
        if features.speech_rate_detection == Some(true) {
            modules.push("speech_rate_detection".to_string());
        }
        if features.speech_rate_control == Some(true) {
            modules.push("speech_rate_control".to_string());
        }
        if features.persona_adaptation == Some(true) {
            modules.push("persona_adaptation".to_string());
        }
        
        modules
    }
}

