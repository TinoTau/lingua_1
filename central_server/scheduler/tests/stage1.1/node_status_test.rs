// 节点状态管理单元测试

use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::managers::NodeStatusManager;
use lingua_scheduler::managers::NodeConnectionManager;
use lingua_scheduler::messages::{
    FeatureFlags, HardwareInfo, GpuInfo, InstalledModel, InstalledService, ServiceType, DeviceType, ServiceStatus, NodeStatus,
};
use lingua_scheduler::core::config::NodeHealthConfig;
use std::sync::Arc;

fn create_test_hardware() -> HardwareInfo {
    HardwareInfo {
        cpu_cores: 8,
        memory_gb: 16,
        gpus: Some(vec![
            GpuInfo {
                name: "Test GPU".to_string(),
                memory_gb: 8,
            }
        ]),
    }
}

fn create_test_models() -> Vec<InstalledModel> {
    vec![
        InstalledModel {
            model_id: "asr-1".to_string(),
            kind: "asr".to_string(),
            src_lang: None,
            tgt_lang: None,
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
        InstalledModel {
            model_id: "nmt-1".to_string(),
            kind: "nmt".to_string(),
            src_lang: Some("zh".to_string()),
            tgt_lang: Some("en".to_string()),
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
        InstalledModel {
            model_id: "tts-1".to_string(),
            kind: "tts".to_string(),
            src_lang: None,
            tgt_lang: Some("en".to_string()),
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
    ]
}

fn create_core_installed_services() -> Vec<InstalledService> {
    vec![
        InstalledService {
            service_id: "node-inference".to_string(),
            r#type: ServiceType::Asr,
            device: DeviceType::Gpu,
            status: ServiceStatus::Running,
            version: Some("1.0.0".to_string()),
            model_id: None,
            engine: None,
            mem_mb: None,
            warmup_ms: None,
            last_error: None,
        },
        InstalledService {
            service_id: "nmt-m2m100".to_string(),
            r#type: ServiceType::Nmt,
            device: DeviceType::Gpu,
            status: ServiceStatus::Running,
            version: Some("1.0.0".to_string()),
            model_id: None,
            engine: None,
            mem_mb: None,
            warmup_ms: None,
            last_error: None,
        },
        InstalledService {
            service_id: "piper-tts".to_string(),
            r#type: ServiceType::Tts,
            device: DeviceType::Gpu,
            status: ServiceStatus::Running,
            version: Some("1.0.0".to_string()),
            model_id: None,
            engine: None,
            mem_mb: None,
            warmup_ms: None,
            last_error: None,
        },
    ]
}

#[tokio::test]
async fn test_node_initial_status_is_registering() {
    let registry = NodeRegistry::new();
    
    let node = registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        None,
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![],
    ).await.unwrap();
    
    // 初始状态应该是 registering
    assert_eq!(node.status, NodeStatus::Registering);
}

#[tokio::test]
async fn test_node_id_conflict_detection() {
    let registry = NodeRegistry::new();
    
    // 注册第一个节点
    let _node1 = registry.register_node(
        Some("test-node-1".to_string()),
        "Test Node 1".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        None,
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![],
    ).await.unwrap();
    
    // 尝试用相同的 node_id 注册第二个节点，应该失败
    let result = registry.register_node(
        Some("test-node-1".to_string()),
        "Test Node 2".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        None,
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![],
    ).await;
    
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("ID 冲突"));
}

#[tokio::test]
async fn test_select_node_filters_by_status() {
    let registry = NodeRegistry::new();
    
    // 注册一个节点
    let node = registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        None,
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![],
    ).await.unwrap();
    
    // 节点状态是 registering，不应该被选中
    let selected = registry.select_node_with_features(
        "zh",
        "en",
        &None,
        true,
    ).await;
    
    assert!(selected.is_none(), "registering 状态的节点不应该被选中");
    
    // 手动将节点状态改为 ready
    registry.set_node_status(&node.node_id, NodeStatus::Ready).await;
    
    // 现在应该能被选中
    let selected = registry.select_node_with_features(
        "zh",
        "en",
        &None,
        true,
    ).await;
    
    assert_eq!(selected, Some(node.node_id));
}

