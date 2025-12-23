// 鑺傜偣娉ㄥ唽琛ㄥ崟鍏冩祴锟?

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
    ).await.unwrap(); // 蹇呴』锟?GPU锛屾墍浠ュ簲璇ユ垚锟?
    
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
    
    // 灏濊瘯娉ㄥ唽娌℃湁 GPU 鐨勮妭鐐癸紝搴旇澶辫触
    let result = registry.register_node(
        Some("test-node-no-gpu".to_string()),
        "Test Node No GPU".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware_no_gpu(),
        create_test_models("zh", "en"),
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
    
    // 搴旇杩斿洖閿欒
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
        None,
        FeatureFlags {
            emotion_detection: None,
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        false,
        vec![],
    ).await.unwrap(); // 蹇呴』锟?GPU锛屾墍浠ュ簲璇ユ垚锟?
    
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
    
    // 鏇存柊鑺傜偣锛屼娇鍏惰揪鍒版渶澶у苟鍙戞暟
    registry.update_node_heartbeat(
        "node-2",
        50.0,
        None,
        60.0,
        None,
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
    
    let success = registry.update_node_heartbeat(
        "node-3",
        75.0,
        Some(80.0),
        65.0,
        None,
        None,
        2,
        None,
    ).await;
    
    assert!(success);
    
    // 楠岃瘉鑺傜偣鐘舵€佸凡鏇存柊锛堥€氳繃鍙敤鎬ф鏌ワ級
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
        None,
        0,
        None,
    ).await;
    
    assert!(!success);
}

