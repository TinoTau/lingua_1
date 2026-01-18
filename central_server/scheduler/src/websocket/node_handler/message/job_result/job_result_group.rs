use crate::core::AppState;

/// 处理 Group 相关逻辑
/// 返回 (group_id, part_index)
/// 修复8: 使用批量处理方法，在一次写锁内完成 ASR 和 NMT 操作
pub(crate) async fn process_group_for_job_result(
    state: &AppState,
    session_id: &str,
    trace_id: &str,
    utterance_index: u64,
    text_asr: &Option<String>,
    text_translated: &Option<String>,
) -> (Option<String>, Option<u64>) {
    // Utterance Group processing: when receiving JobResult, if ASR result exists, call GroupManager
    if let Some(ref text_asr) = text_asr {
        if !text_asr.is_empty() {
            let now_ms = chrono::Utc::now().timestamp_millis() as u64;
            // 修复8: 使用批量处理方法，在一次写锁内完成 ASR 和 NMT 操作
            let translated_text = text_translated.as_ref()
                .filter(|t| !t.is_empty())
                .map(|t| t.clone());
            
            let (gid, _context, pidx) = state
                .group_manager
                .on_asr_final_and_nmt_done(
                    session_id,
                    trace_id,
                    utterance_index,
                    text_asr.clone(),
                    translated_text,
                    now_ms,
                )
                .await;

            (Some(gid), Some(pidx))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    }
}

