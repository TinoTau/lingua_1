// 节点注册表单元测试

use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::messages::{FeatureFlags, HardwareInfo, InstalledModel};

fn create_test_hardware() -> HardwareInfo {
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
    ).await;
    
    assert!(node.node_id.starts_with("node-"));
    assert_eq!(node.name, "Test Node");
    assert_eq!(node.version, "1.0.0");
    assert_eq!(node.platform, "linux");
    assert!(node.online);
    assert_eq!(node.current_jobs, 0);
    assert_eq!(node.max_concurrent_jobs, 4);
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
    ).await;
    
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
    ).await;
    
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
    ).await;
    
    // 更新节点，使其达到最大并发数
    registry.update_node_heartbeat(
        "node-2",
        50.0,
        None,
        60.0,
        None,
        4, // max_concurrent_jobs
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
    ).await;
    
    let success = registry.update_node_heartbeat(
        "node-3",
        75.0,
        Some(80.0),
        65.0,
        None,
        2,
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
    ).await;
    
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
    ).await;
    
    // 选择中文到英文的节点
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-zh-en".to_string()));
    
    // 选择英文到中文的节点
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
    ).await;
    
    // 注册支持情感分析的节点
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
    
    let selected = registry.select_node_with_features("zh", "en", &required_features, true).await;
    assert_eq!(selected, Some("node-with-emotion".to_string()));
}

#[tokio::test]
async fn test_select_node_no_match() {
    let registry = NodeRegistry::new();
    
    // 不注册任何节点
    
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
    ).await;
    
    assert!(registry.is_node_available("node-4").await);
    
    registry.mark_node_offline("node-4").await;
    
    assert!(!registry.is_node_available("node-4").await);
}

#[tokio::test]
async fn test_select_node_least_connections() {
    let registry = NodeRegistry::new();
    
    // 注册三个节点，都支持相同的语言对
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
    ).await;
    
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
    ).await;
    
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
    ).await;
    
    // 更新节点负载：heavy=3, medium=1, light=0
    registry.update_node_heartbeat("node-heavy", 50.0, None, 60.0, None, 3).await;
    registry.update_node_heartbeat("node-medium", 50.0, None, 60.0, None, 1).await;
    registry.update_node_heartbeat("node-light", 50.0, None, 60.0, None, 0).await;
    
    // 应该选择负载最轻的节点（current_jobs=0）
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-light".to_string()));
    
    // 更新：heavy=2, medium=1, light=2
    registry.update_node_heartbeat("node-heavy", 50.0, None, 60.0, None, 2).await;
    registry.update_node_heartbeat("node-light", 50.0, None, 60.0, None, 2).await;
    
    // 应该选择负载最轻的节点（current_jobs=1）
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-medium".to_string()));
}

