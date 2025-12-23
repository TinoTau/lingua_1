//! GroupManager 单元测试

use lingua_scheduler::managers::{GroupManager, GroupConfig};

#[tokio::test]
async fn test_create_new_group() {
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_1";
    let now_ms = 1000;
    
    let group_id = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        now_ms,
    ).await.0;
    
    assert!(group_id.starts_with("group_test_session_1_"));
}

#[tokio::test]
async fn test_on_asr_final_same_group() {
    let config = GroupConfig {
        group_window_ms: 2000,
        max_parts_per_group: 10,
        max_context_length: 1000,
    };
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_2";
    let base_time = 1000;
    
    // 第一个 utterance
    let (group_id1, context1, part_index1) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        base_time,
    ).await;
    
    assert_eq!(part_index1, 0);
    assert!(context1.contains("Hello"));
    
    // 第二个 utterance（在窗口内）
    let (group_id2, context2, part_index2) = manager.on_asr_final(
        session_id,
        "trace_2",
        1,
        "World".to_string(),
        base_time + 500, // 500ms 后，在窗口内
    ).await;
    
    // 应该属于同一个 group
    assert_eq!(group_id1, group_id2);
    assert_eq!(part_index2, 1);
    assert!(context2.contains("Hello"));
    assert!(context2.contains("World"));
}

#[tokio::test]
async fn test_on_asr_final_new_group_window_exceeded() {
    let config = GroupConfig {
        group_window_ms: 2000,
        max_parts_per_group: 10,
        max_context_length: 1000,
    };
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_3";
    let base_time = 1000;
    
    // 第一个 utterance
    let (group_id1, _, _) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        base_time,
    ).await;
    
    // 更新 last_tts_end_at（模拟 TTS 播放结束）
    manager.on_tts_play_ended(&group_id1, base_time + 100).await;
    
    // 第二个 utterance（超出窗口）
    let (group_id2, context2, part_index2) = manager.on_asr_final(
        session_id,
        "trace_2",
        1,
        "World".to_string(),
        base_time + 100 + 2000 + 1, // 超出窗口
    ).await;
    
    // 应该创建新的 group
    assert_ne!(group_id1, group_id2);
    assert_eq!(part_index2, 0); // 新 group 的 part_index 从 0 开始
    assert!(!context2.contains("Hello")); // 新 group 不包含旧内容
    assert!(context2.contains("World"));
}

#[tokio::test]
async fn test_on_nmt_done() {
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_4";
    let now_ms = 1000;
    
    let (group_id, _, part_index) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        now_ms,
    ).await;
    
    // 更新 NMT 结果
    manager.on_nmt_done(
        &group_id,
        part_index,
        Some("你好".to_string()),
        None,
    ).await;
    
    // 验证：通过再次调用 on_asr_final 来检查 context 是否包含翻译结果
    let (_, context, _) = manager.on_asr_final(
        session_id,
        "trace_2",
        1,
        "World".to_string(),
        now_ms + 500,
    ).await;
    
    assert!(context.contains("你好")); // 应该包含翻译结果
}

#[tokio::test]
async fn test_on_tts_play_ended() {
    let config = GroupConfig {
        group_window_ms: 2000,
        max_parts_per_group: 10,
        max_context_length: 1000,
    };
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_5";
    let base_time = 1000;
    
    let (group_id, _, _) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        base_time,
    ).await;
    
    // 更新 TTS 播放结束时间
    let tts_end_ms = base_time + 500;
    manager.on_tts_play_ended(&group_id, tts_end_ms).await;
    
    // 在窗口内添加新的 utterance
    let (group_id2, _, _) = manager.on_asr_final(
        session_id,
        "trace_2",
        1,
        "World".to_string(),
        tts_end_ms + 1000, // 在窗口内（1000ms < 2000ms）
    ).await;
    
    // 应该属于同一个 group
    assert_eq!(group_id, group_id2);
    
    // 超出窗口
    let (group_id3, _, _) = manager.on_asr_final(
        session_id,
        "trace_3",
        2,
        "Test".to_string(),
        tts_end_ms + 2001, // 超出窗口
    ).await;
    
    // 应该创建新的 group
    assert_ne!(group_id, group_id3);
}

