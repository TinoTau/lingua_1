//! 阶段 3.2 节点选择测试
//! 测试基于 capability_state 和模块依赖展开的节点选择逻辑

use lingua_scheduler::dispatcher::JobDispatcher;
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::messages::{FeatureFlags, PipelineConfig, HardwareInfo, InstalledModel, CapabilityState, ModelStatus};
use std::collections::HashMap;
use std::sync::Arc;

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
async fn test_select_node_with_models_ready() {
    let registry = Arc::new(NodeRegistry::new());
    
    // 注册节点1：有 emotion-xlm-r 模型且状态为 ready
    let cap_state_1 = create_capability_state_with_models(&[
        "whisper-large-v3-zh",
        "m2m100-zh-en",
        "piper-tts-en",
        "emotion-xlm-r",
    ]);
    
    registry.register_node(
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
        Some(cap_state_1),
    ).await;
    
    // 注册节点2：没有 emotion-xlm-r 模型
    let cap_state_2 = create_capability_state_with_models(&[
        "whisper-large-v3-zh",
        "m2m100-zh-en",
        "piper-tts-en",
    ]);
    
    registry.register_node(
        Some("node-2".to_string()),
        "Node 2".to_string(),
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
        Some(cap_state_2),
    ).await;
    
    // 选择需要 emotion-xlm-r 模型的节点
    let required_models = vec!["emotion-xlm-r".to_string()];
    let selected = registry.select_node_with_models("zh", "en", &required_models, true).await;
    
    // 应该选择节点1（有模型且状态为 ready）
    assert_eq!(selected, Some("node-1".to_string()));
}

#[tokio::test]
async fn test_select_node_with_models_not_ready() {
    let registry = Arc::new(NodeRegistry::new());
    
    // 注册节点：有 emotion-xlm-r 模型但状态为 downloading
    let mut cap_state = HashMap::new();
    cap_state.insert("whisper-large-v3-zh".to_string(), ModelStatus::Ready);
    cap_state.insert("m2m100-zh-en".to_string(), ModelStatus::Ready);
    cap_state.insert("piper-tts-en".to_string(), ModelStatus::Ready);
    cap_state.insert("emotion-xlm-r".to_string(), ModelStatus::Downloading); // 正在下载
    
    registry.register_node(
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
        Some(cap_state),
    ).await;
    
    // 选择需要 emotion-xlm-r 模型的节点
    let required_models = vec!["emotion-xlm-r".to_string()];
    let selected = registry.select_node_with_models("zh", "en", &required_models, true).await;
    
    // 应该没有选择节点（模型未就绪）
    assert_eq!(selected, None);
}

#[tokio::test]
async fn test_select_node_with_module_expansion() {
    let registry = Arc::new(NodeRegistry::new());
    let dispatcher = JobDispatcher::new(registry.clone());
    
    // 注册节点：支持 emotion_detection 功能，且有 emotion-xlm-r 模型
    let cap_state = create_capability_state_with_models(&[
        "whisper-large-v3-zh",
        "m2m100-zh-en",
        "piper-tts-en",
        "emotion-xlm-r",
    ]);
    
    registry.register_node(
        Some("node-emotion".to_string()),
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
    ).await;
    
    // 应该分配了节点（节点有 emotion-xlm-r 模型且状态为 ready）
    assert_eq!(job.assigned_node_id, Some("node-emotion".to_string()));
}

