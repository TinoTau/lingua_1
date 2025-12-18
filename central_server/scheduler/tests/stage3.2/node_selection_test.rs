//! 阶段 3.2 节点选择测试
//! 测试基于 capability_state 和模块依赖展开的节点选择逻辑

use lingua_scheduler::dispatcher::JobDispatcher;
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::messages::{
    CapabilityState, FeatureFlags, HardwareInfo, GpuInfo, InstalledModel, InstalledService,
    ModelStatus, NodeStatus, PipelineConfig,
};
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

fn create_capability_state_with_services(service_ids: &[&str]) -> CapabilityState {
    let mut state = HashMap::new();
    for service_id in service_ids {
        state.insert(service_id.to_string(), ModelStatus::Ready);
    }
    state
}

fn create_installed_services(service_ids: &[&str]) -> Vec<InstalledService> {
    service_ids
        .iter()
        .map(|sid| InstalledService {
            service_id: (*sid).to_string(),
            version: "1.0.0".to_string(),
            platform: "linux-x64".to_string(),
        })
        .collect()
}

#[tokio::test]
async fn test_select_node_with_models_ready() {
    let registry = Arc::new(NodeRegistry::new());
    
    // Phase 1：capability_state 的 key 统一为 service_id
    // 注册节点1：包含 emotion-xlm-r 服务且状态 ready
    let cap_state_1 = create_capability_state_with_services(&[
        "emotion-xlm-r",
    ]);
    
    let result = registry.register_node(
        Some("node-1".to_string()),
        "Node 1".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        Some(create_installed_services(&["emotion-xlm-r"])),
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
    
    assert!(result.is_ok(), "节点1注册失败: {:?}", result.err());
    
    // 注册节点2：不包含 emotion-xlm-r
    let cap_state_2 = create_capability_state_with_services(&[]);
    
    let result = registry.register_node(
        Some("node-2".to_string()),
        "Node 2".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        Some(create_installed_services(&[])),
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        Some(cap_state_2.clone()),
    ).await;
    
    // 检查注册是否成功
    assert!(result.is_ok(), "节点2注册失败: {:?}", result.err());
    
    // Set nodes to ready status
    registry.set_node_status("node-1", NodeStatus::Ready).await;
    registry.set_node_status("node-2", NodeStatus::Ready).await;
    
    // 选择需要 emotion-xlm-r 模型的节点
    let required_models = vec!["emotion-xlm-r".to_string()];
    
    // 调试：检查节点状态
    let node_ids = registry.list_node_ids_for_test().await;
    eprintln!("已注册的节点: {:?}", node_ids);
    for node_id in &node_ids {
        if let Some(node) = registry.get_node_for_test(node_id).await {
            eprintln!("节点 {}: status={:?}, online={}, gpus={:?}, capability_state={:?}", 
                node_id, node.status, node.online, node.hardware.gpus, node.capability_state);
        }
    }
    
    let (selected, _bd) = registry
        .select_node_with_models_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    
    // 应该选择节点1（有模型且状态为 ready）
    assert_eq!(selected, Some("node-1".to_string()), "选择的节点: {:?}", selected);
}

#[tokio::test]
async fn test_select_node_with_models_not_ready() {
    let registry = Arc::new(NodeRegistry::new());
    
    // 注册节点：有 emotion-xlm-r 服务但状态为 downloading
    let mut cap_state = HashMap::new();
    cap_state.insert("emotion-xlm-r".to_string(), ModelStatus::Downloading); // 正在下载
    
    let _ = registry.register_node(
        Some("node-1".to_string()),
        "Node 1".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        Some(create_installed_services(&["emotion-xlm-r"])),
        FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        Some(cap_state),
    ).await;
    
    // 选择需要 emotion-xlm-r 模型的节点
    let required_models = vec!["emotion-xlm-r".to_string()];
    let (selected, _bd) = registry
        .select_node_with_models_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    
    // 应该没有选择节点（模型未就绪）
    assert_eq!(selected, None);
}

#[tokio::test]
async fn test_select_node_with_module_expansion() {
    let registry = Arc::new(NodeRegistry::new());
    let dispatcher = JobDispatcher::new(registry.clone());
    
    // 注册节点：支持 emotion_detection 功能，且有 emotion-xlm-r 服务
    let cap_state = create_capability_state_with_services(&[
        "node-inference",
        "nmt-m2m100",
        "piper-tts",
        "emotion-xlm-r",
    ]);
    
    let _ = registry.register_node(
        Some("node-emotion".to_string()),
        "Emotion Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        Some(create_installed_services(&["node-inference","nmt-m2m100","piper-tts","emotion-xlm-r"])),
        FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        Some(cap_state),
    ).await;
    
    // Set node to ready status
    registry.set_node_status("node-emotion", NodeStatus::Ready).await;
    
    // 创建需要 emotion_detection 功能的 job
    let features = Some(FeatureFlags {
        emotion_detection: Some(true),
        voice_style_detection: None,
        speech_rate_detection: None,
        speech_rate_control: None,
        speaker_identification: None,
        persona_adaptation: None,
    });
    
    let job = dispatcher.create_job(
        "session-1".to_string(),
        0,
        "zh".to_string(),
        "en".to_string(),
        None,
        features,
        PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
        },
        vec![1, 2, 3, 4],
        "pcm16".to_string(),
        16000,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "trace-1".to_string(),
        None,
        None,
    ).await;
    
    // 应该分配了节点（节点有 emotion-xlm-r 模型且状态为 ready）
    assert_eq!(job.assigned_node_id, Some("node-emotion".to_string()));
}

