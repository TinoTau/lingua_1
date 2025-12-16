// 节点验证逻辑

use crate::messages::{FeatureFlags, ModelStatus};
use super::types::Node;

/// 检查节点是否具备所需的模型（ASR、NMT、TTS）
pub fn node_has_required_models(node: &Node, src_lang: &str, tgt_lang: &str) -> bool {
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
pub fn node_has_models_ready(node: &Node, required_model_ids: &[String]) -> bool {
    required_model_ids.iter().all(|model_id| {
        node.capability_state
            .get(model_id)
            .map(|status| status == &ModelStatus::Ready)
            .unwrap_or(false)
    })
}

/// 检查节点是否支持所需的功能
pub fn node_supports_features(node: &Node, required_features: &Option<FeatureFlags>) -> bool {
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

/// 检查节点资源使用率是否可用（低于阈值）
/// 
/// 根据设计理念：调度服务器只负责跳过高负载节点，具体计算压力交给节点端
/// 节点端通过心跳传递资源使用率，调度服务器只需简单过滤即可
/// 
/// # 要求
/// - GPU 使用率必须检查（所有节点都必须有 GPU）
pub fn is_node_resource_available(node: &Node, resource_threshold: f32) -> bool {
    // 检查 CPU 使用率
    if node.cpu_usage > resource_threshold {
        return false;
    }
    
    // 检查 GPU 使用率（所有节点都必须有 GPU）
    if let Some(gpu_usage) = node.gpu_usage {
        if gpu_usage > resource_threshold {
            return false;
        }
    } else {
        // 如果没有 GPU 使用率信息，认为不可用（所有节点都必须有 GPU）
        return false;
    }
    
    // 检查内存使用率
    if node.memory_usage > resource_threshold {
        return false;
    }
    
    true
}

