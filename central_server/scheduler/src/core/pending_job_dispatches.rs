//! 按 utterance_index 顺序派发 Job（仅 Utterance 消息路径）
//! 客户端可能乱序发送 Utterance(0), Utterance(2), Utterance(1)，此处缓冲后按序派发，避免节点端收到乱序。

use std::collections::{BTreeMap, HashMap};
use tokio::sync::Mutex;
use std::sync::Arc;

use crate::core::dispatcher::Job;

/// 按 session 缓冲待派发 job，按 utterance_index 顺序取出并派发
#[derive(Clone)]
pub struct PendingJobDispatches(
    Arc<Mutex<HashMap<String, (u64, BTreeMap<u64, Vec<Job>>)>>>,
);

impl PendingJobDispatches {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }

    /// 将一批 job 加入缓冲（同一 utterance_index 对应同一批）
    pub async fn add(&self, session_id: &str, utterance_index: u64, jobs: Vec<Job>) {
        let mut guard = self.0.lock().await;
        let entry = guard
            .entry(session_id.to_string())
            .or_insert_with(|| (0, BTreeMap::new()));
        entry.1.entry(utterance_index).or_default().extend(jobs);
    }

    /// 取出下一批待派发的 job（utterance_index == next_expected 的那批），若无可派发则返回 None
    pub async fn take_next(&self, session_id: &str) -> Option<(u64, Vec<Job>)> {
        let mut guard = self.0.lock().await;
        let (next_expected, pending) = guard.get_mut(session_id)?;
        let jobs = pending.remove(next_expected)?;
        let ui = *next_expected;
        *next_expected += 1;
        if pending.is_empty() {
            guard.remove(session_id);
        }
        Some((ui, jobs))
    }
}

impl Default for PendingJobDispatches {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::dispatcher::{Job, JobStatus};
    use crate::messages::PipelineConfig;

    fn make_job(utterance_index: u64) -> Job {
        Job {
            job_id: format!("test-job-{}", utterance_index),
            request_id: format!("test-req-{}", utterance_index),
            dispatched_to_node: false,
            dispatched_at_ms: None,
            failover_attempts: 0,
            dispatch_attempt_id: 1,
            session_id: "test-session".to_string(),
            utterance_index,
            src_lang: "zh".to_string(),
            tgt_lang: "en".to_string(),
            dialect: None,
            features: None,
            pipeline: PipelineConfig {
                use_asr: true,
                use_nmt: true,
                use_tts: true,
                use_semantic: false,
                use_tone: false,
            },
            audio_base64: String::new(),
            audio_format: "pcm16".to_string(),
            sample_rate: 16000,
            assigned_node_id: None,
            status: JobStatus::Pending,
            created_at: chrono::Utc::now(),
            trace_id: "test-trace".to_string(),
            mode: None,
            lang_a: None,
            lang_b: None,
            auto_langs: None,
            enable_streaming_asr: None,
            partial_update_interval_ms: None,
            target_session_ids: None,
            tenant_id: None,
            first_chunk_client_timestamp_ms: None,
            padding_ms: None,
            is_manual_cut: false,
            is_timeout_triggered: false,
            is_max_duration_triggered: false,
            turn_id: None,
            expected_duration_ms: None,
        }
    }

    #[tokio::test]
    async fn take_next_returns_in_utterance_index_order() {
        let p = PendingJobDispatches::new();
        // 乱序添加：先 2，再 0，再 1
        p.add("s1", 2, vec![make_job(2)]).await;
        p.add("s1", 0, vec![make_job(0)]).await;
        p.add("s1", 1, vec![make_job(1)]).await;

        let (ui0, batch0) = p.take_next("s1").await.unwrap();
        assert_eq!(ui0, 0);
        assert_eq!(batch0.len(), 1);
        assert_eq!(batch0[0].utterance_index, 0);

        let (ui1, batch1) = p.take_next("s1").await.unwrap();
        assert_eq!(ui1, 1);
        assert_eq!(batch1[0].utterance_index, 1);

        let (ui2, batch2) = p.take_next("s1").await.unwrap();
        assert_eq!(ui2, 2);
        assert_eq!(batch2[0].utterance_index, 2);

        assert!(p.take_next("s1").await.is_none());
    }
}
