// 音频缓冲区管理器测试
// 测试流式音频块的累积和管理功能

use lingua_scheduler::audio_buffer::AudioBufferManager;

#[tokio::test]
async fn test_audio_buffer_add_and_take() {
    let manager = AudioBufferManager::new();
    let session_id = "test-session-1";
    let utterance_index = 0u64;

    // 添加多个音频块
    let chunk1 = vec![1u8, 2u8, 3u8];
    let chunk2 = vec![4u8, 5u8, 6u8];
    let chunk3 = vec![7u8, 8u8, 9u8];

    manager.add_chunk(session_id, utterance_index, chunk1).await;
    manager.add_chunk(session_id, utterance_index, chunk2).await;
    manager.add_chunk(session_id, utterance_index, chunk3).await;

    // 获取累积的音频数据
    let combined = manager.take_combined(session_id, utterance_index).await;
    assert!(combined.is_some());
    let combined_data = combined.unwrap();
    
    // 验证数据正确累积
    assert_eq!(combined_data, vec![1u8, 2u8, 3u8, 4u8, 5u8, 6u8, 7u8, 8u8, 9u8]);
}

#[tokio::test]
async fn test_audio_buffer_take_clears_buffer() {
    let manager = AudioBufferManager::new();
    let session_id = "test-session-2";
    let utterance_index = 0u64;

    // 添加音频块
    manager.add_chunk(session_id, utterance_index, vec![1u8, 2u8]).await;

    // 获取并清空
    let first_take = manager.take_combined(session_id, utterance_index).await;
    assert!(first_take.is_some());

    // 再次获取应该返回 None（已清空）
    let second_take = manager.take_combined(session_id, utterance_index).await;
    assert!(second_take.is_none());
}

#[tokio::test]
async fn test_audio_buffer_multiple_sessions() {
    let manager = AudioBufferManager::new();
    let session1 = "session-1";
    let session2 = "session-2";
    let utterance_index = 0u64;

    // 为不同会话添加音频块
    manager.add_chunk(session1, utterance_index, vec![1u8, 2u8]).await;
    manager.add_chunk(session2, utterance_index, vec![3u8, 4u8]).await;

    // 验证每个会话的数据独立
    let data1 = manager.take_combined(session1, utterance_index).await.unwrap();
    let data2 = manager.take_combined(session2, utterance_index).await.unwrap();

    assert_eq!(data1, vec![1u8, 2u8]);
    assert_eq!(data2, vec![3u8, 4u8]);
}

#[tokio::test]
async fn test_audio_buffer_multiple_utterances() {
    let manager = AudioBufferManager::new();
    let session_id = "test-session-3";
    let utterance1 = 0u64;
    let utterance2 = 1u64;

    // 为不同 utterance 添加音频块
    manager.add_chunk(session_id, utterance1, vec![1u8, 2u8]).await;
    manager.add_chunk(session_id, utterance2, vec![3u8, 4u8]).await;

    // 验证每个 utterance 的数据独立
    let data1 = manager.take_combined(session_id, utterance1).await.unwrap();
    let data2 = manager.take_combined(session_id, utterance2).await.unwrap();

    assert_eq!(data1, vec![1u8, 2u8]);
    assert_eq!(data2, vec![3u8, 4u8]);
}

#[tokio::test]
async fn test_audio_buffer_clear_all_for_session() {
    let manager = AudioBufferManager::new();
    let session_id = "test-session-4";
    let utterance1 = 0u64;
    let utterance2 = 1u64;

    // 添加音频块
    manager.add_chunk(session_id, utterance1, vec![1u8, 2u8]).await;
    manager.add_chunk(session_id, utterance2, vec![3u8, 4u8]).await;

    // 清空整个会话的缓冲区
    manager.clear_all_for_session(session_id).await;

    // 验证所有 utterance 的数据都被清空
    assert!(manager.take_combined(session_id, utterance1).await.is_none());
    assert!(manager.take_combined(session_id, utterance2).await.is_none());
}

#[tokio::test]
async fn test_audio_buffer_empty_chunk() {
    let manager = AudioBufferManager::new();
    let session_id = "test-session-5";
    let utterance_index = 0u64;

    // 添加空音频块
    manager.add_chunk(session_id, utterance_index, vec![]).await;

    // 获取累积数据
    let combined = manager.take_combined(session_id, utterance_index).await;
    assert!(combined.is_some());
    assert_eq!(combined.unwrap(), Vec::<u8>::new());
}

#[tokio::test]
async fn test_audio_buffer_large_chunks() {
    let manager = AudioBufferManager::new();
    let session_id = "test-session-6";
    let utterance_index = 0u64;

    // 添加大块音频数据
    let large_chunk1: Vec<u8> = (0..1000).map(|i| (i % 256) as u8).collect();
    let large_chunk2: Vec<u8> = (1000..2000).map(|i| (i % 256) as u8).collect();

    manager.add_chunk(session_id, utterance_index, large_chunk1.clone()).await;
    manager.add_chunk(session_id, utterance_index, large_chunk2.clone()).await;

    // 获取累积数据
    let combined = manager.take_combined(session_id, utterance_index).await.unwrap();
    
    // 验证数据正确累积
    assert_eq!(combined.len(), 2000);
    assert_eq!(&combined[0..1000], &large_chunk1[..]);
    assert_eq!(&combined[1000..2000], &large_chunk2[..]);
}