#[tokio::test]
async fn test_max_parts_per_group() {
    let config = GroupConfig {
        group_window_ms: 2000,
        max_parts_per_group: 3,
        max_context_length: 10000,
    };
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_6";
    let base_time = 1000;
    
    // 添加 5 个 parts（都在窗口内）
    let mut _group_id = String::new();
    for i in 0..5 {
        let (gid, _, _) = manager.on_asr_final(
            session_id,
            &format!("trace_{}", i),
            i,
            format!("Text {}", i),
            base_time + (i as u64) * 100,
        ).await;
        _group_id = gid;
    }
    
    // 获取最后一个 context，应该只包含最近的 3 个 parts（max_parts_per_group = 3）
    let (_, context, _) = manager.on_asr_final(
        session_id,
        "trace_5",
        5,
        "Text 5".to_string(),
        base_time + 500,
    ).await;
    
    // 由于 max_parts_per_group = 3，应该只包含最近的 3 个 parts
    // 应该不包含 "Text 0", "Text 1", "Text 2"（已被裁剪）
    assert!(!context.contains("Text 0"));
    assert!(!context.contains("Text 1"));
    assert!(!context.contains("Text 2"));
    // 应该包含 "Text 3", "Text 4", "Text 5"（最近的 3 个）
    assert!(context.contains("Text 3"));
    assert!(context.contains("Text 4"));
    assert!(context.contains("Text 5"));
}

#[tokio::test]
async fn test_max_context_length() {
    let config = GroupConfig {
        group_window_ms: 2000,
        max_parts_per_group: 10,
        max_context_length: 50, // 很小的长度限制
    };
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_7";
    let base_time = 1000;
    
    // 添加一个很长的文本
    let long_text = "A".repeat(100);
    let (_group_id, context, _) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        long_text.clone(),
        base_time,
    ).await;
    
    // context 应该被裁剪到 max_context_length（加上格式字符串的开销）
    assert!(context.len() <= 60); // 允许一些格式字符串的开销
    
    // 添加第二个文本
    let (_, context2, _) = manager.on_asr_final(
        session_id,
        "trace_2",
        1,
        "Short".to_string(),
        base_time + 500,
    ).await;
    
    // context2 应该被裁剪
    assert!(context2.len() <= 50);
}

#[tokio::test]
async fn test_on_session_end() {
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_8";
    let now_ms = 1000;
    
    // 创建一些 groups
    let (group_id1, _, _) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        now_ms,
    ).await;
    
    let (group_id2, _, _) = manager.on_asr_final(
        session_id,
        "trace_2",
        1,
        "World".to_string(),
        now_ms + 3000, // 创建新 group
    ).await;
    
    // 结束 session
    manager.on_session_end(session_id, "test_reason").await;
    
    // 验证：再次添加 utterance 应该创建新的 group（因为旧的已被清理）
    let (group_id3, _, part_index) = manager.on_asr_final(
        session_id,
        "trace_3",
        2,
        "Test".to_string(),
        now_ms + 6000,
    ).await;
    
    // 应该创建新的 group，part_index 从 0 开始
    assert_ne!(group_id1, group_id3);
    assert_ne!(group_id2, group_id3);
    assert_eq!(part_index, 0);
}

#[tokio::test]
async fn test_nmt_failure_still_in_group() {
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_9";
    let now_ms = 1000;
    
    let (group_id, _, part_index) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        now_ms,
    ).await;
    
    // NMT 失败（translated_text = None）
    manager.on_nmt_done(
        &group_id,
        part_index,
        None, // NMT 失败
        Some("NMT_TIMEOUT".to_string()),
    ).await;
    
    // 添加新的 utterance，应该仍然在同一个 group
    let (group_id2, context, part_index2) = manager.on_asr_final(
        session_id,
        "trace_2",
        1,
        "World".to_string(),
        now_ms + 500,
    ).await;
    
    assert_eq!(group_id, group_id2);
    assert_eq!(part_index2, 1); // part_index 应该递增，不回滚
    assert!(context.contains("Hello")); // 即使 NMT 失败，ASR 文本仍然在 context 中
}

#[tokio::test]
async fn test_multiple_sessions() {
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session1 = "session_1";
    let session2 = "session_2";
    let now_ms = 1000;
    
    // 为 session1 创建 group
    let (group_id1, _, _) = manager.on_asr_final(
        session1,
        "trace_1",
        0,
        "Hello".to_string(),
        now_ms,
    ).await;
    
    // 为 session2 创建 group
    let (group_id2, _, _) = manager.on_asr_final(
        session2,
        "trace_2",
        0,
        "World".to_string(),
        now_ms,
    ).await;
    
    // 两个 session 的 group 应该不同
    assert_ne!(group_id1, group_id2);
    
    // 结束 session1
    manager.on_session_end(session1, "test").await;
    
    // session2 的 group 应该仍然存在
    let (group_id2_2, _, _) = manager.on_asr_final(
        session2,
        "trace_3",
        1,
        "Test".to_string(),
        now_ms + 500,
    ).await;
    
    assert_eq!(group_id2, group_id2_2); // session2 的 group 应该保持不变
}

