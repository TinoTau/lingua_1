// 结果队列单元测试

use lingua_scheduler::managers::ResultQueueManager;
use lingua_scheduler::messages::SessionMessage;

fn create_test_result(session_id: &str, utterance_index: u64, text: &str) -> SessionMessage {
    SessionMessage::TranslationResult {
        session_id: session_id.to_string(),
        utterance_index,
        job_id: format!("job-{}", utterance_index),
        text_asr: format!("ASR: {}", text),
        text_translated: format!("Translated: {}", text),
        tts_audio: "base64audio".to_string(),
        tts_format: "pcm16".to_string(),
        extra: None,
        trace_id: format!("trace-{}", utterance_index),
        group_id: None, // Added for Utterance Group
        part_index: None, // Added for Utterance Group
        service_timings: None, // Service timings
        network_timings: None,
        scheduler_sent_at_ms: None,
    }
}

#[tokio::test]
async fn test_initialize_session() {
    let manager = ResultQueueManager::new();
    
    manager.initialize_session("session-1".to_string()).await;
    
    // 初始化后，应该能够添加结果
    let result = create_test_result("session-1", 0, "test");
    manager.add_result("session-1", 0, result).await;
    
    let ready = manager.get_ready_results("session-1").await;
    assert_eq!(ready.len(), 1);
}

#[tokio::test]
async fn test_add_result_in_order() {
    let manager = ResultQueueManager::new();
    
    manager.initialize_session("session-2".to_string()).await;
    
    // 按顺序添加结果
    manager.add_result("session-2", 0, create_test_result("session-2", 0, "first")).await;
    manager.add_result("session-2", 1, create_test_result("session-2", 1, "second")).await;
    manager.add_result("session-2", 2, create_test_result("session-2", 2, "third")).await;
    
    // 应该能够按顺序获取所有结果
    let ready = manager.get_ready_results("session-2").await;
    assert_eq!(ready.len(), 3);
    
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[0] {
        assert_eq!(*utterance_index, 0);
    }
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[1] {
        assert_eq!(*utterance_index, 1);
    }
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[2] {
        assert_eq!(*utterance_index, 2);
    }
}

#[tokio::test]
async fn test_add_result_out_of_order() {
    let manager = ResultQueueManager::new();
    
    manager.initialize_session("session-3".to_string()).await;
    
    // 乱序添加结果
    manager.add_result("session-3", 2, create_test_result("session-3", 2, "third")).await;
    manager.add_result("session-3", 0, create_test_result("session-3", 0, "first")).await;
    manager.add_result("session-3", 1, create_test_result("session-3", 1, "second")).await;
    
    // 应该能够按顺序获取所有结果
    let ready = manager.get_ready_results("session-3").await;
    assert_eq!(ready.len(), 3);
    
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[0] {
        assert_eq!(*utterance_index, 0);
    }
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[1] {
        assert_eq!(*utterance_index, 1);
    }
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[2] {
        assert_eq!(*utterance_index, 2);
    }
}

#[tokio::test]
async fn test_get_ready_results_partial() {
    let manager = ResultQueueManager::new();
    
    manager.initialize_session("session-4".to_string()).await;
    
    // 添加结果 0 和 2，缺少 1
    manager.add_result("session-4", 0, create_test_result("session-4", 0, "first")).await;
    manager.add_result("session-4", 2, create_test_result("session-4", 2, "third")).await;
    
    // 应该只能获取结果 0（因为缺少 1）
    let ready = manager.get_ready_results("session-4").await;
    assert_eq!(ready.len(), 1);
    
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[0] {
        assert_eq!(*utterance_index, 0);
    }
    
    // 添加结果 1 后，应该能够获取 1 和 2
    manager.add_result("session-4", 1, create_test_result("session-4", 1, "second")).await;
    
    let ready = manager.get_ready_results("session-4").await;
    assert_eq!(ready.len(), 2);
    
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[0] {
        assert_eq!(*utterance_index, 1);
    }
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[1] {
        assert_eq!(*utterance_index, 2);
    }
}

#[tokio::test]
async fn test_get_ready_results_empty() {
    let manager = ResultQueueManager::new();
    
    manager.initialize_session("session-5".to_string()).await;
    
    let ready = manager.get_ready_results("session-5").await;
    assert_eq!(ready.len(), 0);
}

#[tokio::test]
async fn test_remove_session() {
    let manager = ResultQueueManager::new();
    
    manager.initialize_session("session-6".to_string()).await;
    manager.add_result("session-6", 0, create_test_result("session-6", 0, "test")).await;
    
    manager.remove_session("session-6").await;
    
    // 移除后，应该无法获取结果
    let ready = manager.get_ready_results("session-6").await;
    assert_eq!(ready.len(), 0);
}

#[tokio::test]
async fn test_multiple_sessions() {
    let manager = ResultQueueManager::new();
    
    manager.initialize_session("session-7".to_string()).await;
    manager.initialize_session("session-8".to_string()).await;
    
    manager.add_result("session-7", 0, create_test_result("session-7", 0, "test1")).await;
    manager.add_result("session-8", 0, create_test_result("session-8", 0, "test2")).await;
    
    let ready7 = manager.get_ready_results("session-7").await;
    let ready8 = manager.get_ready_results("session-8").await;
    
    assert_eq!(ready7.len(), 1);
    assert_eq!(ready8.len(), 1);
    
    if let SessionMessage::TranslationResult { session_id, .. } = &ready7[0] {
        assert_eq!(session_id, "session-7");
    }
    if let SessionMessage::TranslationResult { session_id, .. } = &ready8[0] {
        assert_eq!(session_id, "session-8");
    }
}

