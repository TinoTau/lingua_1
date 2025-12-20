// 任务分发单元测试

use lingua_scheduler::core::dispatcher::JobDispatcher;
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::messages::{
    CapabilityState, FeatureFlags, HardwareInfo, GpuInfo, InstalledModel, InstalledService,
    ModelStatus, NodeStatus, PipelineConfig,
};
use std::sync::Arc;

fn create_test_node_registry() -> Arc<NodeRegistry> {
    Arc::new(NodeRegistry::new())
}

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

fn create_core_installed_services() -> Vec<InstalledService> {
    vec![
        InstalledService {
            service_id: "node-inference".to_string(),
            version: "1.0.0".to_string(),
            platform: "linux-x64".to_string(),
        },
        InstalledService {
            service_id: "nmt-m2m100".to_string(),
            version: "1.0.0".to_string(),
            platform: "linux-x64".to_string(),
        },
        InstalledService {
            service_id: "piper-tts".to_string(),
            version: "1.0.0".to_string(),
            platform: "linux-x64".to_string(),
        },
    ]
}

#[tokio::test]
async fn test_create_job() {
    let node_registry = create_test_node_registry();
    let dispatcher = JobDispatcher::new(node_registry.clone());
    
    // 先注册一个节点
    let mut cap: CapabilityState = CapabilityState::new();
    // Phase 1：严格模式下，核心 required ids 必须在 capability_state(Ready) 或 installed_services 出现
    cap.insert("node-inference".to_string(), ModelStatus::Ready);
    cap.insert("nmt-m2m100".to_string(), ModelStatus::Ready);
    cap.insert("piper-tts".to_string(), ModelStatus::Ready);
    let _node = node_registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
        Some(cap),
    ).await.unwrap();
    
    // 将节点状态设置为 ready（才能被分配任务）
    node_registry.set_node_status(&_node.node_id, NodeStatus::Ready).await;
    
    let job = dispatcher.create_job(
        "session-1".to_string(),
        0,
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
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
        None,
    ).await;
    
    assert!(job.job_id.starts_with("job-"));
    assert_eq!(job.session_id, "session-1");
    assert_eq!(job.utterance_index, 0);
    assert_eq!(job.src_lang, "zh");
    assert_eq!(job.tgt_lang, "en");
    assert_eq!(job.audio_data, vec![1, 2, 3, 4]);
    assert_eq!(job.audio_format, "pcm16");
    assert_eq!(job.sample_rate, 16000);
    // 应该分配了节点
    assert!(job.assigned_node_id.is_some());
}

#[tokio::test]
async fn test_create_job_with_preferred_node() {
    let node_registry = create_test_node_registry();
    let dispatcher = JobDispatcher::new(node_registry.clone());
    
    let mut cap: CapabilityState = CapabilityState::new();
    cap.insert("node-inference".to_string(), ModelStatus::Ready);
    cap.insert("nmt-m2m100".to_string(), ModelStatus::Ready);
    cap.insert("piper-tts".to_string(), ModelStatus::Ready);
    let _node = node_registry.register_node(
        Some("node-123".to_string()),
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
        Some(cap),
    ).await.unwrap();
    
    // 需要设置为 ready，Phase 1 只允许对 ready 节点做并发占用（reserve）与派发
    node_registry.set_node_status("node-123", NodeStatus::Ready).await;
    
    let job = dispatcher.create_job(
        "session-2".to_string(),
        1,
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
        },
        vec![5, 6, 7, 8],
        "pcm16".to_string(),
        16000,
        Some("node-123".to_string()),
        None,
        None,
        None,
        None,
        None,
        None,
        "trace-2".to_string(),
        None,
        None,
        None,
    ).await;
    
    assert_eq!(job.assigned_node_id, Some("node-123".to_string()));
}

#[tokio::test]
async fn test_create_job_no_available_node() {
    let node_registry = create_test_node_registry();
    let dispatcher = JobDispatcher::new(node_registry);
    
    // 不注册任何节点
    
    let job = dispatcher.create_job(
        "session-3".to_string(),
        0,
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
        },
        vec![1, 2, 3],
        "pcm16".to_string(),
        16000,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "trace-3".to_string(),
        None,
        None,
        None,
    ).await;
    
    // 应该没有分配节点
    assert!(job.assigned_node_id.is_none());
    assert_eq!(job.status, lingua_scheduler::core::dispatcher::JobStatus::Pending);
}

#[tokio::test]
async fn test_get_job() {
    let node_registry = create_test_node_registry();
    let dispatcher = JobDispatcher::new(node_registry.clone());
    
    let _node = node_registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
        None,
    ).await.unwrap();
    
    let job = dispatcher.create_job(
        "session-4".to_string(),
        0,
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
        },
        vec![1, 2, 3],
        "pcm16".to_string(),
        16000,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "trace-4".to_string(),
        None,
        None,
        None,
    ).await;
    
    let retrieved = dispatcher.get_job(&job.job_id).await;
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.job_id, job.job_id);
    assert_eq!(retrieved.session_id, "session-4");
}

#[tokio::test]
async fn test_get_nonexistent_job() {
    let node_registry = create_test_node_registry();
    let dispatcher = JobDispatcher::new(node_registry);
    
    let retrieved = dispatcher.get_job("nonexistent").await;
    assert!(retrieved.is_none());
}

#[tokio::test]
async fn test_update_job_status() {
    let node_registry = create_test_node_registry();
    let dispatcher = JobDispatcher::new(node_registry.clone());
    
    let mut cap: CapabilityState = CapabilityState::new();
    cap.insert("node-inference".to_string(), ModelStatus::Ready);
    cap.insert("nmt-m2m100".to_string(), ModelStatus::Ready);
    cap.insert("piper-tts".to_string(), ModelStatus::Ready);
    let _node = node_registry.register_node(
        None,
        "Test Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
        Some(cap),
    ).await.unwrap();
    
    // 将节点状态设置为 ready（才能被分配任务）
    node_registry.set_node_status(&_node.node_id, NodeStatus::Ready).await;
    
    let job = dispatcher.create_job(
        "session-5".to_string(),
        0,
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
        },
        vec![1, 2, 3],
        "pcm16".to_string(),
        16000,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "trace-5".to_string(),
        None,
        None,
        None,
    ).await;
    
    assert_eq!(job.status, lingua_scheduler::core::dispatcher::JobStatus::Assigned);
    
    let success = dispatcher.update_job_status(&job.job_id, lingua_scheduler::core::dispatcher::JobStatus::Processing).await;
    assert!(success);
    
    let updated = dispatcher.get_job(&job.job_id).await.unwrap();
    assert_eq!(updated.status, lingua_scheduler::core::dispatcher::JobStatus::Processing);
    
    let success = dispatcher.update_job_status(&job.job_id, lingua_scheduler::core::dispatcher::JobStatus::Completed).await;
    assert!(success);
    
    let updated = dispatcher.get_job(&job.job_id).await.unwrap();
    assert_eq!(updated.status, lingua_scheduler::core::dispatcher::JobStatus::Completed);
}

#[tokio::test]
async fn test_update_nonexistent_job_status() {
    let node_registry = create_test_node_registry();
    let dispatcher = JobDispatcher::new(node_registry);
    
    let success = dispatcher.update_job_status("nonexistent", lingua_scheduler::core::dispatcher::JobStatus::Completed).await;
    assert!(!success);
}

