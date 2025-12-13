// 节点注册表单元测�?

use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::messages::{FeatureFlags, HardwareInfo, GpuInfo, InstalledModel, NodeStatus};

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

fn create_test_hardware_no_gpu() -> HardwareInfo {
    HardwareInfo {
        cpu_cores: 8,
        memory_gb: 16,
        gpus: None,
    }
}

fn create_test_models(src_lang: &str, tgt_lang: &str) -> Vec<InstalledModel> {
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
            src_lang: Some(src_lang.to_string()),
            tgt_lang: Some(tgt_lang.to_string()),
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
        InstalledModel {
            model_id: "tts-1".to_string(),
            kind: "tts".to_string(),
            src_lang: None,
            tgt_lang: Some(tgt_lang.to_string()),
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
    ]
}

#[tokio::test]
async fn test_register_node() {
    let registry = NodeRegistry::new();
    
    let node = registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap(); // 必须�?GPU，所以应该成�?
    
    assert!(node.node_id.starts_with("node-"));
    assert_eq!(node.name, "Test Node");
    assert_eq!(node.version, "1.0.0");
    assert_eq!(node.platform, "linux");
    assert!(node.online);
    assert_eq!(node.current_jobs, 0);
    assert_eq!(node.max_concurrent_jobs, 4);
    assert!(node.hardware.gpus.is_some() && !node.hardware.gpus.as_ref().unwrap().is_empty());
}