#[tokio::test]
async fn test_select_node_with_features() {
    let registry = NodeRegistry::new();
    
    // 娉ㄥ唽鏀寔涓枃鍒拌嫳鏂囩殑鑺傜偣
    registry.register_node(
        Some("node-zh-en".to_string()),
        "ZH-EN Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        None,
        FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![],
    ).await.unwrap();
    
    // 娉ㄥ唽鏀寔鑻辨枃鍒颁腑鏂囩殑鑺傜偣
    registry.register_node(
        Some("node-en-zh".to_string()),
        "EN-ZH Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("en", "zh"),
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
    
    // 閫夋嫨涓枃鍒拌嫳鏂囩殑鑺傜偣
    // 灏嗚妭鐐圭姸鎬佽缃负 ready锛堟墠鑳借閫変腑锛?
    registry.set_node_status("node-zh-en", NodeStatus::Ready).await;
    registry.set_node_status("node-en-zh", NodeStatus::Ready).await;

    // Phase 1：select_node_with_features 不再按语言过滤，验证“按负载选择最空闲节点”
    registry.update_node_heartbeat("node-zh-en", 10.0, Some(0.0), 10.0, None, None, 0, None).await;
    registry.update_node_heartbeat("node-en-zh", 10.0, Some(0.0), 10.0, None, None, 1, None).await;

    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-zh-en".to_string()));

    registry.update_node_heartbeat("node-zh-en", 10.0, Some(0.0), 10.0, None, None, 2, None).await;
    registry.update_node_heartbeat("node-en-zh", 10.0, Some(0.0), 10.0, None, None, 0, None).await;

    let selected = registry.select_node_with_features("en", "zh", &None, true).await;
    assert_eq!(selected, Some("node-en-zh".to_string()));
}

#[tokio::test]
async fn test_select_node_with_required_features() {
    let registry = NodeRegistry::new();
    
    // 娉ㄥ唽涓嶆敮鎸佹儏鎰熷垎鏋愮殑鑺傜偣
    registry.register_node(
        Some("node-no-emotion".to_string()),
        "No Emotion Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    // 娉ㄥ唽鏀寔鎯呮劅鍒嗘瀽鐨勮妭锟?
    registry.register_node(
        Some("node-with-emotion".to_string()),
        "Emotion Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
        None,
        FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        true,
        vec![],
    ).await.unwrap();
    
    // 瑕佹眰鎯呮劅鍒嗘瀽鍔熻兘
    let required_features = Some(FeatureFlags {
        emotion_detection: Some(true),
        voice_style_detection: None,
        speech_rate_detection: None,
        speech_rate_control: None,
        speaker_identification: None,
        persona_adaptation: None,
    });
    
    // 灏嗚妭鐐圭姸鎬佽缃负 ready
    registry.set_node_status("node-with-emotion", NodeStatus::Ready).await;
    
    let selected = registry.select_node_with_features("zh", "en", &required_features, true).await;
    assert_eq!(selected, Some("node-with-emotion".to_string()));
}

#[tokio::test]
async fn test_select_node_no_match() {
    let registry = NodeRegistry::new();
    
    // 涓嶆敞鍐屼换浣曡妭锟?
    
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
    
    assert!(registry.is_node_available("node-4").await);
    
    registry.mark_node_offline("node-4").await;
    
    assert!(!registry.is_node_available("node-4").await);
}

#[tokio::test]
async fn test_select_node_least_connections() {
    let registry = NodeRegistry::new();
    
    // 娉ㄥ唽涓変釜鑺傜偣锛岄兘鏀寔鐩稿悓鐨勮瑷€锟?
    registry.register_node(
        Some("node-heavy".to_string()),
        "Heavy Load Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    registry.register_node(
        Some("node-medium".to_string()),
        "Medium Load Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    registry.register_node(
        Some("node-light".to_string()),
        "Light Load Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    // 灏嗘墍鏈夎妭鐐圭姸鎬佽缃负 ready
    registry.set_node_status("node-heavy", NodeStatus::Ready).await;
    registry.set_node_status("node-medium", NodeStatus::Ready).await;
    registry.set_node_status("node-light", NodeStatus::Ready).await;
    
    // 鏇存柊鑺傜偣璐熻浇锛歨eavy=3, medium=1, light=0
    // 娉ㄦ剰锛氳祫婧愪娇鐢ㄧ巼闇€瑕佷綆浜庨槇鍊硷紙榛樿 25%锛夛紝鎵€浠ヨ缃负 20%
    registry.update_node_heartbeat("node-heavy", 20.0, None, 20.0, None, None, 3, None).await;
    registry.update_node_heartbeat("node-medium", 20.0, None, 20.0, None, None, 1, None).await;
    registry.update_node_heartbeat("node-light", 20.0, None, 20.0, None, None, 0, None).await;
    
    // 搴旇閫夋嫨璐熻浇鏈€杞荤殑鑺傜偣锛坈urrent_jobs=0锟?
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-light".to_string()));
    
    // 鏇存柊锛歨eavy=2, medium=1, light=2
    // 娉ㄦ剰锛氳祫婧愪娇鐢ㄧ巼闇€瑕佷綆浜庨槇鍊硷紙榛樿 25%锛夛紝鎵€浠ヨ缃负 20%
    registry.update_node_heartbeat("node-heavy", 20.0, None, 20.0, None, None, 2, None).await;
    registry.update_node_heartbeat("node-light", 20.0, None, 20.0, None, None, 2, None).await;
    
    // 搴旇閫夋嫨璐熻浇鏈€杞荤殑鑺傜偣锛坈urrent_jobs=1锟?
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-medium".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_cpu() {
    // 鍒涘缓甯﹁祫婧愰槇鍊肩殑娉ㄥ唽琛紙榛樿 25%锟?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 娉ㄥ唽涓や釜鑺傜偣锛岄兘鏀寔鐩稿悓鐨勮瑷€锟?
    registry.register_node(
        Some("node-low-cpu".to_string()),
        "Low CPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    registry.register_node(
        Some("node-high-cpu".to_string()),
        "High CPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    // 鏇存柊鑺傜偣璧勬簮浣跨敤鐜囷細low-cpu=20%, high-cpu=30%锛堣秴杩囬槇鍊硷級
    registry.update_node_heartbeat("node-low-cpu", 20.0, None, 15.0, None, None, 0, None).await;
    registry.update_node_heartbeat("node-high-cpu", 30.0, None, 15.0, None, None, 0, None).await;
    
    // 灏嗘墍鏈夎妭鐐圭姸鎬佽缃负 ready
    registry.set_node_status("node-low-cpu", NodeStatus::Ready).await;
    registry.set_node_status("node-high-cpu", NodeStatus::Ready).await;
    
    // 閫夋嫨鑺傜偣锛屽簲璇ュ彧閫夋嫨 CPU 浣跨敤鐜囦綆浜庨槇鍊肩殑鑺傜偣
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-low-cpu".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_gpu() {
    // 鍒涘缓甯﹁祫婧愰槇鍊肩殑娉ㄥ唽琛紙榛樿 25%锟?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 娉ㄥ唽涓や釜鑺傜偣锛岄兘鏀寔鐩稿悓鐨勮瑷€锟?
    registry.register_node(
        Some("node-low-gpu".to_string()),
        "Low GPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    registry.register_node(
        Some("node-high-gpu".to_string()),
        "High GPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    // 鏇存柊鑺傜偣璧勬簮浣跨敤鐜囷細low-gpu GPU=20%, high-gpu GPU=30%锛堣秴杩囬槇鍊硷級
    registry.update_node_heartbeat("node-low-gpu", 15.0, Some(20.0), 15.0, None, None, 0, None).await;
    registry.update_node_heartbeat("node-high-gpu", 15.0, Some(30.0), 15.0, None, None, 0, None).await;
    
    // 灏嗘墍鏈夎妭鐐圭姸鎬佽缃负 ready
    registry.set_node_status("node-low-gpu", NodeStatus::Ready).await;
    registry.set_node_status("node-high-gpu", NodeStatus::Ready).await;
    
    // 閫夋嫨鑺傜偣锛屽簲璇ュ彧閫夋嫨 GPU 浣跨敤鐜囦綆浜庨槇鍊肩殑鑺傜偣
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-low-gpu".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_memory() {
    // 鍒涘缓甯﹁祫婧愰槇鍊肩殑娉ㄥ唽琛紙榛樿 25%锟?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 娉ㄥ唽涓や釜鑺傜偣锛岄兘鏀寔鐩稿悓鐨勮瑷€锟?
    registry.register_node(
        Some("node-low-mem".to_string()),
        "Low Memory Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    registry.register_node(
        Some("node-high-mem".to_string()),
        "High Memory Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    // 更新节点资源使用率：low-mem 内存=20%，high-mem 内存=80%（超过内存阈值 75%）
    registry.update_node_heartbeat("node-low-mem", 15.0, None, 20.0, None, None, 0, None).await;
    registry.update_node_heartbeat("node-high-mem", 15.0, None, 80.0, None, None, 0, None).await;
    
    // 灏嗘墍鏈夎妭鐐圭姸鎬佽缃负 ready
    registry.set_node_status("node-low-mem", NodeStatus::Ready).await;
    registry.set_node_status("node-high-mem", NodeStatus::Ready).await;
    
    // 閫夋嫨鑺傜偣锛屽簲璇ュ彧閫夋嫨鍐呭瓨浣跨敤鐜囦綆浜庨槇鍊肩殑鑺傜偣
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-low-mem".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_all_resources() {
    // 鍒涘缓甯﹁祫婧愰槇鍊肩殑娉ㄥ唽琛紙榛樿 25%锟?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 娉ㄥ唽涓変釜鑺傜偣
    registry.register_node(
        Some("node-ok".to_string()),
        "OK Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    registry.register_node(
        Some("node-high-cpu".to_string()),
        "High CPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    registry.register_node(
        Some("node-high-gpu".to_string()),
        "High GPU Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    // 鏇存柊鑺傜偣璧勬簮浣跨敤锟?
    // node-ok: 鎵€鏈夎祫婧愰兘鍦ㄩ槇鍊间互锟?
    registry.update_node_heartbeat("node-ok", 20.0, Some(20.0), 20.0, None, None, 0, None).await;
    // node-high-cpu: CPU 瓒呰繃闃堬拷?
    registry.update_node_heartbeat("node-high-cpu", 30.0, Some(20.0), 20.0, None, None, 0, None).await;
    // node-high-gpu: GPU 瓒呰繃闃堬拷?
    registry.update_node_heartbeat("node-high-gpu", 20.0, Some(30.0), 20.0, None, None, 0, None).await;
    
    // 灏嗘墍鏈夎妭鐐圭姸鎬佽缃负 ready
    registry.set_node_status("node-ok", NodeStatus::Ready).await;
    registry.set_node_status("node-high-cpu", NodeStatus::Ready).await;
    registry.set_node_status("node-high-gpu", NodeStatus::Ready).await;
    
    // 閫夋嫨鑺傜偣锛屽簲璇ュ彧閫夋嫨鎵€鏈夎祫婧愰兘鍦ㄩ槇鍊间互涓嬬殑鑺傜偣
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-ok".to_string()));
}

#[tokio::test]
async fn test_select_node_resource_threshold_no_available() {
    // 鍒涘缓甯﹁祫婧愰槇鍊肩殑娉ㄥ唽琛紙榛樿 25%锟?
    let registry = NodeRegistry::with_resource_threshold(25.0);
    
    // 娉ㄥ唽涓€涓妭鐐癸紝浣嗚祫婧愪娇鐢ㄧ巼瓒呰繃闃堬拷?
    registry.register_node(
        Some("node-overloaded".to_string()),
        "Overloaded Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    // 鏇存柊鑺傜偣璧勬簮浣跨敤鐜囷紝鎵€鏈夎祫婧愰兘瓒呰繃闃堬拷?
    registry.update_node_heartbeat("node-overloaded", 30.0, Some(30.0), 30.0, None, None, 0, None).await;
    
    // 閫夋嫨鑺傜偣锛屽簲璇ヨ繑锟?None锛堟病鏈夊彲鐢ㄨ妭鐐癸級
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, None);
}

#[tokio::test]
async fn test_select_node_resource_threshold_custom_threshold() {
    // 鍒涘缓甯﹁嚜瀹氫箟璧勬簮闃堝€肩殑娉ㄥ唽琛紙50%锟?
    let registry = NodeRegistry::with_resource_threshold(50.0);
    
    // 娉ㄥ唽涓や釜鑺傜偣
    registry.register_node(
        Some("node-40".to_string()),
        "40% Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    registry.register_node(
        Some("node-60".to_string()),
        "60% Node".to_string(),
        "1.0.0".to_string(),
        "linux".to_string(),
        create_test_hardware(),
        create_test_models("zh", "en"),
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
    
    // Set all nodes to ready status
    registry.set_node_status("node-40", NodeStatus::Ready).await;
    registry.set_node_status("node-60", NodeStatus::Ready).await;

    // 鏇存柊鑺傜偣璧勬簮浣跨敤锟?
    registry.update_node_heartbeat("node-40", 40.0, None, 40.0, None, None, 0, None).await;
    registry.update_node_heartbeat("node-60", 60.0, None, 60.0, None, None, 0, None).await;
    
    // 閫夋嫨鑺傜偣锛岄槇鍊兼槸 50%锛屾墍锟?node-40 鍙敤锛宯ode-60 涓嶅彲锟?
    let selected = registry.select_node_with_features("zh", "en", &None, true).await;
    assert_eq!(selected, Some("node-40".to_string()));
}

