// 节点验证逻辑

use crate::messages::{FeatureFlags, ModelStatus};
use super::types::Node;

/// Phase 1：capability_state 语义统一为 service_id。
/// required_ids 也被视为 service_id 列表（服务包 ID / 逻辑服务 ID）。
pub fn node_has_required_services_ready(node: &Node, required_ids: &[String]) -> bool {
    let result = required_ids.iter().all(|service_id| {
        node.capability_state
            .get(service_id)
            .map(|s| s == &ModelStatus::Ready)
            .unwrap_or(false)
    });
    
    // 如果检查失败，记录详细日志
    if !result {
        use tracing::debug;
        let missing_or_not_ready: Vec<String> = required_ids
            .iter()
            .filter(|service_id| {
                node.capability_state
                    .get(*service_id)
                    .map(|s| s != &ModelStatus::Ready)
                    .unwrap_or(true)
            })
            .cloned()
            .collect();
        debug!(
            node_id = %node.node_id,
            required_services = ?required_ids,
            missing_or_not_ready = ?missing_or_not_ready,
            capability_state = ?node.capability_state,
            installed_services = ?node.installed_services.iter().map(|s| &s.service_id).collect::<Vec<_>>(),
            "Node does not have all required services ready"
        );
    }
    
    result
}

/// Phase 1：基于 installed_services 的硬过滤（service_id 存在即可）。
pub fn node_has_installed_services(node: &Node, required_ids: &[String]) -> bool {
    if required_ids.is_empty() {
        return true;
    }
    required_ids.iter().all(|rid| {
        node.installed_services.iter().any(|s| s.service_id == *rid)
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
/// - CPU 使用率阈值：50%
/// - GPU 使用率阈值：75%
/// - 内存使用率阈值：75%（内存可以更高使用率）
pub fn is_node_resource_available(node: &Node, _resource_threshold: f32) -> bool {
    // CPU 和 GPU 使用独立的阈值
    const CPU_THRESHOLD: f32 = 50.0;
    const GPU_THRESHOLD: f32 = 75.0;
    
    // 检查 CPU 使用率（阈值：50%）
    if node.cpu_usage > CPU_THRESHOLD {
        return false;
    }
    
    // 检查 GPU 使用率（所有节点都必须有 GPU，阈值：75%）
    if let Some(gpu_usage) = node.gpu_usage {
        if gpu_usage > GPU_THRESHOLD {
            return false;
        }
    } else {
        // 如果没有 GPU 使用率信息，认为不可用（所有节点都必须有 GPU）
        return false;
    }
    
    // 检查内存使用率（阈值：75%，内存可以更高使用率）
    const MEMORY_THRESHOLD: f32 = 75.0;
    if node.memory_usage > MEMORY_THRESHOLD {
        return false;
    }
    
    true
}

