use std::collections::{HashMap, BTreeMap};
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::messages::SessionMessage;

// 等待补位的索引状态
#[derive(Debug, Clone)]
struct PendingAcknowledgment {
    /// 开始等待的时间戳（毫秒）
    wait_start_ms: i64,
    /// 补位超时时间（毫秒），默认 5 秒
    ack_timeout_ms: i64,
}

// 会话结果队列状态
#[derive(Debug, Clone)]
struct SessionQueueState {
    /// 下一个期望的 utterance_index
    expected: u64,
    /// 待处理的结果（按 utterance_index 排序）
    pending: BTreeMap<u64, SessionMessage>,
    /// Gap 超时时间（毫秒），已废弃，不再使用
    #[allow(dead_code)]
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
    /// 等待补位的索引（当收到后续 index 时，前面的 index 进入等待补位状态）
    /// utterance_index -> PendingAcknowledgment
    pending_acknowledgments: HashMap<u64, PendingAcknowledgment>,
    /// 补位超时时间（毫秒），默认 5 秒
    ack_timeout_ms: i64,
}

// 会话结果队列管理器
#[derive(Clone)]
pub struct ResultQueueManager {
    // session_id -> SessionQueueState
    queues: Arc<RwLock<HashMap<String, SessionQueueState>>>,
    /// Gap 超时时间（毫秒），已废弃，不再使用
    #[allow(dead_code)]
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
            gap_timeout_ms: 0, // 不再使用 gap_timeout，基于单进程顺序处理和补位机制
            pending_max: 200,
            missing_reset_threshold: 20,
        }
    }
    
    /// 补位超时时间（毫秒），默认 5 秒
    /// 基于单进程顺序处理的特性：如果后续 index 已到达，说明前面的 index 已经处理完了
    /// 给前面的 index 一个补位窗口，如果超时就直接跳过（不创建 Missing result）
    const ACK_TIMEOUT_MS: i64 = 5 * 1000;

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
            pending_acknowledgments: HashMap::new(),
            ack_timeout_ms: Self::ACK_TIMEOUT_MS,
        });
    }

    pub async fn add_result(&self, session_id: &str, utterance_index: u64, result: SessionMessage) {
        use tracing::{info, warn};
        let mut queues = self.queues.write().await;
        if let Some(state) = queues.get_mut(session_id) {
            let now_ms = chrono::Utc::now().timestamp_millis();
            
            // 检查这个 index 是否在等待补位列表中，如果已超时则直接丢弃
            if let Some(ack_state) = state.pending_acknowledgments.get(&utterance_index) {
                let elapsed_ms = now_ms - ack_state.wait_start_ms;
                if elapsed_ms >= ack_state.ack_timeout_ms {
                    // 补位超时，直接丢弃，不再发送
                    warn!(
                        session_id = %session_id,
                        utterance_index = utterance_index,
                        elapsed_ms = elapsed_ms,
                        ack_timeout_ms = ack_state.ack_timeout_ms,
                        "Result arrived after acknowledgment timeout, discarding (will not be sent)"
                    );
                    state.pending_acknowledgments.remove(&utterance_index);
                    return; // 直接返回，不插入到 pending
                } else {
                    // 补位成功，在超时时间内到达
                    state.pending_acknowledgments.remove(&utterance_index);
                    info!(
                        session_id = %session_id,
                        utterance_index = utterance_index,
                        elapsed_ms = elapsed_ms,
                        "Received result for pending acknowledgment index within timeout, will be sent (first-come-first-served)"
                    );
                }
            }
            
            // 检查是否有后续 index 已到达，如果有，将前面的 index 标记为等待补位
            if utterance_index > state.expected {
                for missing_index in state.expected..utterance_index {
                    if !state.pending.contains_key(&missing_index) && !state.pending_acknowledgments.contains_key(&missing_index) {
                        state.pending_acknowledgments.insert(missing_index, PendingAcknowledgment {
                            wait_start_ms: now_ms,
                            ack_timeout_ms: state.ack_timeout_ms,
                        });
                        info!(
                            session_id = %session_id,
                            missing_index = missing_index,
                            future_index = utterance_index,
                            "Future index arrived, marking missing index as pending acknowledgment (5s grace period, will skip if timeout)"
                        );
                    }
                }
            }
            
            // 插入或覆盖结果（先到先发，不保证顺序）
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
        use tracing::{debug, info, warn};
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
            
            debug!(
                session_id = %session_id,
                expected_index = state.expected,
                queue_size = state.pending.len(),
                queue_indices = ?state.pending.keys().copied().collect::<Vec<_>>(),
                "Checking ready results"
            );
            
            // 核心逻辑：循环处理，直到没有更多可放行的结果
            // 改进：先到先发，即使有 utterance_index 在等待补位，后续已到达的结果也应该立即发送
            loop {
                // 1) expected 已到：直接放行
                if let Some(result) = state.pending.remove(&state.expected) {
                    ready.push(result);
                    // 清除等待补位状态（如果存在）
                    state.pending_acknowledgments.remove(&state.expected);
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
                            // 清除等待补位状态（如果存在）
                            state.pending_acknowledgments.remove(&min_index);
                            state.expected = min_index + 1;
                            state.gap_wait_start_ms = now_ms;
                            state.consecutive_missing = 0;
                            continue;
                        }
                    }
                }
                
                // 3) 先到先发：检查队列中是否有后续索引可以立即发送（不阻塞）
                // 即使 expected 在等待补位，后续已到达的结果也应该立即发送，不阻塞
                if let Some(&next_index) = state.pending.keys().next() {
                    if next_index > state.expected {
                        // 有后续索引已到达，立即发送（先到先发）
                        info!(
                            session_id = %session_id,
                            expected_index = state.expected,
                            next_index = next_index,
                            "Future index arrived, sending immediately (first-come-first-served, not blocking)"
                        );
                        if let Some(result) = state.pending.remove(&next_index) {
                            ready.push(result);
                            // 清除等待补位状态（如果存在）
                            state.pending_acknowledgments.remove(&next_index);
                            // 注意：不更新 expected，因为 expected 还在等待补位或处理中
                            continue;
                        }
                    }
                }
                
                // 4) expected 未到且队列中没有后续索引：检查 expected 的等待补位状态是否超时
                // 基于单进程顺序处理的特性：如果后续 index 已到达，说明前面的 index 已经处理完了
                // 给前面的 index 一个补位窗口（5秒），如果超时就直接跳过（不创建 Missing result）
                if let Some(ack_state) = state.pending_acknowledgments.get(&state.expected) {
                    let elapsed_ms = now_ms - ack_state.wait_start_ms;
                    if elapsed_ms >= ack_state.ack_timeout_ms {
                        // 等待补位超时，直接跳过（不创建 Missing result）
                        warn!(
                            session_id = %session_id,
                            utterance_index = state.expected,
                            elapsed_ms = elapsed_ms,
                            ack_timeout_ms = ack_state.ack_timeout_ms,
                            "Pending acknowledgment timeout, skipping utterance_index (no Missing result created)"
                        );
                        
                        // 记录跳过指标
                        crate::metrics::on_result_gap_timeout();
                        
                        // 直接跳过，不创建 Missing result
                        state.pending_acknowledgments.remove(&state.expected);
                        state.expected += 1;
                        state.gap_wait_start_ms = now_ms;
                        state.consecutive_missing += 1;
                        continue;
                    } else {
                        // 还在等待补位，但队列中没有后续索引，停止等待
                        // 注意：即使 expected 在等待补位，如果队列中有后续索引，会在步骤3中处理
                        break;
                    }
                }
                
                // 5) expected 未到且没有等待补位状态：直接停止等待
                // 基于单进程顺序处理的特性：
                // - 如果有后续 index，会触发补位机制并在步骤3中立即发送（先到先发）
                // - 如果没有后续 index，说明可能真的没有任务，或者任务还在处理中
                // - 不需要 gap_timeout，直接停止等待，让后续的结果自然触发处理
                break;
            }
            
            debug!(
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

    /// 移除会话（在移除前 flush 所有待发送的结果）
    /// 返回所有待发送的结果，调用者应该发送这些结果
    pub async fn remove_session(&self, session_id: &str) -> Vec<SessionMessage> {
        // 先获取所有待发送的结果（flush）
        let pending_results = self.get_all_pending_results(session_id).await;
        
        // 然后删除会话
        let mut queues = self.queues.write().await;
        queues.remove(session_id);
        
        // 返回待发送的结果（调用者应该发送这些结果）
        pending_results
    }
    
    /// 获取所有待发送的结果（用于 session 关闭时 flush）
    /// 返回所有 pending 的结果，不检查 expected 或补位状态
    pub async fn get_all_pending_results(&self, session_id: &str) -> Vec<SessionMessage> {
        let mut queues = self.queues.write().await;
        if let Some(state) = queues.get_mut(session_id) {
            // 获取所有 pending 的结果，按 index 排序
            let mut results: Vec<_> = state.pending.values().cloned().collect();
            // 按 utterance_index 排序（虽然 BTreeMap 已经排序，但为了安全起见）
            results.sort_by_key(|msg| {
                if let SessionMessage::TranslationResult { utterance_index, .. } = msg {
                    *utterance_index
                } else if let SessionMessage::MissingResult { utterance_index, .. } = msg {
                    *utterance_index
                } else {
                    0
                }
            });
            results
        } else {
            Vec::new()
        }
    }
}

