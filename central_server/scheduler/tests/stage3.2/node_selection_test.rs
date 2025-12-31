//! 阶段 3.2 节点选择测试
//! 测试基于 capability_state 和模块依赖展开的节点选择逻辑

use lingua_scheduler::core::dispatcher::JobDispatcher;
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::messages::{
    CapabilityByType, FeatureFlags, HardwareInfo, GpuInfo, InstalledModel, InstalledService,
    ServiceStatus, DeviceType, NodeStatus, PipelineConfig, ServiceType,
};
use lingua_scheduler::core::config::{Phase3Config, Phase3PoolConfig, Phase3TenantOverride, CoreServicesConfig};
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

fn create_capability_by_type_with_services(service_ids: &[&str]) -> Vec<CapabilityByType> {
    // 根据 service_id 映射到 ServiceType（简化版，实际应该根据服务配置）
    let mut result = Vec::new();
    let mut asr_impls = Vec::new();
    let mut nmt_impls = Vec::new();
    let mut tts_impls = Vec::new();
    let mut tone_impls = Vec::new();
    
    for service_id in service_ids {
        match *service_id {
            "node-inference" | "faster-whisper-vad" => asr_impls.push(service_id.to_string()),
            "nmt-m2m100" => nmt_impls.push(service_id.to_string()),
            "piper-tts" => tts_impls.push(service_id.to_string()),
            "emotion-xlm-r" | "speaker-id-ecapa" | "yourtts" => tone_impls.push(service_id.to_string()),
            _ => {}
        }
    }
    
    if !asr_impls.is_empty() {
        result.push(CapabilityByType { r#type: ServiceType::Asr, ready: true, reason: None, ready_impl_ids: Some(asr_impls) });
    }
    if !nmt_impls.is_empty() {
        result.push(CapabilityByType { r#type: ServiceType::Nmt, ready: true, reason: None, ready_impl_ids: Some(nmt_impls) });
    }
    if !tts_impls.is_empty() {
        result.push(CapabilityByType { r#type: ServiceType::Tts, ready: true, reason: None, ready_impl_ids: Some(tts_impls) });
    }
    if !tone_impls.is_empty() {
        result.push(CapabilityByType { r#type: ServiceType::Tone, ready: true, reason: None, ready_impl_ids: Some(tone_impls) });
    }
    
    result
}

fn create_installed_services(service_ids: &[&str]) -> Vec<InstalledService> {
    service_ids
        .iter()
        .map(|sid| {
            // 根据 service_id 映射到正确的 ServiceType
            let service_type = match *sid {
                "node-inference" | "faster-whisper-vad" => ServiceType::Asr,
                "nmt-m2m100" => ServiceType::Nmt,
                "piper-tts" => ServiceType::Tts,
                "emotion-xlm-r" | "speaker-id-ecapa" | "yourtts" => ServiceType::Tone,
                _ => ServiceType::Asr, // 默认值
            };
            InstalledService {
                service_id: (*sid).to_string(),
                r#type: service_type,
                device: lingua_scheduler::messages::DeviceType::Gpu,
                status: lingua_scheduler::messages::ServiceStatus::Running,
                version: Some("1.0.0".to_string()),
                model_id: None,
                engine: None,
                mem_mb: None,
                warmup_ms: None,
                last_error: None,
            }
        })
        .collect()
}

#[tokio::test]
async fn test_phase3_capability_pools_tenant_override_and_hash() {
    let registry = Arc::new(NodeRegistry::new());

    // core services（与默认值一致，但这里显式传入便于测试可读性）
    registry
        .set_core_services_config(CoreServicesConfig::default())
        .await;

    // 两个“能力相同”的 pools：节点会按 node_id hash 分配到其中一个；tenant 可显式绑定
    let mut p3 = Phase3Config::default();
    p3.enabled = true;
    p3.mode = "two_level".to_string();
    p3.fallback_scan_all_pools = true;
    p3.pool_match_scope = "core_only".to_string();
    p3.pool_match_mode = "contains".to_string();
    p3.strict_pool_eligibility = true;
    p3.hash_seed = 0;
    p3.pools = vec![
        Phase3PoolConfig {
            pool_id: 10,
            name: "core-a".to_string(),
            required_services: vec![
                "ASR".to_string(),
                "NMT".to_string(),
                "TTS".to_string(),
            ],
        },
        Phase3PoolConfig {
            pool_id: 11,
            name: "core-b".to_string(),
            required_services: vec![
                "ASR".to_string(),
                "NMT".to_string(),
                "TTS".to_string(),
            ],
        },
    ];
    p3.tenant_overrides = vec![Phase3TenantOverride {
        tenant_id: "tenant-A".to_string(),
        pool_id: 11,
    }];

    registry.set_phase3_config(p3.clone()).await;

    // 找两个 node_id：一个会落到 pool 10，一个会落到 pool 11（保证测试稳定）
    let mut node_for_10: Option<String> = None;
    let mut node_for_11: Option<String> = None;
    for i in 0..2000 {
        let nid = format!("node-cap-{}", i);
        let idx = lingua_scheduler::phase3::pick_index_for_key(2, p3.hash_seed, &nid);
        if idx == 0 && node_for_10.is_none() {
            node_for_10 = Some(nid.clone());
        }
        if idx == 1 && node_for_11.is_none() {
            node_for_11 = Some(nid.clone());
        }
        if node_for_10.is_some() && node_for_11.is_some() {
            break;
        }
    }
    let node_for_10 = node_for_10.expect("failed to find node_id mapping to pool 10");
    let node_for_11 = node_for_11.expect("failed to find node_id mapping to pool 11");

    // 注册两个节点（都具备核心服务包）
    let cap = create_capability_by_type_with_services(&["node-inference", "nmt-m2m100", "piper-tts"]);
    let services = create_installed_services(&["node-inference", "nmt-m2m100", "piper-tts"]);

    let _ = registry
        .register_node(
            Some(node_for_10.clone()),
            "Node A".to_string(),
            "1.0.0".to_string(),
            "linux".to_string(),
            create_test_hardware(),
            create_test_models("zh", "en"),
            Some(services.clone()),
            FeatureFlags {
                emotion_detection: None,
                voice_style_detection: None,
                speech_rate_detection: None,
                speech_rate_control: None,
                speaker_identification: None,
                persona_adaptation: None,
            },
            true,
            cap.clone(),
        )
        .await
        .unwrap();
    let _ = registry
        .register_node(
            Some(node_for_11.clone()),
            "Node B".to_string(),
            "1.0.0".to_string(),
            "linux".to_string(),
            create_test_hardware(),
            create_test_models("zh", "en"),
            Some(services.clone()),
            FeatureFlags {
                emotion_detection: None,
                voice_style_detection: None,
                speech_rate_detection: None,
                speech_rate_control: None,
                speaker_identification: None,
                persona_adaptation: None,
            },
            true,
            cap.clone(),
        )
        .await
        .unwrap();

    registry.set_node_status(&node_for_10, NodeStatus::Ready).await;
    registry.set_node_status(&node_for_11, NodeStatus::Ready).await;

    // 1) tenant override：应优先选择 pool 11
    let required = vec![
        ServiceType::Asr,
        ServiceType::Nmt,
        ServiceType::Tts,
    ];
    let (nid, dbg, _bd) = registry
        .select_node_with_types_two_level_excluding_with_breakdown(
            "tenant-A",
            "zh",
            "en",
            &required,
            true,
            None,
            Some(&CoreServicesConfig::default()),
        )
        .await;
    assert_eq!(dbg.preferred_pool, 11);
    assert_eq!(dbg.selected_pool, Some(11));
    assert_eq!(nid, Some(node_for_11.clone()));

    // 2) 非 override：按 routing_key hash 在 eligible pools 内稳定选择 preferred
    let rk = "tenant-B";
    let expected_idx = lingua_scheduler::phase3::pick_index_for_key(2, p3.hash_seed, rk);
    let expected_preferred = if expected_idx == 0 { 10 } else { 11 };
    let (nid2, dbg2, _bd2) = registry
        .select_node_with_types_two_level_excluding_with_breakdown(
            rk,
            "zh",
            "en",
            &required,
            true,
            None,
            Some(&CoreServicesConfig::default()),
        )
        .await;
    assert_eq!(dbg2.preferred_pool, expected_preferred);
    assert_eq!(dbg2.selected_pool, Some(expected_preferred));
    if expected_preferred == 10 {
        assert_eq!(nid2, Some(node_for_10));
    } else {
        assert_eq!(nid2, Some(node_for_11));
    }
}

#[tokio::test]
async fn test_phase3_capability_pools_exact_match_and_specificity_assignment() {
    let registry = Arc::new(NodeRegistry::new());
    registry
        .set_core_services_config(CoreServicesConfig::default())
        .await;

    // pool10：core（兜底）；pool12：core + optional（更具体）
    // 期望：
    // - node(core+optional) 归属 pool12（更具体优先）
    // - job(core) 只匹配 pool10（exact）
    // - job(core+optional) 只匹配 pool12（exact）
    let mut p3 = Phase3Config::default();
    p3.enabled = true;
    p3.mode = "two_level".to_string();
    p3.fallback_scan_all_pools = true;
    p3.pool_match_scope = "all_required".to_string();
    p3.pool_match_mode = "exact".to_string();
    p3.strict_pool_eligibility = true;
    p3.hash_seed = 0;
    p3.pools = vec![
        Phase3PoolConfig {
            pool_id: 10,
            name: "core".to_string(),
            required_services: vec![
                "ASR".to_string(),
                "NMT".to_string(),
                "TTS".to_string(),
            ],
        },
        Phase3PoolConfig {
            pool_id: 12,
            name: "core+optional".to_string(),
            required_services: vec![
                "ASR".to_string(),
                "NMT".to_string(),
                "TTS".to_string(),
                "TONE".to_string(),
            ],
        },
    ];
    registry.set_phase3_config(p3).await;

    // 注册 core 节点（应进入 pool10）
    let cap_core = create_capability_by_type_with_services(&["node-inference", "nmt-m2m100", "piper-tts"]);
    let services_core = create_installed_services(&["node-inference", "nmt-m2m100", "piper-tts"]);
    let _ = registry
        .register_node(
            Some("node-core".to_string()),
            "Core Node".to_string(),
            "1.0.0".to_string(),
            "linux".to_string(),
            create_test_hardware(),
            create_test_models("zh", "en"),
            Some(services_core),
            FeatureFlags {
                emotion_detection: None,
                voice_style_detection: None,
                speech_rate_detection: None,
                speech_rate_control: None,
                speaker_identification: None,
                persona_adaptation: None,
            },
            true,
            cap_core,
        )
        .await
        .unwrap();
    registry.set_node_status("node-core", NodeStatus::Ready).await;

    // 注册 core+optional 节点（应进入 pool12：更具体优先）
    let cap_opt = create_capability_by_type_with_services(&[
        "node-inference",
        "nmt-m2m100",
        "piper-tts",
        "speaker-id-ecapa",
        "yourtts",
    ]);
    let services_opt = create_installed_services(&[
        "node-inference",
        "nmt-m2m100",
        "piper-tts",
        "speaker-id-ecapa",
        "yourtts",
    ]);
    let _ = registry
        .register_node(
            Some("node-opt".to_string()),
            "Opt Node".to_string(),
            "1.0.0".to_string(),
            "linux".to_string(),
            create_test_hardware(),
            create_test_models("zh", "en"),
            Some(services_opt),
            FeatureFlags {
                emotion_detection: None,
                voice_style_detection: None,
                speech_rate_detection: None,
                speech_rate_control: None,
                speaker_identification: None,
                persona_adaptation: None,
            },
            true,
            cap_opt,
        )
        .await
        .unwrap();
    registry.set_node_status("node-opt", NodeStatus::Ready).await;

    // node-opt 应归属 pool12（更具体优先）
    let pid_opt = registry.phase3_node_pool_id("node-opt").await;
    assert_eq!(pid_opt, Some(12));

    // 1) core job：应只匹配 pool10，选择 node-core（按 ServiceType 过滤）
    let required_core = vec![
        ServiceType::Asr,
        ServiceType::Nmt,
        ServiceType::Tts,
    ];
    let (nid1, dbg1, _bd1) = registry
        .select_node_with_types_two_level_excluding_with_breakdown(
            "tenant-core",
            "zh",
            "en",
            &required_core,
            true,
            None,
            Some(&CoreServicesConfig::default()),
        )
        .await;
    assert_eq!(dbg1.selected_pool, Some(10));
    assert_eq!(nid1, Some("node-core".to_string()));

    // 2) core+optional job：应只匹配 pool12，选择 node-opt
    let required_opt = vec![
        ServiceType::Asr,
        ServiceType::Nmt,
        ServiceType::Tts,
        ServiceType::Tone,
    ];
    let (nid2, dbg2, _bd2) = registry
        .select_node_with_types_two_level_excluding_with_breakdown(
            "tenant-opt",
            "zh",
            "en",
            &required_opt,
            true,
            None,
            Some(&CoreServicesConfig::default()),
        )
        .await;
    assert_eq!(dbg2.selected_pool, Some(12));
    assert_eq!(nid2, Some("node-opt".to_string()));
}

#[tokio::test]
async fn test_select_node_with_models_ready() {
    let registry = Arc::new(NodeRegistry::new());
    
    // Phase 1：capability_state 的 key 统一为 service_id
    // 注册节点1：包含 emotion-xlm-r 服务且状态 ready
    let cap_state_1 = create_capability_by_type_with_services(&[
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
        cap_state_1.clone(),
    ).await;
    
    assert!(result.is_ok(), "节点1注册失败: {:?}", result.err());
    
    // 注册节点2：不包含 emotion-xlm-r
    let cap_state_2 = create_capability_by_type_with_services(&[]);
    
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
        cap_state_2.clone(),
    ).await;
    
    // 检查注册是否成功
    assert!(result.is_ok(), "节点2注册失败: {:?}", result.err());
    
    // Set nodes to ready status
    registry.set_node_status("node-1", NodeStatus::Ready).await;
    registry.set_node_status("node-2", NodeStatus::Ready).await;
    
    // 选择需要某个 ServiceType 的节点（这里用 Tone 做占位）
    let required_models = vec![ServiceType::Tone];
    
    // 调试：检查节点状态
    let node_ids = registry.list_node_ids_for_test().await;
    eprintln!("已注册的节点: {:?}", node_ids);
    for node_id in &node_ids {
        if let Some(node) = registry.get_node_for_test(node_id).await {
            eprintln!("节点 {}: status={:?}, online={}, gpus={:?}, capability_by_type={:?}", 
                node_id, node.status, node.online, node.hardware.gpus, node.capability_by_type);
        }
    }
    
    let (selected, _bd) = registry
        .select_node_with_types_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    
    // 应该选择节点1（有模型且状态为 ready）
    assert_eq!(selected, Some("node-1".to_string()), "选择的节点: {:?}", selected);
}

#[tokio::test]
async fn test_select_node_with_models_not_ready() {
    let registry = Arc::new(NodeRegistry::new());
    
    // 注册节点：有 emotion-xlm-r 服务但状态为 downloading（ready: false）
    let cap_state = vec![
        CapabilityByType { r#type: ServiceType::Tone, ready: false, reason: Some("downloading".to_string()), ready_impl_ids: Some(vec!["emotion-xlm-r".to_string()]) },
    ];
    
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
        cap_state,
    ).await;
    
    // 选择需要 emotion-xlm-r 模型的节点
    let required_models = vec![ServiceType::Tone];
    let (selected, _bd) = registry
        .select_node_with_types_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    
    // 应该没有选择节点（模型未就绪）
    assert_eq!(selected, None);
}

#[tokio::test]
async fn test_select_node_with_module_expansion() {
    let registry = Arc::new(NodeRegistry::new());
    let dispatcher = JobDispatcher::new(registry.clone());
    
    // 注册节点：支持 emotion_detection 功能，且有 emotion-xlm-r 服务
    let cap_state = create_capability_by_type_with_services(&[
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
        cap_state,
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
        None, // tenant_id
        None, // request_id
        None, // target_session_ids
        None, // first_chunk_client_timestamp_ms
        None, // padding_ms
        false, // is_manual_cut
        false, // is_pause_triggered
        false, // is_timeout_triggered
    ).await;
    
    // 应该分配了节点（节点有 emotion-xlm-r 模型且状态为 ready）
    assert_eq!(job.assigned_node_id, Some("node-emotion".to_string()));
}

#[tokio::test]
async fn test_select_node_with_module_expansion_no_model() {
    let registry = Arc::new(NodeRegistry::new());
    let dispatcher = JobDispatcher::new(registry.clone());
    
    // 注册节点：支持 emotion_detection 功能，但没有 emotion-xlm-r 服务
    let cap_state = create_capability_by_type_with_services(&[
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
        cap_state,
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
        None, // tenant_id
        None, // request_id
        None, // target_session_ids
        None, // first_chunk_client_timestamp_ms
        None, // padding_ms
        false, // is_manual_cut
        false, // is_pause_triggered
        false, // is_timeout_triggered
    ).await;
    
    // 应该没有分配节点（节点没有所需的模型）
    assert_eq!(job.assigned_node_id, None);
}

#[tokio::test]
async fn test_update_node_heartbeat_capability_state() {
    let registry = NodeRegistry::new();
    
    // 注册节点，初始时 emotion-xlm-r 服务状态为 downloading（ready: false）
    let initial_cap_state = vec![
        CapabilityByType { r#type: ServiceType::Tone, ready: false, reason: Some("downloading".to_string()), ready_impl_ids: Some(vec!["emotion-xlm-r".to_string()]) },
    ];
    
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
        initial_cap_state,
    ).await;
    
    // Set node to ready status
    registry.set_node_status("node-1", NodeStatus::Ready).await;
    
    // 检查初始状态：通过尝试选择节点来验证（能力未就绪，应该选不到）
    let required_models = vec![ServiceType::Tone];
    let (selected_before, _bd) = registry
        .select_node_with_types_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    assert_eq!(selected_before, None); // 模型未就绪，应该选不到

    // 更新心跳，服务状态变为 ready
    let updated_cap_state = vec![
        CapabilityByType { r#type: ServiceType::Tone, ready: true, reason: None, ready_impl_ids: Some(vec!["emotion-xlm-r".to_string()]) },
    ];

    let success = registry.update_node_heartbeat(
        "node-1",
        10.0, // cpu_usage：低于阈值，避免因资源过滤导致选不到节点
        Some(0.0),  // gpu_usage
        10.0, // memory_usage：低于内存阈值
        None,  // installed_models
        None,  // installed_services
        0,
        Some(updated_cap_state),
        None, // processing_metrics
    ).await;

    assert!(success);

    // 检查更新后的状态：现在应该可以选择这个节点了
    let required_models = vec![ServiceType::Tone];
    let (selected, _bd) = registry
        .select_node_with_types_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    assert_eq!(selected, Some("node-1".to_string()));
}

#[tokio::test]
async fn test_select_node_with_multiple_required_models() {
    let registry = Arc::new(NodeRegistry::new());
    
    // 注册节点1：只有 emotion-xlm-r 服务
    let cap_state_1 = create_capability_by_type_with_services(&[
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
        cap_state_1,
    ).await;
    
    // 注册节点2：有 emotion-xlm-r 和 speaker-id-ecapa 服务
    let cap_state_2 = create_capability_by_type_with_services(&[
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
        cap_state_2,
    ).await;
    
    // Set nodes to ready status
    registry.set_node_status("node-1", NodeStatus::Ready).await;
    registry.set_node_status("node-2", NodeStatus::Ready).await;
    
    // 选择需要 TONE 类型服务的节点（两个节点都满足，因为都有 TONE 类型且 ready）
    let required_models = vec![
        ServiceType::Tone,
    ];
    let (selected, _bd) = registry
        .select_node_with_types_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    
    // 两个节点都满足要求（都有 TONE 类型且 ready），选择哪个都可以（按负载选择）
    // 由于两个节点的 current_jobs 都是 0，选择是随机的或按节点ID顺序
    assert!(selected == Some("node-1".to_string()) || selected == Some("node-2".to_string()));
    
    // 如果只选择 TONE，两个节点都可以，应该选择负载更低的
    let required_models = vec![ServiceType::Tone];
    let (selected, _bd) = registry
        .select_node_with_types_excluding_with_breakdown("zh", "en", &required_models, true, None)
        .await;
    assert!(selected == Some("node-1".to_string()) || selected == Some("node-2".to_string()));
}

