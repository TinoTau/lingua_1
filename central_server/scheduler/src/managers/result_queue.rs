use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::messages::SessionMessage;

// 结果队列项
#[derive(Debug, Clone)]
pub struct QueuedResult {
    pub utterance_index: u64,
    pub result: SessionMessage,
    #[allow(dead_code)]
    pub received_at: chrono::DateTime<chrono::Utc>,
    /// 结果截止时间（毫秒时间戳），超过此时间未到达则视为失败
    #[allow(dead_code)]
    pub deadline_ms: Option<i64>,
}

// 结果状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ResultStatus {
    /// 成功
    Success,
    /// 失败
    Failed,
    /// 超时/跳过
    Skipped,
}

// 会话结果队列管理器
#[derive(Clone)]
pub struct ResultQueueManager {
    // session_id -> (下一个期望的 utterance_index, 结果队列, 待处理索引的截止时间)
    queues: Arc<RwLock<HashMap<String, (u64, Vec<QueuedResult>, HashMap<u64, i64>)>>>,
    /// 结果超时时间（毫秒），默认 60 秒
    result_timeout_ms: i64,
}

impl ResultQueueManager {
    pub fn new() -> Self {
        Self {
            queues: Arc::new(RwLock::new(HashMap::new())),
            result_timeout_ms: 60 * 1000, // 默认 60 秒
        }
    }

    #[allow(dead_code)]
    pub fn new_with_timeout(timeout_seconds: u64) -> Self {
        Self {
            queues: Arc::new(RwLock::new(HashMap::new())),
            result_timeout_ms: (timeout_seconds * 1000) as i64,
        }
    }

    pub async fn initialize_session(&self, session_id: String) {
        let mut queues = self.queues.write().await;
        queues.insert(session_id, (0, Vec::new(), HashMap::new()));
    }

    /// 为指定的 utterance_index 设置截止时间
    pub async fn set_result_deadline(&self, session_id: &str, utterance_index: u64, deadline_ms: i64) {
        let mut queues = self.queues.write().await;
        if let Some((_, _, deadlines)) = queues.get_mut(session_id) {
            deadlines.insert(utterance_index, deadline_ms);
        }
    }

    pub async fn add_result(&self, session_id: &str, utterance_index: u64, result: SessionMessage) {
        let mut queues = self.queues.write().await;
        if let Some((_, queue, deadlines)) = queues.get_mut(session_id) {
            // 移除对应的 deadline（如果存在）
            deadlines.remove(&utterance_index);
            
            queue.push(QueuedResult {
                utterance_index,
                result,
                received_at: chrono::Utc::now(),
                deadline_ms: None, // 已到达，不需要 deadline
            });
            // 按 utterance_index 排序
            queue.sort_by_key(|r| r.utterance_index);
        }
    }

    pub async fn get_ready_results(&self, session_id: &str) -> Vec<SessionMessage> {
        use tracing::debug;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut queues = self.queues.write().await;
        if let Some((expected_index, queue, deadlines)) = queues.get_mut(session_id) {
            let mut ready = Vec::new();
            
            debug!(
                session_id = %session_id,
                expected_index = *expected_index,
                queue_size = queue.len(),
                queue_indices = ?queue.iter().map(|r| r.utterance_index).collect::<Vec<_>>(),
                "Checking ready results"
            );
            
            // 检查并处理超时的结果
            self.check_and_skip_timeout_results(session_id, expected_index, deadlines, now_ms, &mut ready);
            
            // 从队列开头取出连续的结果
            while let Some(first) = queue.first() {
                if first.utterance_index == *expected_index {
                    let result = queue.remove(0);
                    ready.push(result.result);
                    *expected_index += 1;
                } else {
                    debug!(
                        session_id = %session_id,
                        expected_index = *expected_index,
                        first_index = first.utterance_index,
                        "Waiting for expected index, breaking"
                    );
                    break;
                }
            }
            
            debug!(
                session_id = %session_id,
                ready_count = ready.len(),
                new_expected_index = *expected_index,
                remaining_queue_size = queue.len(),
                "Ready results extracted"
            );
            
            ready
        } else {
            Vec::new()
        }
    }

    /// 检查并跳过超时的结果
    fn check_and_skip_timeout_results(
        &self,
        session_id: &str,
        expected_index: &mut u64,
        deadlines: &mut HashMap<u64, i64>,
        now_ms: i64,
        ready: &mut Vec<SessionMessage>,
    ) {
        use tracing::warn;
        
        // 检查当前期望的 index 是否超时
        while let Some(&deadline_ms) = deadlines.get(expected_index) {
            if now_ms > deadline_ms {
                // 超时，生成失败结果并推进水位线
                warn!(
                    session_id = %session_id,
                    utterance_index = *expected_index,
                    deadline_ms = deadline_ms,
                    now_ms = now_ms,
                    "Result timeout, skipping utterance_index"
                );
                
                // 记录超时指标
                crate::metrics::on_result_gap_timeout();
                
                // 创建失败结果消息
                let error_result = SessionMessage::Error {
                    code: "RESULT_TIMEOUT".to_string(),
                    message: format!("Result for utterance_index {} timed out", expected_index),
                    details: Some(serde_json::json!({
                        "utterance_index": *expected_index,
                        "timeout_ms": self.result_timeout_ms,
                        "deadline_ms": deadline_ms
                    })),
                };
                ready.push(error_result);
                
                // 移除 deadline 并推进水位线
                deadlines.remove(expected_index);
                *expected_index += 1;
            } else {
                // 未超时，停止检查
                break;
            }
        }
    }

    /// 获取待处理的结果索引列表（用于监控）
    #[allow(dead_code)]
    pub async fn get_pending_indices(&self, session_id: &str) -> Vec<u64> {
        let queues = self.queues.read().await;
        if let Some((expected_index, queue, _)) = queues.get(session_id) {
            let mut pending = Vec::new();
            for i in *expected_index.. {
                // 检查队列中是否有这个 index
                if queue.iter().any(|r| r.utterance_index == i) {
                    pending.push(i);
                } else {
                    // 如果队列中没有，且队列不为空，检查是否已经跳过
                    if queue.is_empty() || queue.iter().all(|r| r.utterance_index > i) {
                        break;
                    }
                }
                // 限制检查范围（避免无限循环）
                if pending.len() > 100 {
                    break;
                }
            }
            pending
        } else {
            Vec::new()
        }
    }

    pub async fn remove_session(&self, session_id: &str) {
        let mut queues = self.queues.write().await;
        queues.remove(session_id);
    }
}

