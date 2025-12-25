use std::collections::{HashMap, BTreeMap};
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::messages::SessionMessage;

// 会话结果队列状态
#[derive(Debug, Clone)]
struct SessionQueueState {
    /// 下一个期望的 utterance_index
    expected: u64,
    /// 待处理的结果（按 utterance_index 排序）
    pending: BTreeMap<u64, SessionMessage>,
    /// Gap 超时时间（毫秒），默认 5 秒
    gap_timeout_ms: i64,
    /// 开始等待 expected 的时间戳（毫秒）
    gap_wait_start_ms: i64,
    /// Pending 上限，默认 200
    pending_max: usize,
    /// 连续 Missing 计数
    consecutive_missing: u32,
    /// Missing 重置阈值，默认 20
    /// 注意：当前未使用，保留用于将来的会话重置功能
    #[allow(dead_code)]
    missing_reset_threshold: u32,
}

// 会话结果队列管理器
#[derive(Clone)]
pub struct ResultQueueManager {
    // session_id -> SessionQueueState
    queues: Arc<RwLock<HashMap<String, SessionQueueState>>>,
    /// Gap 超时时间（毫秒），默认 5 秒
    gap_timeout_ms: i64,
    /// Pending 上限，默认 200
    pending_max: usize,
    /// Missing 重置阈值，默认 20
    missing_reset_threshold: u32,
}

impl ResultQueueManager {
    pub fn new() -> Self {
        Self {
            queues: Arc::new(RwLock::new(HashMap::new())),
            gap_timeout_ms: 5 * 1000, // 默认 5 秒
            pending_max: 200,
            missing_reset_threshold: 20,
        }
    }

    #[allow(dead_code)]
    pub fn new_with_config(gap_timeout_seconds: u64, pending_max: usize, missing_reset_threshold: u32) -> Self {
        Self {
            queues: Arc::new(RwLock::new(HashMap::new())),
            gap_timeout_ms: (gap_timeout_seconds * 1000) as i64,
            pending_max,
            missing_reset_threshold,
        }
    }

    pub async fn initialize_session(&self, session_id: String) {
        let mut queues = self.queues.write().await;
        let now_ms = chrono::Utc::now().timestamp_millis();
        queues.insert(session_id, SessionQueueState {
            expected: 0,
            pending: BTreeMap::new(),
            gap_timeout_ms: self.gap_timeout_ms,
            gap_wait_start_ms: now_ms,
            pending_max: self.pending_max,
            consecutive_missing: 0,
            missing_reset_threshold: self.missing_reset_threshold,
        });
    }

    pub async fn add_result(&self, session_id: &str, utterance_index: u64, result: SessionMessage) {
        let mut queues = self.queues.write().await;
        if let Some(state) = queues.get_mut(session_id) {
            // 插入或覆盖结果
            state.pending.insert(utterance_index, result);
            
            // Pending 上限保护：如果 pending 过大，优先丢弃"最远"的结果
            while state.pending.len() > state.pending_max {
                // 丢弃最大 key（最远未来），避免无限堆积
                if let Some((&k, _)) = state.pending.iter().next_back() {
                    state.pending.remove(&k);
                    use tracing::warn;
                    warn!(
                        session_id = %session_id,
                        evicted_index = k,
                        "Pending queue overflow, evicted furthest result"
                    );
                } else {
                    break;
                }
            }
        }
    }

    /// 为指定的 utterance_index 设置截止时间（已废弃，保留以保持兼容性）
    /// 新的实现使用 gap_timeout 自动处理超时，不再需要显式设置 deadline
    #[allow(dead_code)]
    pub async fn set_result_deadline(&self, _session_id: &str, _utterance_index: u64, _deadline_ms: i64) {
        // 不再需要，gap timeout 机制会自动处理
    }

