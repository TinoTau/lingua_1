use crate::core::AppState;

/// 处理 Group 相关逻辑
/// 返回 (group_id, part_index)
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
            let (gid, _context, pidx) = state
                .group_manager
                .on_asr_final(session_id, trace_id, utterance_index, text_asr.clone(), now_ms)
                .await;

            // If translation result exists, update Group
            if let Some(ref text_translated) = text_translated {
                if !text_translated.is_empty() {
                    state
                        .group_manager
                        .on_nmt_done(&gid, pidx, Some(text_translated.clone()), None)
                        .await;
                }
            }

            (Some(gid), Some(pidx))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    }
}

