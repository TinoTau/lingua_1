//! Restart 流程单元测试
//! 验证播放完成后 RestartTimer 和音频 chunk 的处理逻辑

#[cfg(test)]
mod tests {
    use crate::managers::AudioBufferManager;

    #[tokio::test]
    async fn test_restart_timer_updates_last_chunk_at_ms() {
        let audio_buffer = AudioBufferManager::new();
        let session_id = "test-session";

        // 初始状态：没有 last_chunk_at_ms
        let initial_last_chunk_at = audio_buffer.get_last_chunk_at_ms(session_id).await;
        assert!(initial_last_chunk_at.is_none(), "初始状态应该没有 last_chunk_at_ms");

        // 模拟 RestartTimer 事件
        let restart_timestamp = 1000i64;
        audio_buffer.update_last_chunk_at_ms(session_id, restart_timestamp).await;

        // 验证 last_chunk_at_ms 已更新
        let updated_last_chunk_at = audio_buffer.get_last_chunk_at_ms(session_id).await;
        assert_eq!(updated_last_chunk_at, Some(restart_timestamp), "RestartTimer 应该更新 last_chunk_at_ms");
    }

    #[tokio::test]
    async fn test_first_chunk_after_restart_does_not_trigger_pause_finalize() {
        let audio_buffer = AudioBufferManager::new();
        let session_id = "test-session";

        // 1. RestartTimer 更新 last_chunk_at_ms
        let restart_timestamp = 1000i64;
        audio_buffer.update_last_chunk_at_ms(session_id, restart_timestamp).await;

        // 2. 500ms 后第一批 chunk 到达（模拟 Web 端延迟）
        let first_chunk_timestamp = restart_timestamp + 500; // 500ms 后
        let pause_exceeded = audio_buffer.record_chunk_and_check_pause(session_id, first_chunk_timestamp, 3000).await;

        // 3. 验证不会触发 pause finalize（时间差只有 500ms，远小于 3秒）
        assert!(!pause_exceeded, "第一批 chunk 在 500ms 后到达，不应该触发 pause finalize");

        // 4. 验证 last_chunk_at_ms 已更新为第一批 chunk 的时间戳
        let updated_last_chunk_at = audio_buffer.get_last_chunk_at_ms(session_id).await;
        assert_eq!(updated_last_chunk_at, Some(first_chunk_timestamp), "第一批 chunk 应该更新 last_chunk_at_ms");
    }

    #[tokio::test]
    async fn test_continuous_speech_does_not_trigger_pause_finalize() {
        let audio_buffer = AudioBufferManager::new();
        let session_id = "test-session";

        // 1. RestartTimer 更新 last_chunk_at_ms
        let restart_timestamp = 1000i64;
        audio_buffer.update_last_chunk_at_ms(session_id, restart_timestamp).await;

        // 2. 第一批 chunk 到达
        let mut current_timestamp = restart_timestamp + 500;
        let pause_exceeded_1 = audio_buffer.record_chunk_and_check_pause(session_id, current_timestamp, 3000).await;
        assert!(!pause_exceeded_1, "第一批 chunk 不应该触发 pause finalize");

        // 3. 模拟用户持续说话：每 100ms 发送一个 chunk（远小于 3秒阈值）
        for i in 1..=10 {
            current_timestamp += 100; // 每 100ms 一个 chunk
            let pause_exceeded = audio_buffer.record_chunk_and_check_pause(session_id, current_timestamp, 3000).await;
            assert!(!pause_exceeded, "第 {} 个 chunk 在持续说话时不应该触发 pause finalize", i);
        }

        // 4. 验证 last_chunk_at_ms 已更新为最后一个 chunk 的时间戳
        let final_last_chunk_at = audio_buffer.get_last_chunk_at_ms(session_id).await;
        assert_eq!(final_last_chunk_at, Some(current_timestamp), "最后一个 chunk 应该更新 last_chunk_at_ms");
    }

    #[tokio::test]
    async fn test_pause_finalize_triggered_after_3_seconds_silence() {
        let audio_buffer = AudioBufferManager::new();
        let session_id = "test-session";

        // 1. RestartTimer 更新 last_chunk_at_ms
        let restart_timestamp = 1000i64;
        audio_buffer.update_last_chunk_at_ms(session_id, restart_timestamp).await;

        // 2. 第一批 chunk 到达
        let first_chunk_timestamp = restart_timestamp + 500;
        let pause_exceeded_1 = audio_buffer.record_chunk_and_check_pause(session_id, first_chunk_timestamp, 3000).await;
        assert!(!pause_exceeded_1, "第一批 chunk 不应该触发 pause finalize");

        // 3. 用户停止说话，超过 3 秒后下一个 chunk 到达
        let silence_chunk_timestamp = first_chunk_timestamp + 3100; // 3.1 秒后（超过 3秒阈值）
        let pause_exceeded_2 = audio_buffer.record_chunk_and_check_pause(session_id, silence_chunk_timestamp, 3000).await;

        // 4. 验证会触发 pause finalize
        assert!(pause_exceeded_2, "用户停止说话超过 3 秒后，应该触发 pause finalize");
    }

    #[tokio::test]
    async fn test_restart_timer_before_chunk_prevents_premature_finalize() {
        let audio_buffer = AudioBufferManager::new();
        let session_id = "test-session";

        // 场景：上一个 utterance 的最后一个 chunk 在时间戳 1000
        let last_utterance_chunk_timestamp = 1000i64;
        audio_buffer.record_chunk_and_check_pause(session_id, last_utterance_chunk_timestamp, 3000).await;

        // 模拟播放完成，RestartTimer 到达（在时间戳 5000）
        let restart_timestamp = 5000i64;
        audio_buffer.update_last_chunk_at_ms(session_id, restart_timestamp).await;

        // 500ms 后第一批 chunk 到达（在时间戳 5500）
        let first_chunk_timestamp = restart_timestamp + 500;
        let pause_exceeded = audio_buffer.record_chunk_and_check_pause(session_id, first_chunk_timestamp, 3000).await;

        // 验证不会触发 pause finalize
        // 因为 RestartTimer 更新了 last_chunk_at_ms，所以时间差是 500ms，而不是 4500ms
        assert!(!pause_exceeded, "RestartTimer 先到达后，第一批 chunk 不应该触发 pause finalize");
    }

    #[tokio::test]
    async fn test_chunk_before_restart_timer_triggers_premature_finalize() {
        let audio_buffer = AudioBufferManager::new();
        let session_id = "test-session";

        // 场景：上一个 utterance 的最后一个 chunk 在时间戳 1000
        let last_utterance_chunk_timestamp = 1000i64;
        audio_buffer.record_chunk_and_check_pause(session_id, last_utterance_chunk_timestamp, 3000).await;

        // 如果音频 chunk 在 RestartTimer 之前到达（在时间戳 4500，距离上一个 chunk 3.5秒）
        let premature_chunk_timestamp = last_utterance_chunk_timestamp + 3500; // 3.5 秒后
        let pause_exceeded = audio_buffer.record_chunk_and_check_pause(session_id, premature_chunk_timestamp, 3000).await;

        // 验证会触发 pause finalize（因为 RestartTimer 还没到达，时间差是 3.5秒，超过 3秒阈值）
        assert!(pause_exceeded, "如果音频 chunk 在 RestartTimer 之前到达，应该触发 pause finalize");
    }
}
