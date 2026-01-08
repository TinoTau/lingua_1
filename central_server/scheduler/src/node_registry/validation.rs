// 节点验证逻辑

use tracing::debug;
use crate::messages::{FeatureFlags, ServiceType};
use super::types::Node;
use crate::phase2::Phase2Runtime;

/// 检查节点是否具备所需的 ServiceType（从 Redis 读取）
/// 注意：节点能力信息已迁移到 Redis，不再存储在 Node 结构体中
pub async fn node_has_required_types_ready(
    node: &Node,
    required_types: &[ServiceType],
    phase2_runtime: Option<&Phase2Runtime>,
) -> bool {
    // 如果没有提供 phase2_runtime，无法从 Redis 读取，返回 false
    let Some(rt) = phase2_runtime else {
        debug!(
            node_id = %node.node_id,
            "未提供 Phase2Runtime，无法从 Redis 读取节点能力"
        );
        return false;
    };

    let mut missing_or_not_ready = Vec::new();
    let mut all_ready = true;

    for t in required_types {
        let ready = rt.has_node_capability(&node.node_id, t).await;
        if !ready {
            all_ready = false;
            missing_or_not_ready.push(format!("{:?}", t));
        }
    }

    if !all_ready {
        debug!(
            node_id = %node.node_id,
            required_types = ?required_types,
            missing_or_not_ready = ?missing_or_not_ready,
            installed_services = ?node.installed_services.iter().map(|s| &s.service_id).collect::<Vec<_>>(),
            "Node does not have all required types ready (from Redis)"
        );
    }

    all_ready
}

/// 基于 installed_services 的硬过滤（type 存在即可）。
pub fn node_has_installed_types(node: &Node, required_types: &[ServiceType]) -> bool {
    if required_types.is_empty() {
        return true;
    }
    required_types.iter().all(|rt| {
        node.installed_services.iter().any(|s| s.r#type == *rt)
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
/// 检查节点资源是否可用
/// - CPU 使用率阈值：使用 resource_threshold 参数
/// - GPU 使用率阈值：使用 resource_threshold 参数
/// - 内存使用率阈值：使用 resource_threshold 参数
pub fn is_node_resource_available(node: &Node, resource_threshold: f32) -> bool {
    // 检查 CPU 使用率
    if node.cpu_usage > resource_threshold {
        debug!(
            node_id = %node.node_id,
            cpu_usage = node.cpu_usage,
            threshold = resource_threshold,
            "Node resource check failed: CPU usage exceeds threshold"
        );
        return false;
    }
    
    // 检查 GPU 使用率（所有节点都必须有 GPU）
    // 如果 GPU 使用率为 None，使用 0.0 作为默认值（节点端可能暂时无法获取 GPU 使用率）
    let gpu_usage = node.gpu_usage.unwrap_or(0.0);
    if gpu_usage > resource_threshold {
        debug!(
            node_id = %node.node_id,
            gpu_usage = gpu_usage,
            threshold = resource_threshold,
            "Node resource check failed: GPU usage exceeds threshold"
        );
        return false;
    }
    
    // 检查内存使用率
    if node.memory_usage > resource_threshold {
        debug!(
            node_id = %node.node_id,
            memory_usage = node.memory_usage,
            threshold = resource_threshold,
            "Node resource check failed: Memory usage exceeds threshold"
        );
        return false;
    }
    
    debug!(
        node_id = %node.node_id,
        cpu_usage = node.cpu_usage,
        gpu_usage = gpu_usage,
        memory_usage = node.memory_usage,
        threshold = resource_threshold,
        "Node resource check passed"
    );
    
    true
}