#[tokio::test]
async fn test_register_node_no_gpu() {
    let registry = NodeRegistry::new();
    
    // 尝试注册没有 GPU 的节点，应该失败
    let result = registry.register_node(
        Some("test-node-no-gpu".to_string()),
        "Test Node No GPU".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware_no_gpu(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 应该返回错误
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("GPU"));
}

#[tokio::test]
async fn test_register_node_with_id() {
    let registry = NodeRegistry::new();
    
    let node = registry.register_node(
        Some("custom-node-123".to_string()),
        "Custom Node".to_string(),
        "1.0.0".to_string(),
        "windows".to_string(),
        create_test_hardware(),
        create_test_models("en", "zh"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        false,
        None,
    ).await.unwrap(); // 必须�?GPU，所以应该成�?
    
    assert_eq!(node.node_id, "custom-node-123");
    assert!(!node.accept_public_jobs);
}

#[tokio::test]
async fn test_is_node_available() {
    let registry = NodeRegistry::new();
    
    registry.register_node(
        Some("node-1".to_string()),
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap();
    
    assert!(registry.is_node_available("node-1").await);
    assert!(!registry.is_node_available("nonexistent").await);
}

#[tokio::test]
async fn test_is_node_available_when_overloaded() {
    let registry = NodeRegistry::new();
    
    registry.register_node(
        Some("node-2".to_string()),
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap();
    
    // 更新节点，使其达到最大并发数
    registry.update_node_heartbeat(
        "node-2",
        50.0,
        None,
        60.0,
        None,
        4, // max_concurrent_jobs
        None,
    ).await;
    
    assert!(!registry.is_node_available("node-2").await);
}

#[tokio::test]
async fn test_update_node_heartbeat() {
    let registry = NodeRegistry::new();
    
    registry.register_node(
        Some("node-3".to_string()),
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap();
    
    let success = registry.update_node_heartbeat(
        "node-3",
        75.0,
        Some(80.0),
        65.0,
        None,
        2,
        None,
    ).await;
    
    assert!(success);
    
    // 验证节点状态已更新（通过可用性检查）
    assert!(registry.is_node_available("node-3").await);
}

#[tokio::test]
async fn test_update_nonexistent_node_heartbeat() {
    let registry = NodeRegistry::new();
    
    let success = registry.update_node_heartbeat(
        "nonexistent",
        50.0,
        None,
        60.0,
        None,
        0,
        None,
    ).await;
    
    assert!(!success);
}

#[tokio::test]
async fn test_select_node_with_features() {
    let registry = NodeRegistry::new();
    
    // 注册支持中文到英文的节点
    registry.register_node(
        Some("node-zh-en".to_string()),
        "ZH-EN Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap();
    
    // 注册支持英文到中文的节点
    registry.register_node(
        Some("node-en-zh".to_string()),
        "EN-ZH Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("en", "zh"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 选择中文到英文的节点
    // 将节点状态设置为 ready（才能被选中）
    registry.set_node_status("node-zh-en", NodeStatus::Ready).await;
    
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-zh-en".to_string()));
    
    // 选择英文到中文的节点
    registry.set_node_status("node-en-zh", NodeStatus::Ready).await;
    
    let selected = registry.select_node_with_features("en", "zh", &None, true).await;
    assert_eq!(selected, Some("node-en-zh".to_string()));
}

#[tokio::test]
async fn test_select_node_with_required_features() {
    let registry = NodeRegistry::new();
    
    // 注册不支持情感分析的节点
    registry.register_node(
        Some("node-no-emotion".to_string()),
        "No Emotion Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 注册支持情感分析的节�?
    registry.register_node(
        Some("node-with-emotion".to_string()),
        "Emotion Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 要求情感分析功能
    let required_features = Some(FeatureFlags {
        emotion_detection: Some(true),
        voice_style_detection: None,
        speech_rate_detection: None,
        speech_rate_control: None,
        speaker_identification: None,
        persona_adaptation: None,
    });
    
    // 将节点状态设置为 ready
    registry.set_node_status("node-with-emotion", NodeStatus::Ready).await;
    
    let selected = registry.select_node_with_features("zh", "en", &required_features, true).await;
    assert_eq!(selected, Some("node-with-emotion".to_string()));
}

#[tokio::test]
async fn test_select_node_no_match() {
    let registry = NodeRegistry::new();
    
    // 不注册任何节�?
    
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, None);
}

#[tokio::test]
async fn test_mark_node_offline() {
    let registry = NodeRegistry::new();
    
    registry.register_node(
        Some("node-4".to_string()),
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap();
    
    assert!(registry.is_node_available("node-4").await);
    
    registry.mark_node_offline("node-4").await;
    
    assert!(!registry.is_node_available("node-4").await);
}

#[tokio::test]
async fn test_select_node_least_connections() {
    let registry = NodeRegistry::new();
    
    // 注册三个节点，都支持相同的语言�?
    registry.register_node(
        Some("node-heavy".to_string()),
        "Heavy Load Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap();
    
    registry.register_node(
        Some("node-medium".to_string()),
        "Medium Load Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap();
    
    registry.register_node(
        Some("node-light".to_string()),
        "Light Load Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 更新节点负载：heavy=3, medium=1, light=0
    // 注意：资源使用率需要低于阈值（默认 25%），所以设置为 20%
    registry.update_node_heartbeat("node-heavy", 20.0, None, 20.0, None, 3, None).await;
    registry.update_node_heartbeat("node-medium", 20.0, None, 20.0, None, 1, None).await;
    registry.update_node_heartbeat("node-light", 20.0, None, 20.0, None, 0, None).await;
    
    // 应该选择负载最轻的节点（current_jobs=0�?
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-light".to_string()));
    
    // 更新：heavy=2, medium=1, light=2
    // 注意：资源使用率需要低于阈值（默认 25%），所以设置为 20%
    registry.update_node_heartbeat("node-heavy", 20.0, None, 20.0, None, 2, None).await;
    registry.update_node_heartbeat("node-light", 20.0, None, 20.0, None, 2, None).await;
    
    // 应该选择负载最轻的节点（current_jobs=1�?
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-medium".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_cpu() {
    // 创建带资源阈值的注册表（默认 25%�?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 注册两个节点，都支持相同的语言�?
    registry.register_node(
        Some("node-low-cpu".to_string()),
        "Low CPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    registry.register_node(
        Some("node-high-cpu".to_string()),
        "High CPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 更新节点资源使用率：low-cpu=20%, high-cpu=30%（超过阈值）
    registry.update_node_heartbeat("node-low-cpu", 20.0, None, 15.0, None, 0, None).await;
    registry.update_node_heartbeat("node-high-cpu", 30.0, None, 15.0, None, 0, None).await;
    
    // 将所有节点状态设置为 ready
    registry.set_node_status("node-low-cpu", NodeStatus::Ready).await;
    registry.set_node_status("node-high-cpu", NodeStatus::Ready).await;
    
    // 选择节点，应该只选择 CPU 使用率低于阈值的节点
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-low-cpu".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_gpu() {
    // 创建带资源阈值的注册表（默认 25%�?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 注册两个节点，都支持相同的语言�?
    registry.register_node(
        Some("node-low-gpu".to_string()),
        "Low GPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    registry.register_node(
        Some("node-high-gpu".to_string()),
        "High GPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 更新节点资源使用率：low-gpu GPU=20%, high-gpu GPU=30%（超过阈值）
    registry.update_node_heartbeat("node-low-gpu", 15.0, Some(20.0), 15.0, None, 0, None).await;
    registry.update_node_heartbeat("node-high-gpu", 15.0, Some(30.0), 15.0, None, 0, None).await;
    
    // 将所有节点状态设置为 ready
    registry.set_node_status("node-low-gpu", NodeStatus::Ready).await;
    registry.set_node_status("node-high-gpu", NodeStatus::Ready).await;
    
    // 选择节点，应该只选择 GPU 使用率低于阈值的节点
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-low-gpu".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_memory() {
    // 创建带资源阈值的注册表（默认 25%�?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 注册两个节点，都支持相同的语言�?
    registry.register_node(
        Some("node-low-mem".to_string()),
        "Low Memory Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap();
    
    registry.register_node(
        Some("node-high-mem".to_string()),
        "High Memory Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 更新节点资源使用率：low-mem 内存=20%, high-mem 内存=30%（超过阈值）
    registry.update_node_heartbeat("node-low-mem", 15.0, None, 20.0, None, 0, None).await;
    registry.update_node_heartbeat("node-high-mem", 15.0, None, 30.0, None, 0, None).await;
    
    // 将所有节点状态设置为 ready
    registry.set_node_status("node-low-mem", NodeStatus::Ready).await;
    registry.set_node_status("node-high-mem", NodeStatus::Ready).await;
    
    // 选择节点，应该只选择内存使用率低于阈值的节点
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-low-mem".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_all_resources() {
    // 创建带资源阈值的注册表（默认 25%�?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 注册三个节点
    registry.register_node(
        Some("node-ok".to_string()),
        "OK Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    registry.register_node(
        Some("node-high-cpu".to_string()),
        "High CPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    registry.register_node(
        Some("node-high-gpu".to_string()),
        "High GPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 更新节点资源使用�?
    // node-ok: 所有资源都在阈值以�?
    registry.update_node_heartbeat("node-ok", 20.0, Some(20.0), 20.0, None, 0, None).await;
    // node-high-cpu: CPU 超过阈�?
    registry.update_node_heartbeat("node-high-cpu", 30.0, Some(20.0), 20.0, None, 0, None).await;
    // node-high-gpu: GPU 超过阈�?
    registry.update_node_heartbeat("node-high-gpu", 20.0, Some(30.0), 20.0, None, 0, None).await;
    
    // 将所有节点状态设置为 ready
    registry.set_node_status("node-ok", NodeStatus::Ready).await;
    registry.set_node_status("node-high-cpu", NodeStatus::Ready).await;
    registry.set_node_status("node-high-gpu", NodeStatus::Ready).await;
    
    // 选择节点，应该只选择所有资源都在阈值以下的节点
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-ok".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_no_available() {
    // 创建带资源阈值的注册表（默认 25%�?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 注册一个节点，但资源使用率超过阈�?
    registry.register_node(
        Some("node-overloaded".to_string()),
        "Overloaded Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 更新节点资源使用率，所有资源都超过阈�?
    registry.update_node_heartbeat("node-overloaded", 30.0, Some(30.0), 30.0, None, 0, None).await;
    
    // 选择节点，应该返�?None（没有可用节点）
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, None);
}

#[tokio::test]
async fn test_select_node_resource_threshold_custom_threshold() {
    // 创建带自定义资源阈值的注册表（50%�?
    let registry = NodeRegistry::with_resource_threshold(50.0);
    
    // 注册两个节点
    registry.register_node(
        Some("node-40".to_string()),
        "40% Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await.unwrap();
    
    registry.register_node(
        Some("node-60".to_string()),
        "60% Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        None,
    ).await;
    
    // 更新节点资源使用�?
    registry.update_node_heartbeat("node-40", 40.0, None, 40.0, None, 0, None).await;
    registry.update_node_heartbeat("node-60", 60.0, None, 60.0, None, 0, None).await;
    
    // 选择节点，阈值是 50%，所�?node-40 可用，node-60 不可�?
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-40".to_string()));
}