#[tokio::test]
async fn test_select_node_with_module_expansion_no_model() {
    let registry = Arc::new(NodeRegistry::new());
    let dispatcher = JobDispatcher::new(registry.clone());
    
    // 注册节点：支持 emotion_detection 功能，但没有 emotion-xlm-r 服务
    let cap_state = create_capability_state_with_services(&[
        "node-inference",
        "nmt-m2m100",
        "piper-tts",
        // 没有 emotion-xlm-r
    ]);
    
    let _ = registry.register_node(
        Some("node-no-emotion-model".to_string()),
        "No Emotion Model Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        Some(create_installed_services(&["node-inference","nmt-m2m100","piper-tts"])),
        FeatureFlags {
            emotion_detection: Some(true), // 代码支持，但模型未安装
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        Some(cap_state),
    ).await;
    
    // 创建需要 emotion_detection 功能的 job
    let features = Some(FeatureFlags {
        emotion_detection: Some(true),
        voice_style_detection: None,
        speech_rate_detection: None,
        speech_rate_control: None,
        speaker_identification: None,
        persona_adaptation: None,
    });
    
    let job = dispatcher.create_job(
        "session-2".to_string(),
        0,
        "zh".to_string(),
        "en".to_string(),
        None,
        features,
        PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
        },
        vec![1, 2, 3, 4],
        "pcm16".to_string(),
        16000,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "trace-2".to_string(),
        None,
        None,
    ).await;
    
    // 应该没有分配节点（节点没有所需的模型）
    assert_eq!(job.assigned_node_id, None);
}

#[tokio::test]
async fn test_update_node_heartbeat_capability_state() {
    let registry = NodeRegistry::new();
    
    // 注册节点，初始时 emotion-xlm-r 服务状态为 downloading
    let mut initial_cap_state = HashMap::new();
    initial_cap_state.insert("emotion-xlm-r".to_string(), ModelStatus::Downloading);
    
    let _node = registry.register_node(
        Some("node-1".to_string()),
        "Node 1".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        Some(create_installed_services(&["emotion-xlm-r"])),
        FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        Some(initial_cap_state),
    ).await;
    
    // Set node to ready status
    registry.set_node_status("node-1", NodeStatus::Ready).await;
    
    // 检查初始状态：通过尝试选择节点来验证（模型未就绪，应该选不到）
    let required_models = vec!["emotion-xlm-r".to_string()];
    let (selected_before, _bd) = registry
        .select_node_with_models_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    assert_eq!(selected_before, None); // 模型未就绪，应该选不到
    
    // 更新心跳，服务状态变为 ready
    let mut updated_cap_state = HashMap::new();
    updated_cap_state.insert("emotion-xlm-r".to_string(), ModelStatus::Ready); // 现在 ready 了
    
    let success = registry.update_node_heartbeat(
        "node-1",
        10.0, // cpu_usage：低于阈值，避免因资源过滤导致选不到节点
        Some(0.0),  // gpu_usage
        10.0, // memory_usage：低于内存阈值
        None,  // installed_models
        None,  // installed_services
        0,
        Some(updated_cap_state),
    ).await;
    
    assert!(success);
    
    // 检查更新后的状态：现在应该可以选择这个节点了
    let required_models = vec!["emotion-xlm-r".to_string()];
    let (selected, _bd) = registry
        .select_node_with_models_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    assert_eq!(selected, Some("node-1".to_string()));
}

#[tokio::test]
async fn test_select_node_with_multiple_required_models() {
    let registry = Arc::new(NodeRegistry::new());
    
    // 注册节点1：只有 emotion-xlm-r 服务
    let cap_state_1 = create_capability_state_with_services(&[
        "emotion-xlm-r",
    ]);
    
    let _ = registry.register_node(
        Some("node-1".to_string()),
        "Node 1".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        Some(create_installed_services(&["emotion-xlm-r"])),
        FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        Some(cap_state_1),
    ).await;
    
    // 注册节点2：有 emotion-xlm-r 和 speaker-id-ecapa 服务
    let cap_state_2 = create_capability_state_with_services(&[
        "emotion-xlm-r",
        "speaker-id-ecapa",
    ]);
    
    let _ = registry.register_node(
        Some("node-2".to_string()),
        "Node 2".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        Some(create_installed_services(&["emotion-xlm-r","speaker-id-ecapa"])),
        FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: Some(true),
            persona_adaptation: None,
        },
        true,
        Some(cap_state_2),
    ).await;
    
    // Set nodes to ready status
    registry.set_node_status("node-1", NodeStatus::Ready).await;
    registry.set_node_status("node-2", NodeStatus::Ready).await;
    
    // 选择需要 emotion-xlm-r 和 speaker-id-ecapa 模型的节点
    let required_models = vec![
        "emotion-xlm-r".to_string(),
        "speaker-id-ecapa".to_string(),
    ];
    let (selected, _bd) = registry
        .select_node_with_models_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    
    // 应该选择节点2（有所有所需的模型）
    assert_eq!(selected, Some("node-2".to_string()));
    
    // 如果只选择 emotion-xlm-r，两个节点都可以，应该选择负载更低的
    let required_models = vec!["emotion-xlm-r".to_string()];
    let (selected, _bd) = registry
        .select_node_with_models_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    assert!(selected == Some("node-1".to_string()) || selected == Some("node-2".to_string()));
}