    pub async fn get_ready_results(&self, session_id: &str) -> Vec<SessionMessage> {
        use tracing::{info, warn};
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut queues = self.queues.write().await;
        if let Some(state) = queues.get_mut(session_id) {
            let mut ready = Vec::new();
            
            // 如果队列不为空且 expected 小于队列中的最小 index，调整 expected
            if !state.pending.is_empty() {
                if let Some(&min_index) = state.pending.keys().next() {
                    if state.expected < min_index {
                        warn!(
                            session_id = %session_id,
                            old_expected = state.expected,
                            new_expected = min_index,
                            "Adjusting expected_index to match first pending result"
                        );
                        state.expected = min_index;
                        state.gap_wait_start_ms = now_ms;
                    }
                }
            }
            
            info!(
                session_id = %session_id,
                expected_index = state.expected,
                queue_size = state.pending.len(),
                queue_indices = ?state.pending.keys().copied().collect::<Vec<_>>(),
                "Checking ready results"
            );
            
            // 核心逻辑：循环处理，直到没有更多可放行的结果
            loop {
                // 1) expected 已到：直接放行
                if let Some(result) = state.pending.remove(&state.expected) {
                    ready.push(result);
                    state.expected += 1;
                    state.gap_wait_start_ms = now_ms;
                    state.consecutive_missing = 0;
                    continue;
                }
                
                // 2) expected 未到：检查队列中是否有更小的索引可以释放
                // 如果队列中有比 expected 更小的索引，说明之前跳过了，现在应该释放它们
                if let Some(&min_index) = state.pending.keys().next() {
                    if min_index < state.expected {
                        warn!(
                            session_id = %session_id,
                            expected_index = state.expected,
                            found_index = min_index,
                            "Found smaller index in queue, releasing it"
                        );
                        // 释放队列中最小的索引
                        if let Some(result) = state.pending.remove(&min_index) {
                            ready.push(result);
                            state.expected = min_index + 1;
                            state.gap_wait_start_ms = now_ms;
                            state.consecutive_missing = 0;
                            continue;
                        }
                    }
                }
                
                // 3) expected 未到且队列中没有更小的索引：检查是否超时
                let elapsed_ms = now_ms - state.gap_wait_start_ms;
                if elapsed_ms >= state.gap_timeout_ms {
                    // 超时，生成 Missing 占位结果
                    warn!(
                        session_id = %session_id,
                        utterance_index = state.expected,
                        elapsed_ms = elapsed_ms,
                        gap_timeout_ms = state.gap_timeout_ms,
                        "Gap timeout, creating Missing result"
                    );
                    
                    // 记录超时指标
                    crate::metrics::on_result_gap_timeout();
                    
                    // 创建 Missing 占位结果
                    let missing_result = SessionMessage::MissingResult {
                        session_id: session_id.to_string(),
                        utterance_index: state.expected,
                        reason: "gap_timeout".to_string(),
                        created_at_ms: now_ms,
                        trace_id: None,
                    };
                    ready.push(missing_result);
                    
                    state.expected += 1;
                    state.gap_wait_start_ms = now_ms;
                    state.consecutive_missing += 1;
                    continue;
                }
                
                // 4) 未超时且 expected 未到：停止
                break;
            }
            
            info!(
                session_id = %session_id,
                ready_count = ready.len(),
                new_expected_index = state.expected,
                remaining_queue_size = state.pending.len(),
                consecutive_missing = state.consecutive_missing,
                "Ready results extracted"
            );
            
            ready
        } else {
            Vec::new()
        }
    }

    /// 检查是否应该重置会话（连续 Missing 过多）
    /// 注意：当前未使用，保留用于将来的会话重置功能
    #[allow(dead_code)]
    pub async fn should_reset_session(&self, session_id: &str) -> bool {
        let queues = self.queues.read().await;
        if let Some(state) = queues.get(session_id) {
            state.consecutive_missing >= state.missing_reset_threshold
        } else {
            false
        }
    }

    /// 获取待处理的结果索引列表（用于监控）
    #[allow(dead_code)]
    pub async fn get_pending_indices(&self, session_id: &str) -> Vec<u64> {
        let queues = self.queues.read().await;
        if let Some(state) = queues.get(session_id) {
            state.pending.keys().copied().collect()
        } else {
            Vec::new()
        }
    }

    pub async fn remove_session(&self, session_id: &str) {
        let mut queues = self.queues.write().await;
        queues.remove(session_id);
    }
}

