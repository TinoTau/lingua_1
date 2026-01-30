//! Phase 3: Session Init 协议增强测试
//! 测试 trace_id 和 tenant_id 字段的处理

use lingua_scheduler::messages::SessionMessage;

#[test]
fn test_session_init_with_trace_id() {
    // 测试 SessionInit 消息包含 trace_id
    let message = SessionMessage::SessionInit {
        client_version: "1.0.0".to_string(),
        platform: "web".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: None,
        pairing_code: None,
        tenant_id: None,
        mode: Some("one_way".to_string()),
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("test-trace-123".to_string()),
    };
    
    match message {
        SessionMessage::SessionInit { trace_id, .. } => {
            assert_eq!(trace_id, Some("test-trace-123".to_string()));
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_session_init_with_tenant_id() {
    // 测试 SessionInit 消息包含 tenant_id
    let message = SessionMessage::SessionInit {
        client_version: "1.0.0".to_string(),
        platform: "web".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: None,
        pairing_code: None,
        tenant_id: Some("tenant-abc".to_string()),
        mode: Some("one_way".to_string()),
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: None,
    };
    
    match message {
        SessionMessage::SessionInit { tenant_id, .. } => {
            assert_eq!(tenant_id, Some("tenant-abc".to_string()));
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_session_init_with_both_trace_and_tenant() {
    // 测试 SessionInit 消息同时包含 trace_id 和 tenant_id
    let message = SessionMessage::SessionInit {
        client_version: "1.0.0".to_string(),
        platform: "web".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: None,
        pairing_code: None,
        tenant_id: Some("tenant-xyz".to_string()),
        mode: Some("one_way".to_string()),
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("trace-xyz-789".to_string()),
    };
    
    match message {
        SessionMessage::SessionInit { trace_id, tenant_id, .. } => {
            assert_eq!(trace_id, Some("trace-xyz-789".to_string()));
            assert_eq!(tenant_id, Some("tenant-xyz".to_string()));
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_session_init_without_trace_and_tenant() {
    // 测试 SessionInit 消息不包含 trace_id 和 tenant_id（可选字段）
    let message = SessionMessage::SessionInit {
        client_version: "1.0.0".to_string(),
        platform: "web".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: None,
        pairing_code: None,
        tenant_id: None,
        mode: Some("one_way".to_string()),
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: None,
    };
    
    match message {
        SessionMessage::SessionInit { trace_id, tenant_id, .. } => {
            assert_eq!(trace_id, None);
            assert_eq!(tenant_id, None);
        }
        _ => panic!("消息类型不匹配"),
    }
}

#[test]
fn test_session_init_serialization() {
    // 测试 SessionInit 消息的序列化（验证字段是否正确序列化）
    use serde_json;
    
    let message = SessionMessage::SessionInit {
        client_version: "1.0.0".to_string(),
        platform: "web".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: None,
        pairing_code: None,
        tenant_id: Some("tenant-123".to_string()),
        mode: Some("one_way".to_string()),
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("trace-456".to_string()),
    };
    
    let json = serde_json::to_string(&message).expect("序列化失败");
    
    // 验证 JSON 包含 trace_id 和 tenant_id
    assert!(json.contains("trace-456"), "JSON 应该包含 trace_id");
    assert!(json.contains("tenant-123"), "JSON 应该包含 tenant_id");
    
    // 验证可以反序列化
    let deserialized: SessionMessage = serde_json::from_str(&json)
        .expect("反序列化失败");
    
    match deserialized {
        SessionMessage::SessionInit { trace_id, tenant_id, .. } => {
            assert_eq!(trace_id, Some("trace-456".to_string()));
            assert_eq!(tenant_id, Some("tenant-123".to_string()));
        }
        _ => panic!("反序列化后的消息类型不匹配"),
    }
}

#[test]
fn test_session_init_ack_with_trace_id() {
    // 测试 SessionInitAck 消息包含 trace_id
    let ack = SessionMessage::SessionInitAck {
        session_id: "session-123".to_string(),
        assigned_node_id: Some("node-1".to_string()),
        message: "OK".to_string(),
        trace_id: "trace-ack-123".to_string(),
        protocol_version: None,
        use_binary_frame: None,
        negotiated_codec: None,
        negotiated_audio_format: None,
        negotiated_sample_rate: None,
        negotiated_channel_count: None,
    };
    
    match ack {
        SessionMessage::SessionInitAck { trace_id, .. } => {
            assert_eq!(trace_id, "trace-ack-123".to_string());
        }
        _ => panic!("消息类型不匹配"),
    }
}

