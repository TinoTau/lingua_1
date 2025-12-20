// 会话管理单元测试

use lingua_scheduler::core::session::{SessionManager, SessionUpdate};
use lingua_scheduler::messages::FeatureFlags;

#[tokio::test]
async fn test_create_session() {
    let manager = SessionManager::new();
    
    let session = manager.create_session(
        "1.0.0".to_string(),
        "android".to_string(),
        "zh".to_string(),
        "en".to_string(),
        Some("cn".to_string()),
        Some(FeatureFlags {
            emotion_detection: Some(true),
            voice_style_detection: None,
            speech_rate_detection: None,
            speech_rate_control: None,
            speaker_identification: None,
            persona_adaptation: None,
        }),
        Some("tenant-1".to_string()),
        None,
        None,
        None,
        None,
        None,
    ).await;
    
    assert!(session.session_id.starts_with("s-"));
    assert_eq!(session.client_version, "1.0.0");
    assert_eq!(session.platform, "android");
    assert_eq!(session.src_lang, "zh");
    assert_eq!(session.tgt_lang, "en");
    assert_eq!(session.dialect, Some("cn".to_string()));
    assert_eq!(session.tenant_id, Some("tenant-1".to_string()));
    assert_eq!(session.utterance_index, 0);
    assert!(session.paired_node_id.is_none());
}

#[tokio::test]
async fn test_get_session() {
    let manager = SessionManager::new();
    
    let session = manager.create_session(
        "1.0.0".to_string(),
        "ios".to_string(),
        "en".to_string(),
        "zh".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ).await;
    
    let retrieved = manager.get_session(&session.session_id).await;
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.session_id, session.session_id);
    assert_eq!(retrieved.src_lang, "en");
    assert_eq!(retrieved.tgt_lang, "zh");
}

#[tokio::test]
async fn test_get_nonexistent_session() {
    let manager = SessionManager::new();
    
    let retrieved = manager.get_session("nonexistent").await;
    assert!(retrieved.is_none());
}

#[tokio::test]
async fn test_update_session_pair_node() {
    let manager = SessionManager::new();
    
    let session = manager.create_session(
        "1.0.0".to_string(),
        "web".to_string(),
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ).await;
    
    let success = manager.update_session(
        &session.session_id,
        SessionUpdate::PairNode("node-123".to_string()),
    ).await;
    
    assert!(success);
    
    let updated = manager.get_session(&session.session_id).await.unwrap();
    assert_eq!(updated.paired_node_id, Some("node-123".to_string()));
}

#[tokio::test]
async fn test_update_session_increment_utterance_index() {
    let manager = SessionManager::new();
    
    let session = manager.create_session(
        "1.0.0".to_string(),
        "android".to_string(),
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ).await;
    
    assert_eq!(session.utterance_index, 0);
    
    let success = manager.update_session(
        &session.session_id,
        SessionUpdate::IncrementUtteranceIndex,
    ).await;
    
    assert!(success);
    
    let updated = manager.get_session(&session.session_id).await.unwrap();
    assert_eq!(updated.utterance_index, 1);
    
    // 再次递增
    manager.update_session(
        &session.session_id,
        SessionUpdate::IncrementUtteranceIndex,
    ).await;
    
    let updated = manager.get_session(&session.session_id).await.unwrap();
    assert_eq!(updated.utterance_index, 2);
}

#[tokio::test]
async fn test_update_nonexistent_session() {
    let manager = SessionManager::new();
    
    let success = manager.update_session(
        "nonexistent",
        SessionUpdate::PairNode("node-123".to_string()),
    ).await;
    
    assert!(!success);
}

#[tokio::test]
async fn test_remove_session() {
    let manager = SessionManager::new();
    
    let session = manager.create_session(
        "1.0.0".to_string(),
        "ios".to_string(),
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ).await;
    
    manager.remove_session(&session.session_id).await;
    
    let retrieved = manager.get_session(&session.session_id).await;
    assert!(retrieved.is_none());
}

#[tokio::test]
async fn test_multiple_sessions() {
    let manager = SessionManager::new();
    
    let session1 = manager.create_session(
        "1.0.0".to_string(),
        "android".to_string(),
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ).await;
    
    let session2 = manager.create_session(
        "1.0.0".to_string(),
        "ios".to_string(),
        "en".to_string(),
        "zh".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ).await;
    
    assert_ne!(session1.session_id, session2.session_id);
    
    let retrieved1 = manager.get_session(&session1.session_id).await;
    let retrieved2 = manager.get_session(&session2.session_id).await;
    
    assert!(retrieved1.is_some());
    assert!(retrieved2.is_some());
    assert_eq!(retrieved1.unwrap().src_lang, "zh");
    assert_eq!(retrieved2.unwrap().src_lang, "en");
}

