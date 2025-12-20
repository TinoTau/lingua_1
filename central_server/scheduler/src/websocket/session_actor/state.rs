// Session Actor 状态定义

/// Session Actor 状态机
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionActorState {
    /// 空闲状态（等待音频）
    Idle,
    /// 正在收集音频
    Collecting,
    /// 正在 finalize（创建 job）
    Finalizing {
        index: u64,
    },
    /// 已关闭
    Closed,
}

/// Session Actor 内部状态
#[derive(Debug)]
pub struct SessionActorInternalState {
    /// 当前 utterance_index
    pub current_utterance_index: u64,
    /// Actor 状态机
    pub state: SessionActorState,
    /// 当前正在 finalize 的 index（用于去重）
    pub finalize_inflight: Option<u64>,
    /// Timer generation（用于过期检测）
    pub timer_generation: u64,
    /// 最后收到音频的时间戳（毫秒）
    pub last_chunk_timestamp_ms: Option<i64>,
    /// 第一个音频块的客户端发送时间戳（毫秒，UTC时区），用于计算网络传输耗时
    pub first_chunk_client_timestamp_ms: Option<i64>,
}

impl SessionActorInternalState {
    pub fn new(initial_utterance_index: u64) -> Self {
        Self {
            current_utterance_index: initial_utterance_index,
            state: SessionActorState::Idle,
            finalize_inflight: None,
            timer_generation: 0,
            last_chunk_timestamp_ms: None,
            first_chunk_client_timestamp_ms: None,
        }
    }

    /// 检查是否可以 finalize
    pub fn can_finalize(&self, requested_index: u64) -> bool {
        // 如果已经 finalizing 或 closed，不允许
        if matches!(self.state, SessionActorState::Finalizing { .. } | SessionActorState::Closed) {
            return false;
        }
        // 如果请求的 index 小于当前 index，说明已经处理过了
        if requested_index < self.current_utterance_index {
            return false;
        }
        // 如果请求的 index 等于当前 index，且已经在 finalizing，不允许重复
        if requested_index == self.current_utterance_index && self.finalize_inflight.is_some() {
            return false;
        }
        true
    }

    /// 进入 finalizing 状态
    pub fn enter_finalizing(&mut self, index: u64) {
        self.state = SessionActorState::Finalizing { index };
        self.finalize_inflight = Some(index);
    }

    /// 完成 finalize，递增 index
    pub fn complete_finalize(&mut self) {
        if let SessionActorState::Finalizing { .. } = self.state {
            self.current_utterance_index += 1;
            self.state = SessionActorState::Idle;
            self.finalize_inflight = None;
        }
    }

    /// 进入 collecting 状态
    pub fn enter_collecting(&mut self) {
        if self.state == SessionActorState::Idle {
            self.state = SessionActorState::Collecting;
        }
    }

    /// 更新 timer generation
    pub fn increment_timer_generation(&mut self) -> u64 {
        self.timer_generation += 1;
        self.timer_generation
    }

    /// 检查 timer generation 是否有效
    pub fn is_timer_generation_valid(&self, generation: u64) -> bool {
        generation == self.timer_generation
    }
}

