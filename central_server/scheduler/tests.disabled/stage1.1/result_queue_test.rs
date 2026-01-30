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
        asr_quality_level: None, // OBS-2: ASR quality level
        reason_codes: None, // OBS-2: Reason codes
        quality_score: None, // OBS-2: Quality score
        rerun_count: None, // OBS-2: Rerun count
        segments_meta: None, // OBS-2: Segments metadata
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
    
    // 应该获取结果 0 和 2（先到先发，index=2 立即发送，不阻塞）
    let ready = manager.get_ready_results("session-4").await;
    assert_eq!(ready.len(), 2, "先到先发：index=0 和 index=2 都应该立即发送");
    
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[0] {
        assert_eq!(*utterance_index, 0);
    }
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[1] {
        assert_eq!(*utterance_index, 2);
    }
    
    // 添加结果 1 后，应该能够获取 1（index=2 已经在之前发送了）
    manager.add_result("session-4", 1, create_test_result("session-4", 1, "second")).await;
    
    let ready = manager.get_ready_results("session-4").await;
    assert_eq!(ready.len(), 1, "index=2 已经在之前发送了，现在只返回 index=1");
    
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready[0] {
        assert_eq!(*utterance_index, 1);
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

// ========== 新增测试：先到先发机制 ==========

/// 测试场景：后续结果立即发送，不阻塞（先到先发）
#[tokio::test]
async fn test_first_come_first_served() {
    let manager = ResultQueueManager::new();
    manager.initialize_session("session-fcfs".to_string()).await;
    
    // 1. 添加 index=10
    manager.add_result("session-fcfs", 10, create_test_result("session-fcfs", 10, "index-10")).await;
    
    // 2. 添加 index=12（跳过 index=11），应该立即发送，不阻塞
    manager.add_result("session-fcfs", 12, create_test_result("session-fcfs", 12, "index-12")).await;
    
    // 3. 添加 index=13，应该立即发送，不阻塞
    manager.add_result("session-fcfs", 13, create_test_result("session-fcfs", 13, "index-13")).await;
    
    // 4. 获取结果：应该立即返回 index=10, 12, 13（先到先发）
    let ready = manager.get_ready_results("session-fcfs").await;
    assert_eq!(ready.len(), 3, "应该立即返回3个结果（先到先发）");
    
    // 验证顺序：index=10 先到，然后是 12, 13
    if let SessionMessage::TranslationResult { utterance_index, text_asr, .. } = &ready[0] {
        assert_eq!(*utterance_index, 10);
        assert!(text_asr.contains("index-10"));
    }
    if let SessionMessage::TranslationResult { utterance_index, text_asr, .. } = &ready[1] {
        assert_eq!(*utterance_index, 12);
        assert!(text_asr.contains("index-12"));
    }
    if let SessionMessage::TranslationResult { utterance_index, text_asr, .. } = &ready[2] {
        assert_eq!(*utterance_index, 13);
        assert!(text_asr.contains("index-13"));
    }
}

/// 测试场景：补位成功的结果在已发送结果之后发送
#[tokio::test]
async fn test_acknowledgment_success_after_sent() {
    let manager = ResultQueueManager::new();
    manager.initialize_session("session-ack-success".to_string()).await;
    
    // 1. 添加 index=10
    manager.add_result("session-ack-success", 10, create_test_result("session-ack-success", 10, "index-10")).await;
    
    // 2. 添加 index=12（跳过 index=11），立即发送
    manager.add_result("session-ack-success", 12, create_test_result("session-ack-success", 12, "index-12")).await;
    
    // 3. 获取结果：应该返回 index=10, 12
    let ready1 = manager.get_ready_results("session-ack-success").await;
    assert_eq!(ready1.len(), 2);
    
    // 4. 在5秒内添加 index=11（补位成功），应该也发送，但在 index=12 之后
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await; // 模拟短暂延迟
    manager.add_result("session-ack-success", 11, create_test_result("session-ack-success", 11, "index-11")).await;
    
    // 5. 获取结果：应该返回 index=11（在 index=12 之后）
    let ready2 = manager.get_ready_results("session-ack-success").await;
    assert_eq!(ready2.len(), 1, "应该返回补位成功的 index=11");
    
    if let SessionMessage::TranslationResult { utterance_index, text_asr, .. } = &ready2[0] {
        assert_eq!(*utterance_index, 11);
        assert!(text_asr.contains("index-11"));
    }
}

/// 测试场景：补位超时后丢弃结果
#[tokio::test]
async fn test_acknowledgment_timeout_discard() {
    let manager = ResultQueueManager::new();
    manager.initialize_session("session-ack-timeout".to_string()).await;
    
    // 1. 添加 index=10
    manager.add_result("session-ack-timeout", 10, create_test_result("session-ack-timeout", 10, "index-10")).await;
    
    // 2. 添加 index=12（跳过 index=11），立即发送
    manager.add_result("session-ack-timeout", 12, create_test_result("session-ack-timeout", 12, "index-12")).await;
    
    // 3. 获取结果：应该返回 index=10, 12
    let ready1 = manager.get_ready_results("session-ack-timeout").await;
    assert_eq!(ready1.len(), 2);
    
    // 4. 等待超过5秒（补位超时）
    tokio::time::sleep(tokio::time::Duration::from_secs(6)).await;
    
    // 5. 尝试添加 index=11（超过5秒才到达），应该被丢弃
    manager.add_result("session-ack-timeout", 11, create_test_result("session-ack-timeout", 11, "index-11")).await;
    
    // 6. 获取结果：不应该返回 index=11（已被丢弃）
    let ready2 = manager.get_ready_results("session-ack-timeout").await;
    assert_eq!(ready2.len(), 0, "超时的结果应该被丢弃，不再发送");
    
    // 7. 验证 index=11 不在 pending 中
    // 注意：由于我们无法直接访问内部状态，我们通过再次添加 index=13 来验证
    manager.add_result("session-ack-timeout", 13, create_test_result("session-ack-timeout", 13, "index-13")).await;
    let ready3 = manager.get_ready_results("session-ack-timeout").await;
    assert_eq!(ready3.len(), 1, "应该返回 index=13");
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready3[0] {
        assert_eq!(*utterance_index, 13);
    }
}

/// 测试场景：补位超时后直接跳过（不创建 Missing result）
#[tokio::test]
async fn test_acknowledgment_timeout_skip() {
    let manager = ResultQueueManager::new();
    manager.initialize_session("session-ack-skip".to_string()).await;
    
    // 1. 添加 index=10
    manager.add_result("session-ack-skip", 10, create_test_result("session-ack-skip", 10, "index-10")).await;
    
    // 2. 添加 index=12（跳过 index=11），立即发送
    manager.add_result("session-ack-skip", 12, create_test_result("session-ack-skip", 12, "index-12")).await;
    
    // 3. 获取结果：应该返回 index=10, 12
    let ready1 = manager.get_ready_results("session-ack-skip").await;
    assert_eq!(ready1.len(), 2);
    
    // 4. 等待超过5秒（补位超时）
    tokio::time::sleep(tokio::time::Duration::from_secs(6)).await;
    
    // 5. 获取结果：应该跳过 index=11（不创建 Missing result）
    let _ready2 = manager.get_ready_results("session-ack-skip").await;
    // 注意：由于 index=11 已经超时，expected 应该已经跳过它
    // 但如果没有后续结果，ready2 可能为空
    // 我们通过添加 index=13 来验证 expected 已经跳过 index=11
    manager.add_result("session-ack-skip", 13, create_test_result("session-ack-skip", 13, "index-13")).await;
    let ready3 = manager.get_ready_results("session-ack-skip").await;
    assert_eq!(ready3.len(), 1, "应该返回 index=13，说明 expected 已经跳过 index=11");
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready3[0] {
        assert_eq!(*utterance_index, 13);
    }
}

/// 测试场景：多个补位窗口同时存在
#[tokio::test]
async fn test_multiple_acknowledgment_windows() {
    let manager = ResultQueueManager::new();
    manager.initialize_session("session-multi-ack".to_string()).await;
    
    // 1. 添加 index=10
    manager.add_result("session-multi-ack", 10, create_test_result("session-multi-ack", 10, "index-10")).await;
    
    // 2. 添加 index=13（跳过 index=11, 12），立即发送
    manager.add_result("session-multi-ack", 13, create_test_result("session-multi-ack", 13, "index-13")).await;
    
    // 3. 获取结果：应该返回 index=10, 13
    let ready1 = manager.get_ready_results("session-multi-ack").await;
    assert_eq!(ready1.len(), 2);
    
    // 4. 在5秒内添加 index=11（补位成功）
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    manager.add_result("session-multi-ack", 11, create_test_result("session-multi-ack", 11, "index-11")).await;
    
    // 5. 在5秒内添加 index=12（补位成功）
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    manager.add_result("session-multi-ack", 12, create_test_result("session-multi-ack", 12, "index-12")).await;
    
    // 6. 获取结果：应该返回 index=11, 12（在 index=13 之后）
    let ready2 = manager.get_ready_results("session-multi-ack").await;
    assert_eq!(ready2.len(), 2, "应该返回补位成功的 index=11, 12");
    
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready2[0] {
        assert_eq!(*utterance_index, 11);
    }
    if let SessionMessage::TranslationResult { utterance_index, .. } = &ready2[1] {
        assert_eq!(*utterance_index, 12);
    }
}