#[tokio::test]
async fn test_node_status_manager_health_check() {
    let registry = Arc::new(NodeRegistry::new());
    let node_connections = Arc::new(NodeConnectionManager::new());
    let config = NodeHealthConfig::default();
    let manager = NodeStatusManager::new(registry.clone(), node_connections, config);
    
    // 注册一个节点
    let node = registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        Some(create_core_installed_services()),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Asr, ready: true, reason: None, ready_impl_ids: Some(vec!["node-inference".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Nmt, ready: true, reason: None, ready_impl_ids: Some(vec!["nmt-m2m100".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Tts, ready: true, reason: None, ready_impl_ids: Some(vec!["piper-tts".to_string()]) },
        ],
    ).await.unwrap();
    
    // 更新心跳，触发健康检查
    registry.update_node_heartbeat(
        &node.node_id,
        10.0,
        Some(10.0),
        10.0,
        None,
        None,
        0,
        None,
        None, // processing_metrics
    ).await;
    
    // 触发状态检查
    manager.on_heartbeat(&node.node_id).await;
    
    // 检查状态（应该还是 registering，因为需要连续 3 次）
    let status = registry.get_node_status(&node.node_id).await;
    assert_eq!(status, Some(NodeStatus::Registering));
}

#[tokio::test]
async fn test_node_status_manager_registering_to_ready() {
    let registry = Arc::new(NodeRegistry::new());
    let node_connections = Arc::new(NodeConnectionManager::new());
    let config = NodeHealthConfig::default();
    let manager = NodeStatusManager::new(registry.clone(), node_connections, config);
    
    // 注册一个节点
    let node = registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        Some(create_core_installed_services()),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Asr, ready: true, reason: None, ready_impl_ids: Some(vec!["node-inference".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Nmt, ready: true, reason: None, ready_impl_ids: Some(vec!["nmt-m2m100".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Tts, ready: true, reason: None, ready_impl_ids: Some(vec!["piper-tts".to_string()]) },
        ],
    ).await.unwrap();
    
    // 连续发送 3 次心跳（健康检查通过）
    for _ in 0..3 {
        registry.update_node_heartbeat(
            &node.node_id,
            10.0,
            Some(10.0),
            10.0,
            None,
            None,
            0,
            None,
            None, // processing_metrics
        ).await;
        manager.on_heartbeat(&node.node_id).await;
    }
    
    // 检查状态（应该变为 ready）
    let status = registry.get_node_status(&node.node_id).await;
    assert_eq!(status, Some(NodeStatus::Ready));
}

#[tokio::test]
async fn test_node_status_manager_ready_to_degraded() {
    let registry = Arc::new(NodeRegistry::new());
    let node_connections = Arc::new(NodeConnectionManager::new());
    let config = NodeHealthConfig::default();
    let manager = NodeStatusManager::new(registry.clone(), node_connections, config);
    
    // 注册一个节点并设置为 ready
    let node = registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        None,
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Asr, ready: true, reason: None, ready_impl_ids: Some(vec!["node-inference".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Nmt, ready: true, reason: None, ready_impl_ids: Some(vec!["nmt-m2m100".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Tts, ready: true, reason: None, ready_impl_ids: Some(vec!["piper-tts".to_string()]) },
        ],
    ).await.unwrap();
    
    // 设置为 ready 状态
    registry.set_node_status(&node.node_id, NodeStatus::Ready).await;
    
    // 模拟健康检查失败（连续 3 次）
    for _ in 0..3 {
        // 更新心跳，但模型状态为 NotReady（模拟失败）
        registry.update_node_heartbeat(
            &node.node_id,
            10.0,
            Some(10.0),
            10.0,
            None,
            None,
            0,
            Some(vec![
                lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Asr, ready: false, reason: Some("error".to_string()), ready_impl_ids: None },
                lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Nmt, ready: false, reason: Some("error".to_string()), ready_impl_ids: None },
                lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Tts, ready: false, reason: Some("error".to_string()), ready_impl_ids: None },
            ]),
            None, // processing_metrics
        ).await;
        manager.on_heartbeat(&node.node_id).await;
    }
    
    // 检查状态（应该变为 degraded）
    let status = registry.get_node_status(&node.node_id).await;
    assert_eq!(status, Some(NodeStatus::Degraded));
}

