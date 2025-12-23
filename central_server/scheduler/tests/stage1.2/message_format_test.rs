// 客户端消息格式对齐测试
// 验证移动端和 Electron Node 客户端的消息格式是否符合协议规范

use lingua_scheduler::messages::{
    SessionMessage, NodeMessage, FeatureFlags, PipelineConfig, InstalledModel, HardwareInfo,
};

#[test]
fn test_session_init_message_format() {
    // 测试 session_init 消息格式
    let message = SessionMessage::SessionInit {
        client_version: "1.0.0".to_string(),
        platform: "android".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: Some(FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: Some(false),
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        }),
        pairing_code: None,
        tenant_id: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: None,
    };

    // 验证所有必需字段都存在
    match message {
        SessionMessage::SessionInit {
            client_version,
            platform,
            src_lang,
            tgt_lang,
            dialect,
            features,
            pairing_code,
            tenant_id: _,
            mode: _,
            lang_a: _,
            lang_b: _,
            auto_langs: _,
            enable_streaming_asr: _,
            partial_update_interval_ms: _,
            trace_id: _,
        } => {
            assert_eq!(client_version, "1.0.0");
            assert_eq!(platform, "android");
            assert_eq!(src_lang, "zh");
            assert_eq!(tgt_lang, "en");
            assert!(dialect.is_none());
            assert!(features.is_some());
            assert!(pairing_code.is_none());
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_utterance_message_format() {
    // 测试 utterance 消息格式
    let message = SessionMessage::Utterance {
        session_id: "sess-123".to_string(),
        utterance_index: 0,
        manual_cut: true,
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: Some(FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: Some(false),
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        }),
        audio: "base64audio".to_string(),
        audio_format: "pcm16".to_string(),
        sample_rate: 16000,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: None,
    };

    // 验证所有必需字段都存在
    match message {
        SessionMessage::Utterance {
            session_id,
            utterance_index,
            manual_cut,
            src_lang,
            tgt_lang,
            dialect,
            features,
            audio,
            audio_format,
            sample_rate,
            mode: _,
            lang_a: _,
            lang_b: _,
            auto_langs: _,
            enable_streaming_asr: _,
            partial_update_interval_ms: _,
            trace_id: _,
        } => {
            assert_eq!(session_id, "sess-123");
            assert_eq!(utterance_index, 0);
            assert!(manual_cut);
            assert_eq!(src_lang, "zh");
            assert_eq!(tgt_lang, "en");
            assert!(dialect.is_none());
            assert!(features.is_some());
            assert_eq!(audio, "base64audio");
            assert_eq!(audio_format, "pcm16");
            assert_eq!(sample_rate, 16000);
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_node_register_message_format() {
    // 测试 node_register 消息格式
    let message = NodeMessage::NodeRegister {
        node_id: None,
        version: "1.0.0".to_string(),
        capability_schema_version: None,
        platform: "windows".to_string(),
        hardware: HardwareInfo {
            cpu_cores: 8,
            memory_gb: 16,
            gpus: None,
        },
        installed_models: vec![InstalledModel {
            model_id: "asr-1".to_string(),
            kind: "asr".to_string(),
            src_lang: None,
            tgt_lang: None,
            dialect: None,
            version: "1.0.0".to_string(),
            enabled: Some(true),
        }],
        installed_services: None,
        features_supported: FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: Some(true),
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        },
        advanced_features: None,
        accept_public_jobs: true,
        capability_by_type: vec![],
    };

    // 验证所有必需字段都存在
    match message {
        NodeMessage::NodeRegister {
            node_id,
            version,
            capability_schema_version: _,
            platform,
            hardware,
            installed_models,
            installed_services: _,
            features_supported,
            advanced_features: _,
            accept_public_jobs,
            capability_by_type: _,
        } => {
            assert!(node_id.is_none());
            assert_eq!(version, "1.0.0");
            assert_eq!(platform, "windows");
            assert_eq!(hardware.cpu_cores, 8);
            assert_eq!(hardware.memory_gb, 16);
            assert_eq!(installed_models.len(), 1);
            assert!(features_supported.emotion_detection == Some(true));
            assert!(accept_public_jobs);
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_node_heartbeat_message_format() {
    // 测试 node_heartbeat 消息格式
    use lingua_scheduler::messages::ResourceUsage;

    let message = NodeMessage::NodeHeartbeat {
        node_id: "node-123".to_string(),
        timestamp: 1234567890,
        resource_usage: ResourceUsage {
            cpu_percent: 50.0,
            gpu_percent: Some(60.0),
            gpu_mem_percent: Some(70.0),
            mem_percent: 40.0,
            running_jobs: 2,
        },
        installed_models: None,
        installed_services: vec![],
        capability_by_type: vec![],
    };

    // 验证所有必需字段都存在
    match message {
        NodeMessage::NodeHeartbeat {
            node_id,
            timestamp,
            resource_usage,
            installed_models,
            installed_services: _,
            capability_by_type: _,
        } => {
            assert_eq!(node_id, "node-123");
            assert_eq!(timestamp, 1234567890);
            assert_eq!(resource_usage.cpu_percent, 50.0);
            assert_eq!(resource_usage.gpu_percent, Some(60.0));
            assert_eq!(resource_usage.gpu_mem_percent, Some(70.0));
            assert_eq!(resource_usage.mem_percent, 40.0);
            assert_eq!(resource_usage.running_jobs, 2);
            assert!(installed_models.is_none());
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_job_result_message_format() {
    // 测试 job_result 消息格式
    use lingua_scheduler::messages::JobError;

    // 成功的情况
    let success_message = NodeMessage::JobResult {
        job_id: "job-123".to_string(),
        attempt_id: 1,
        node_id: "node-123".to_string(),
        session_id: "sess-123".to_string(),
        utterance_index: 0,
        success: true,
        text_asr: Some("识别文本".to_string()),
        text_translated: Some("translated text".to_string()),
        tts_audio: Some("base64audio".to_string()),
        tts_format: Some("pcm16".to_string()),
        extra: None,
        processing_time_ms: Some(100),
        error: None,
        trace_id: "trace-123".to_string(),
        group_id: None,
        part_index: None,
        node_completed_at_ms: None,
    };

    match success_message {
        NodeMessage::JobResult {
            job_id,
            attempt_id: _,
            node_id,
            session_id,
            utterance_index,
            success,
            text_asr,
            text_translated,
            tts_audio,
            tts_format,
            extra,
            processing_time_ms,
            error,
            trace_id: _,
            group_id: _,
            part_index: _,
            node_completed_at_ms: _,
        } => {
            assert_eq!(job_id, "job-123");
            assert_eq!(node_id, "node-123");
            assert_eq!(session_id, "sess-123");
            assert_eq!(utterance_index, 0);
            assert!(success);
            assert!(text_asr.is_some());
            assert!(text_translated.is_some());
            assert!(tts_audio.is_some());
            assert!(tts_format.is_some());
            assert!(extra.is_none());
            assert_eq!(processing_time_ms, Some(100));
            assert!(error.is_none());
        }
        _ => panic!("消息类型不匹配"),
    }

    // 失败的情况
    let error_message = NodeMessage::JobResult {
        job_id: "job-123".to_string(),
        attempt_id: 1,
        node_id: "node-123".to_string(),
        session_id: "sess-123".to_string(),
        utterance_index: 0,
        success: false,
        text_asr: None,
        text_translated: None,
        tts_audio: None,
        tts_format: None,
        extra: None,
        processing_time_ms: Some(50),
        error: Some(JobError {
            code: "MODEL_NOT_AVAILABLE".to_string(),
            message: "Model not found".to_string(),
            details: None,
        }),
        trace_id: "trace-456".to_string(),
        group_id: None,
        part_index: None,
        node_completed_at_ms: None,
    };

    match error_message {
        NodeMessage::JobResult {
            success,
            error,
            ..
        } => {
            assert!(!success);
            assert!(error.is_some());
            if let Some(err) = error {
                assert_eq!(err.code, "MODEL_NOT_AVAILABLE");
                assert_eq!(err.message, "Model not found");
            }
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_feature_flags_completeness() {
    // 验证 FeatureFlags 包含所有必需的功能字段
    let features = FeatureFlags {
        emotion_detection: Some(true),
        voice_style_detection: Some(false),
        speech_rate_detection: Some(true),
        speech_rate_control: Some(false),
        speaker_identification: Some(true),
        persona_adaptation: Some(false),
    };

    // 验证所有字段都可以设置
    assert_eq!(features.emotion_detection, Some(true));
    assert_eq!(features.voice_style_detection, Some(false));
    assert_eq!(features.speech_rate_detection, Some(true));
    assert_eq!(features.speech_rate_control, Some(false));
    assert_eq!(features.speaker_identification, Some(true));
    assert_eq!(features.persona_adaptation, Some(false));
}

#[test]
fn test_job_assign_message_format() {
    // 测试 job_assign 消息格式
    let message = NodeMessage::JobAssign {
        job_id: "job-123".to_string(),
        attempt_id: 1,
        session_id: "sess-123".to_string(),
        utterance_index: 0,
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: Some(FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: Some(false),
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        }),
        pipeline: PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
        },
        audio: "base64audio".to_string(),
        audio_format: "pcm16".to_string(),
        sample_rate: 16000,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: "trace-789".to_string(),
        group_id: None,
        part_index: None,
        context_text: None,
    };

    // 验证所有必需字段都存在
    match message {
        NodeMessage::JobAssign {
            job_id,
            attempt_id: _,
            session_id,
            utterance_index,
            src_lang,
            tgt_lang,
            dialect,
            features,
            pipeline,
            audio,
            audio_format,
            sample_rate,
            mode: _,
            lang_a: _,
            lang_b: _,
            auto_langs: _,
            enable_streaming_asr: _,
            partial_update_interval_ms: _,
            trace_id: _,
            group_id: _,
            part_index: _,
            context_text: _,
        } => {
            assert_eq!(job_id, "job-123");
            assert_eq!(session_id, "sess-123");
            assert_eq!(utterance_index, 0);
            assert_eq!(src_lang, "zh");
            assert_eq!(tgt_lang, "en");
            assert!(dialect.is_none());
            assert!(features.is_some());
            assert!(pipeline.use_asr);
            assert!(pipeline.use_nmt);
            assert!(pipeline.use_tts);
            assert_eq!(audio, "base64audio");
            assert_eq!(audio_format, "pcm16");
            assert_eq!(sample_rate, 16000);
        }
        _ => panic!("消息类型不匹配"),
    }
}

