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
async fn test_on_tts_started() {
    let config = GroupConfig {
        group_window_ms: 2000,
        max_parts_per_group: 10,
        max_context_length: 1000,
    };
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_tts_started";
    let base_time = 1000;
    
    // 创建 group
    let (group_id, _, _) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        base_time,
    ).await;
    
    // 记录 TTS 播放开始时间
    let tts_start_ms = base_time + 100;
    manager.on_tts_started(&group_id, tts_start_ms).await;
    
    // 先设置播放结束时间，然后才能判断播放期间
    let tts_end_ms = tts_start_ms + 5000; // 播放时长 5 秒
    manager.on_tts_play_ended(&group_id, tts_end_ms).await;
    
    // 在播放期间（在 start 和 end 之间），is_tts_playing 应该返回 true
    assert!(manager.is_tts_playing(&group_id, (tts_start_ms + 2000) as i64).await);
    
    // 在播放开始之前，应该返回 false
    assert!(!manager.is_tts_playing(&group_id, (tts_start_ms - 100) as i64).await);
    
    // 在播放结束之后，应该返回 false
    assert!(!manager.is_tts_playing(&group_id, (tts_end_ms + 100) as i64).await);
}

#[tokio::test]
async fn test_is_tts_playing() {
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_is_tts_playing";
    let base_time = 1000;
    
    // 创建 group
    let (group_id, _, _) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        base_time,
    ).await;
    
    // 没有设置播放开始时间时，应该返回 false
    assert!(!manager.is_tts_playing(&group_id, (base_time + 1000) as i64).await);
    
    // 设置 TTS 播放开始和结束时间
    let tts_start_ms = base_time + 500;
    let tts_end_ms = base_time + 5000;
    
    manager.on_tts_started(&group_id, tts_start_ms).await;
    manager.on_tts_play_ended(&group_id, tts_end_ms).await;
    
    // 测试边界情况
    assert!(!manager.is_tts_playing(&group_id, (tts_start_ms - 1) as i64).await, "播放开始之前应该返回 false");
    assert!(manager.is_tts_playing(&group_id, tts_start_ms as i64).await, "播放开始时应该返回 true");
    assert!(manager.is_tts_playing(&group_id, (tts_start_ms + 1000) as i64).await, "播放期间应该返回 true");
    assert!(manager.is_tts_playing(&group_id, tts_end_ms as i64).await, "播放结束时应该返回 true");
    assert!(!manager.is_tts_playing(&group_id, (tts_end_ms + 1) as i64).await, "播放结束后应该返回 false");
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
async fn test_tts_started_and_ended_sequence() {
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_tts_sequence";
    let base_time = 1000;
    
    // 创建 group
    let (group_id, _, _) = manager.on_asr_final(
        session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        base_time,
    ).await;
    
    // 模拟完整的 TTS 播放流程：开始 -> 播放期间 -> 结束
    let tts_start_ms = base_time + 200;
    let tts_duration_ms = 5000;
    let tts_end_ms = tts_start_ms + tts_duration_ms;
    
    // 1. TTS 播放开始
    manager.on_tts_started(&group_id, tts_start_ms).await;
    
    // 2. TTS 播放结束（必须先设置end_at，才能判断播放期间）
    manager.on_tts_play_ended(&group_id, tts_end_ms).await;
    
    // 3. 在播放期间，is_tts_playing 应该返回 true
    assert!(manager.is_tts_playing(&group_id, (tts_start_ms + 1000) as i64).await);
    assert!(manager.is_tts_playing(&group_id, (tts_start_ms + 2500) as i64).await);
    assert!(manager.is_tts_playing(&group_id, (tts_start_ms + 4000) as i64).await);
    
    // 4. 播放结束后，is_tts_playing 应该返回 false
    assert!(!manager.is_tts_playing(&group_id, (tts_end_ms + 100) as i64).await);
    assert!(!manager.is_tts_playing(&group_id, (tts_end_ms + 1000) as i64).await);
    
    // 5. 验证边界情况
    assert!(manager.is_tts_playing(&group_id, tts_start_ms as i64).await, "播放开始时应该返回 true");
    assert!(manager.is_tts_playing(&group_id, tts_end_ms as i64).await, "播放结束时应该返回 true");
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

#[tokio::test]
async fn test_session_groups_index_consistency() {
    // 测试 session_groups 索引与 groups 的一致性
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_index";
    let now_ms = 1000;
    
    // 创建多个 groups（通过窗口超时）
    let mut group_ids = Vec::new();
    for i in 0..5 {
        let (gid, _, _) = manager.on_asr_final(
            session_id,
            &format!("trace_{}", i),
            i,
            format!("Text {}", i),
            now_ms + (i as u64) * 3000, // 每个间隔 3 秒，确保创建新 group
        ).await;
        group_ids.push(gid);
    }
    
    // 验证：所有 group 都应该在 session_groups 索引中
    // 通过 on_session_end 清理，然后验证所有 group 都被删除
    manager.on_session_end(session_id, "test").await;
    
    // 验证：再次创建 group 时，part_index 应该从 0 开始（说明旧的都被清理了）
    let (new_gid, _, part_index) = manager.on_asr_final(
        session_id,
        "trace_new",
        0,
        "New Text".to_string(),
        now_ms + 20000,
    ).await;
    
    assert_eq!(part_index, 0); // 新 group 的 part_index 从 0 开始
    assert!(!group_ids.contains(&new_gid)); // 新 group_id 不应该在旧的列表中
}

#[tokio::test]
async fn test_on_session_end_with_many_groups() {
    // 测试 on_session_end 在大量 groups 情况下的性能
    // 这个测试主要验证索引优化是否生效（不会因为全表扫描而阻塞）
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_many_groups";
    let now_ms = 1000;
    
    // 创建 20 个 groups
    let mut group_ids = Vec::new();
    for i in 0..20 {
        let (gid, _, _) = manager.on_asr_final(
            session_id,
            &format!("trace_{}", i),
            i,
            format!("Text {}", i),
            now_ms + (i as u64) * 3000, // 每个间隔 3 秒
        ).await;
        group_ids.push(gid);
    }
    
    // 结束 session（应该快速完成，不会因为全表扫描而阻塞）
    let start = std::time::Instant::now();
    manager.on_session_end(session_id, "test").await;
    let elapsed = start.elapsed();
    
    // 验证：应该在毫秒级完成（而不是秒级）
    assert!(elapsed.as_millis() < 100, "on_session_end 应该在 100ms 内完成，实际: {}ms", elapsed.as_millis());
    
    // 验证：所有 groups 都被清理
    let (new_gid, _, part_index) = manager.on_asr_final(
        session_id,
        "trace_new",
        0,
        "New Text".to_string(),
        now_ms + 70000,
    ).await;
    
    assert_eq!(part_index, 0);
    assert!(!group_ids.contains(&new_gid));
}

#[tokio::test]
async fn test_concurrent_session_end() {
    // 测试并发 session_end 的安全性
    use tokio::task;
    
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    // 创建多个 session，每个 session 有多个 groups
    let session_count = 5;
    let groups_per_session = 3;
    
    let mut handles = Vec::new();
    
    for session_idx in 0..session_count {
        let manager_clone = manager.clone();
        let session_id = format!("session_{}", session_idx);
        let now_ms = 1000 + (session_idx as u64) * 10000;
        
        // 为每个 session 创建多个 groups
        for group_idx in 0..groups_per_session {
            let manager_clone2 = manager_clone.clone();
            let session_id_clone = session_id.clone();
            let handle = task::spawn(async move {
                manager_clone2.on_asr_final(
                    &session_id_clone,
                    &format!("trace_{}_{}", session_idx, group_idx),
                    group_idx,
                    format!("Text {}_{}", session_idx, group_idx),
                    now_ms + (group_idx as u64) * 3000,
                ).await.0
            });
            handles.push(handle);
        }
    }
    
    // 等待所有 groups 创建完成
    let _group_ids: Vec<_> = futures_util::future::join_all(handles).await
        .into_iter()
        .map(|r| r.unwrap())
        .collect();
    
    // 并发结束所有 session
    let mut end_handles = Vec::new();
    for session_idx in 0..session_count {
        let manager_clone = manager.clone();
        let session_id = format!("session_{}", session_idx);
        let handle = task::spawn(async move {
            manager_clone.on_session_end(&session_id, "concurrent_test").await;
        });
        end_handles.push(handle);
    }
    
    // 等待所有 session_end 完成（不应该有 panic 或死锁）
    let results: Vec<_> = futures_util::future::join_all(end_handles).await;
    for result in results {
        result.expect("session_end 不应该 panic");
    }
    
    // 验证：所有 session 的 groups 都被清理
    for session_idx in 0..session_count {
        let session_id = format!("session_{}", session_idx);
        let (_, _, part_index) = manager.on_asr_final(
            &session_id,
            "trace_new",
            0,
            "New Text".to_string(),
            100000 + (session_idx as u64) * 1000,
        ).await;
        
        assert_eq!(part_index, 0, "session {} 的 groups 应该被清理", session_idx);
    }
}

#[tokio::test]
async fn test_index_consistency_after_multiple_operations() {
    // 测试多次操作后索引的一致性
    let config = GroupConfig::default();
    let manager = GroupManager::new(config);
    
    let session_id = "test_session_consistency";
    let now_ms = 1000;
    
    // 创建多个 groups
    let mut group_ids = Vec::new();
    for i in 0..10 {
        let (gid, _, _) = manager.on_asr_final(
            session_id,
            &format!("trace_{}", i),
            i,
            format!("Text {}", i),
            now_ms + (i as u64) * 3000,
        ).await;
        group_ids.push(gid);
    }
    
    // 结束 session（应该清理所有 groups）
    manager.on_session_end(session_id, "test").await;
    
    // 再次创建 groups
    let mut new_group_ids = Vec::new();
    for i in 0..5 {
        let (gid, _, _) = manager.on_asr_final(
            session_id,
            &format!("trace_new_{}", i),
            i,
            format!("New Text {}", i),
            now_ms + 50000 + (i as u64) * 3000,
        ).await;
        new_group_ids.push(gid);
    }
    
    // 再次结束 session
    manager.on_session_end(session_id, "test2").await;
    
    // 验证：再次创建时，part_index 应该从 0 开始
    let (final_gid, _, part_index) = manager.on_asr_final(
        session_id,
        "trace_final",
        0,
        "Final Text".to_string(),
        now_ms + 100000,
    ).await;
    
    assert_eq!(part_index, 0);
    assert!(!group_ids.contains(&final_gid));
    assert!(!new_group_ids.contains(&final_gid));
}