#[tokio::test]
async fn test_select_node_with_module_expansion_no_model() {
    let registry = Arc::new(NodeRegistry::new());
    let dispatcher = JobDispatcher::new(registry.clone());
    
    // 注册节点：支持 emotion_detection 功能，但没有 emotion-xlm-r 模型
    let cap_state = create_capability_state_with_models(&[
        "whisper-large-v3-zh",
        "m2m100-zh-en",
        "piper-tts-en",
        // 没有 emotion-xlm-r
    ]);
    
    registry.register_node(
        Some("node-no-emotion-model".to_string()),
        "No Emotion Model Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    ).await;
    
    // 应该没有分配节点（节点没有所需的模型）
    assert_eq!(job.assigned_node_id, None);
}

#[tokio::test]
async fn test_update_node_heartbeat_capability_state() {
    let registry = NodeRegistry::new();
    
    // 注册节点，初始时 emotion-xlm-r 模型状态为 downloading
    let mut initial_cap_state = HashMap::new();
    initial_cap_state.insert("whisper-large-v3-zh".to_string(), ModelStatus::Ready);
    initial_cap_state.insert("m2m100-zh-en".to_string(), ModelStatus::Ready);
    initial_cap_state.insert("piper-tts-en".to_string(), ModelStatus::Ready);
    initial_cap_state.insert("emotion-xlm-r".to_string(), ModelStatus::Downloading);
    
    let _node = registry.register_node(
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
        Some(initial_cap_state),
    ).await;
    
    // 检查初始状态：通过尝试选择节点来验证（模型未就绪，应该选不到）
    let required_models = vec!["emotion-xlm-r".to_string()];
    let selected_before = registry.select_node_with_models("zh", "en", &required_models, true).await;
    assert_eq!(selected_before, None); // 模型未就绪，应该选不到
    
    // 更新心跳，模型状态变为 ready
    let mut updated_cap_state = HashMap::new();
    updated_cap_state.insert("whisper-large-v3-zh".to_string(), ModelStatus::Ready);
    updated_cap_state.insert("m2m100-zh-en".to_string(), ModelStatus::Ready);
    updated_cap_state.insert("piper-tts-en".to_string(), ModelStatus::Ready);
    updated_cap_state.insert("emotion-xlm-r".to_string(), ModelStatus::Ready); // 现在 ready 了
    
    let success = registry.update_node_heartbeat(
        "node-1",
        50.0,
        None,
        60.0,
        None,
        0,
        Some(updated_cap_state),
    ).await;
    
    assert!(success);
    
    // 检查更新后的状态：现在应该可以选择这个节点了
    let required_models = vec!["emotion-xlm-r".to_string()];
    let selected = registry.select_node_with_models("zh", "en", &required_models, true).await;
    assert_eq!(selected, Some("node-1".to_string()));
}

#[tokio::test]
async fn test_select_node_with_multiple_required_models() {
    let registry = Arc::new(NodeRegistry::new());
    
    // 注册节点1：只有 emotion-xlm-r 模型
    let cap_state_1 = create_capability_state_with_models(&[
        "whisper-large-v3-zh",
        "m2m100-zh-en",
        "piper-tts-en",
        "emotion-xlm-r",
    ]);
    
    registry.register_node(
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
        Some(cap_state_1),
    ).await;
    
    // 注册节点2：有 emotion-xlm-r 和 speaker-id-ecapa 模型
    let cap_state_2 = create_capability_state_with_models(&[
        "whisper-large-v3-zh",
        "m2m100-zh-en",
        "piper-tts-en",
        "emotion-xlm-r",
        "speaker-id-ecapa",
    ]);
    
    registry.register_node(
        Some("node-2".to_string()),
        "Node 2".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    // 选择需要 emotion-xlm-r 和 speaker-id-ecapa 模型的节点
    let required_models = vec![
        "emotion-xlm-r".to_string(),
        "speaker-id-ecapa".to_string(),
    ];
    let selected = registry.select_node_with_models("zh", "en", &required_models, true).await;
    
    // 应该选择节点2（有所有所需的模型）
    assert_eq!(selected, Some("node-2".to_string()));
    
    // 如果只选择 emotion-xlm-r，两个节点都可以，应该选择负载更低的
    let required_models = vec!["emotion-xlm-r".to_string()];
    let selected = registry.select_node_with_models("zh", "en", &required_models, true).await;
    assert!(selected == Some("node-1".to_string()) || selected == Some("node-2".to_string()));
}

