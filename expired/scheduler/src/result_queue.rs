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
}

// 会话结果队列管理器
#[derive(Clone)]
pub struct ResultQueueManager {
    // session_id -> (下一个期望的 utterance_index, 结果队列)
    queues: Arc<RwLock<HashMap<String, (u64, Vec<QueuedResult>)>>>,
}

impl ResultQueueManager {
    pub fn new() -> Self {
        Self {
            queues: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn initialize_session(&self, session_id: String) {
        let mut queues = self.queues.write().await;
        queues.insert(session_id, (0, Vec::new()));
    }

    pub async fn add_result(&self, session_id: &str, utterance_index: u64, result: SessionMessage) {
        let mut queues = self.queues.write().await;
        if let Some((_, queue)) = queues.get_mut(session_id) {
            queue.push(QueuedResult {
                utterance_index,
                result,
                received_at: chrono::Utc::now(),
            });
            // 按 utterance_index 排序
            queue.sort_by_key(|r| r.utterance_index);
        }
    }

    pub async fn get_ready_results(&self, session_id: &str) -> Vec<SessionMessage> {
        let mut queues = self.queues.write().await;
        if let Some((expected_index, queue)) = queues.get_mut(session_id) {
            let mut ready = Vec::new();
            
            // 从队列开头取出连续的结果
            while let Some(first) = queue.first() {
                if first.utterance_index == *expected_index {
                    let result = queue.remove(0);
                    ready.push(result.result);
                    *expected_index += 1;
                } else {
                    break;
                }
            }
            
            ready
        } else {
            Vec::new()
        }
    }

    pub async fn remove_session(&self, session_id: &str) {
        let mut queues = self.queues.write().await;
        queues.remove(session_id);
    }
}

