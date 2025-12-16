//! 调试测试：用于定位节点选择失败的原因

use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::messages::{FeatureFlags, HardwareInfo, GpuInfo, InstalledModel, CapabilityState, ModelStatus, NodeStatus};
use std::collections::HashMap;
use std::sync::Arc;

fn create_test_hardware() -> HardwareInfo {
    HardwareInfo {
        cpu_cores: 8,
        memory_gb: 16,
        gpus: Some(vec![GpuInfo {
            name: "Test GPU".to_string(),
            memory_gb: 8,
        }]),
    }
}

fn create_test_models(src_lang: &str, tgt_lang: &str) -> Vec<InstalledModel> {
    vec![
        InstalledModel {
            model_id: format!("whisper-large-v3-{}", src_lang),
            kind: "asr".to_string(),
            src_lang: None,
            tgt_lang: None,
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
        InstalledModel {
            model_id: format!("m2m100-{}-{}", src_lang, tgt_lang),
            kind: "nmt".to_string(),
            src_lang: Some(src_lang.to_string()),
            tgt_lang: Some(tgt_lang.to_string()),
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
        InstalledModel {
            model_id: format!("piper-tts-{}", tgt_lang),
            kind: "tts".to_string(),
            src_lang: None,
            tgt_lang: Some(tgt_lang.to_string()),
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
    ]
}

fn create_capability_state_with_models(model_ids: &[&str]) -> CapabilityState {
    let mut state = HashMap::new();
    for model_id in model_ids {
        state.insert(model_id.to_string(), ModelStatus::Ready);
    }
    state
}

#[tokio::test]
async fn debug_test_node_registration() {
    let registry = Arc::new(NodeRegistry::new());
    
    // 注册节点1：有 emotion-xlm-r 模型且状态为 ready
    let cap_state_1 = create_capability_state_with_models(&[
        "whisper-large-v3-zh",
        "m2m100-zh-en",
        "piper-tts-en",
        "emotion-xlm-r",
    ]);
    
    println!("=== 注册节点1 ===");
    println!("capability_state: {:?}", cap_state_1);
    println!("installed_models: {:?}", create_test_models("zh", "en"));
    
    let result = registry.register_node(
        Some("node-1".to_string()),
        "Node 1".to_string(),
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
        Some(cap_state_1.clone()),
    ).await;
    
    match result {
        Ok(node) => {
            println!("✅ 节点1注册成功");
            println!("节点ID: {}", node.node_id);
            println!("状态: {:?}", node.status);
            println!("在线: {}", node.online);
            println!("GPU: {:?}", node.hardware.gpus);
            println!("capability_state: {:?}", node.capability_state);
            println!("installed_models: {:?}", node.installed_models);
        }
        Err(e) => {
            println!("❌ 节点1注册失败: {}", e);
            return;
        }
    }
    
    // Set node to ready status
    registry.set_node_status("node-1", NodeStatus::Ready).await;
    
    // 检查节点状态
    let nodes = registry.nodes.read().await;
    if let Some(node) = nodes.get("node-1") {
        println!("\n=== 节点1状态检查 ===");
        println!("状态: {:?}", node.status);
        println!("在线: {}", node.online);
        println!("GPU: {:?}", node.hardware.gpus);
        println!("CPU使用率: {}", node.cpu_usage);
        println!("GPU使用率: {:?}", node.gpu_usage);
        println!("内存使用率: {}", node.memory_usage);
        println!("当前任务数: {}/{}", node.current_jobs, node.max_concurrent_jobs);
        println!("接受公共任务: {}", node.accept_public_jobs);
        println!("capability_state: {:?}", node.capability_state);
        println!("installed_models: {:?}", node.installed_models);
    }
    drop(nodes);
    
    // 选择需要 emotion-xlm-r 模型的节点
    println!("\n=== 选择节点 ===");
    let required_models = vec!["emotion-xlm-r".to_string()];
    println!("需要的模型: {:?}", required_models);
    let selected = registry.select_node_with_models("zh", "en", &required_models, true).await;
    println!("选择的节点: {:?}", selected);
    
    assert_eq!(selected, Some("node-1".to_string()));
}
