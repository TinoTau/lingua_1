// ASR 部分结果消息测试
// 测试 asr_partial 消息的序列化和反序列化

use lingua_scheduler::messages::{NodeMessage, SessionMessage};

#[test]
fn test_node_message_asr_partial_serialization() {
    // 测试 NodeMessage::AsrPartial 的序列化
    let message = NodeMessage::AsrPartial {
        job_id: "job-123".to_string(),
        node_id: "node-456".to_string(),
        session_id: "session-789".to_string(),
        utterance_index: 0,
        text: "Hello world".to_string(),
        is_final: false,
        trace_id: "trace-123".to_string(),
    };

    // 序列化
    let json = serde_json::to_string(&message).expect("序列化失败");
    
    // 验证 JSON 包含必要字段
    assert!(json.contains("asr_partial"));
    assert!(json.contains("job-123"));
    assert!(json.contains("node-456"));
    assert!(json.contains("session-789"));
    assert!(json.contains("Hello world"));
    assert!(json.contains("\"is_final\":false"));

    // 反序列化
    let deserialized: NodeMessage = serde_json::from_str(&json).expect("反序列化失败");
    
    match deserialized {
        NodeMessage::AsrPartial {
            job_id,
            node_id,
            session_id,
            utterance_index,
            text,
            is_final,
            trace_id: _,
        } => {
            assert_eq!(job_id, "job-123");
            assert_eq!(node_id, "node-456");
            assert_eq!(session_id, "session-789");
            assert_eq!(utterance_index, 0);
            assert_eq!(text, "Hello world");
            assert_eq!(is_final, false);
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_node_message_asr_partial_final() {
    // 测试 is_final = true 的情况
    let message = NodeMessage::AsrPartial {
        job_id: "job-123".to_string(),
        node_id: "node-456".to_string(),
        session_id: "session-789".to_string(),
        utterance_index: 0,
        text: "Final result".to_string(),
        is_final: true,
        trace_id: "trace-789".to_string(),
    };

    let json = serde_json::to_string(&message).expect("序列化失败");
    assert!(json.contains("\"is_final\":true"));

    let deserialized: NodeMessage = serde_json::from_str(&json).expect("反序列化失败");
    match deserialized {
        NodeMessage::AsrPartial { is_final, .. } => {
            assert!(is_final);
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_session_message_asr_partial_serialization() {
    // 测试 SessionMessage::AsrPartial 的序列化
    let message = SessionMessage::AsrPartial {
        session_id: "session-789".to_string(),
        utterance_index: 1,
        job_id: "job-123".to_string(),
        text: "Partial result".to_string(),
        is_final: false,
        trace_id: "trace-456".to_string(),
    };

    // 序列化
    let json = serde_json::to_string(&message).expect("序列化失败");
    
    // 验证 JSON 包含必要字段
    assert!(json.contains("asr_partial"));
    assert!(json.contains("session-789"));
    assert!(json.contains("job-123"));
    assert!(json.contains("Partial result"));
    assert!(json.contains("\"is_final\":false"));

    // 反序列化
    let deserialized: SessionMessage = serde_json::from_str(&json).expect("反序列化失败");
    
    match deserialized {
        SessionMessage::AsrPartial {
            session_id,
            utterance_index,
            job_id,
            text,
            is_final,
            trace_id: _,
        } => {
            assert_eq!(session_id, "session-789");
            assert_eq!(utterance_index, 1);
            assert_eq!(job_id, "job-123");
            assert_eq!(text, "Partial result");
            assert_eq!(is_final, false);
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_job_assign_with_streaming_asr() {
    // 测试 JobAssign 消息包含流式 ASR 配置
    use lingua_scheduler::messages::PipelineConfig;

    let message = NodeMessage::JobAssign {
        job_id: "job-123".to_string(),
        attempt_id: 1,
        session_id: "session-789".to_string(),
        utterance_index: 0,
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: None,
        pipeline: PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
        },
        audio: "base64_audio_data".to_string(),
        audio_format: "pcm16".to_string(),
        sample_rate: 16000,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: Some(true),
        partial_update_interval_ms: Some(1000),
        trace_id: "trace-789".to_string(),
        group_id: None,
        part_index: None,
        context_text: None,
    };

    // 序列化
    let json = serde_json::to_string(&message).expect("序列化失败");
    
    // 验证包含流式 ASR 配置
    assert!(json.contains("enable_streaming_asr"));
    assert!(json.contains("partial_update_interval_ms"));

    // 反序列化
    let deserialized: NodeMessage = serde_json::from_str(&json).expect("反序列化失败");
    
    match deserialized {
        NodeMessage::JobAssign {
            enable_streaming_asr,
            partial_update_interval_ms,
            trace_id: _,
            ..
        } => {
            assert_eq!(enable_streaming_asr, Some(true));
            assert_eq!(partial_update_interval_ms, Some(1000));
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_job_assign_without_streaming_asr() {
    // 测试 JobAssign 消息不包含流式 ASR 配置（可选字段）
    use lingua_scheduler::messages::PipelineConfig;

    let message = NodeMessage::JobAssign {
        job_id: "job-123".to_string(),
        attempt_id: 1,
        session_id: "session-789".to_string(),
        utterance_index: 0,
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: None,
        pipeline: PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
        },
        audio: "base64_audio_data".to_string(),
        audio_format: "pcm16".to_string(),
        sample_rate: 16000,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: "trace-999".to_string(),
        group_id: None,
        part_index: None,
        context_text: None,
    };

    // 序列化
    let json = serde_json::to_string(&message).expect("序列化失败");
    
    // 验证可选字段被跳过（skip_serializing_if）
    assert!(!json.contains("enable_streaming_asr"));
    assert!(!json.contains("partial_update_interval_ms"));
}