#[tokio::test]
async fn test_node_status_manager_degraded_to_ready() {
    let registry = Arc::new(NodeRegistry::new());
    let node_connections = Arc::new(NodeConnectionManager::new());
    let config = NodeHealthConfig::default();
    let manager = NodeStatusManager::new(registry.clone(), node_connections, config);
    
    // 注册一个节点并设置为 degraded
    let node = registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        None,
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Asr, ready: true, reason: None, ready_impl_ids: Some(vec!["node-inference".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Nmt, ready: true, reason: None, ready_impl_ids: Some(vec!["nmt-m2m100".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Tts, ready: true, reason: None, ready_impl_ids: Some(vec!["piper-tts".to_string()]) },
        ],
    ).await.unwrap();
    
    // 设置为 degraded 状态
    registry.set_node_status(&node.node_id, NodeStatus::Degraded).await;
    
    // 发送健康检查通过的心跳
    registry.update_node_heartbeat(
        &node.node_id,
        10.0,
        Some(10.0),
        10.0,
        None,
        None,
        0,
        Some(vec![
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Asr, ready: true, reason: None, ready_impl_ids: Some(vec!["node-inference".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Nmt, ready: true, reason: None, ready_impl_ids: Some(vec!["nmt-m2m100".to_string()]) },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Tts, ready: true, reason: None, ready_impl_ids: Some(vec!["piper-tts".to_string()]) },
        ]),
        None, // processing_metrics
    ).await;
    manager.on_heartbeat(&node.node_id).await;
    
    // 检查状态（应该恢复为 ready）
    let status = registry.get_node_status(&node.node_id).await;
    assert_eq!(status, Some(NodeStatus::Ready));
}

#[tokio::test]
async fn test_node_status_manager_heartbeat_timeout() {
    let registry = Arc::new(NodeRegistry::new());
    let node_connections = Arc::new(NodeConnectionManager::new());
    let mut config = NodeHealthConfig::default();
    // 设置较短的超时时间用于测试
    config.heartbeat_timeout_seconds = 1;
    let manager = NodeStatusManager::new(registry.clone(), node_connections, config);
    
    // 注册一个节点并设置为 ready
    let node = registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        None,
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![],
    ).await.unwrap();
    
    // 设置为 ready 状态
    registry.set_node_status(&node.node_id, NodeStatus::Ready).await;
    
    // 等待超时
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    
    // 执行定期扫描
    manager.periodic_scan().await;
    
    // 检查状态（应该变为 offline）
    let status = registry.get_node_status(&node.node_id).await;
    assert_eq!(status, Some(NodeStatus::Offline));
}

#[tokio::test]
async fn test_node_status_manager_warmup_timeout() {
    let registry = Arc::new(NodeRegistry::new());
    let node_connections = Arc::new(NodeConnectionManager::new());
    let mut config = NodeHealthConfig::default();
    // 设置较短的 warmup 超时时间用于测试
    config.warmup_timeout_seconds = 1;
    let manager = NodeStatusManager::new(registry.clone(), node_connections, config);
    
    // 注册一个节点（初始状态为 registering）
    let node = registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models(),
        None,
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Asr, ready: false, reason: Some("error".to_string()), ready_impl_ids: None },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Nmt, ready: false, reason: Some("error".to_string()), ready_impl_ids: None },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Tts, ready: false, reason: Some("error".to_string()), ready_impl_ids: None },
        ],
    ).await.unwrap();
    
    // 发送一次心跳（健康检查失败，会记录到 health_check_history）
    registry.update_node_heartbeat(
        &node.node_id,
        10.0,
        Some(10.0),
        10.0,
        None,
        None,
        0,
        Some(vec![
            // 保持模型状态为 Error，导致健康检查失败
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Asr, ready: false, reason: Some("error".to_string()), ready_impl_ids: None },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Nmt, ready: false, reason: Some("error".to_string()), ready_impl_ids: None },
            lingua_scheduler::messages::CapabilityByType { r#type: ServiceType::Tts, ready: false, reason: Some("error".to_string()), ready_impl_ids: None },
        ]),
        None, // processing_metrics
    ).await;
    manager.on_heartbeat(&node.node_id).await;
    
    // 等待 warmup 超时（从注册时间开始计算）
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    
    // 执行定期扫描
    manager.periodic_scan().await;
    
    // 检查状态（应该变为 degraded）
    let status = registry.get_node_status(&node.node_id).await;
    assert_eq!(status, Some(NodeStatus::Degraded));
}

