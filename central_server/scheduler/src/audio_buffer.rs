//! 音频缓冲区管理器
//! 用于累积流式音频块（audio_chunk 消息）

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 音频缓冲区（按会话和 utterance_index 组织）
#[derive(Debug, Clone)]
struct AudioBuffer {
    chunks: Vec<Vec<u8>>, // 累积的音频块（PCM 数据）
    total_size: usize,
}

impl AudioBuffer {
    fn new() -> Self {
        Self {
            chunks: Vec::new(),
            total_size: 0,
        }
    }

    fn add_chunk(&mut self, chunk: Vec<u8>) {
        self.total_size += chunk.len();
        self.chunks.push(chunk);
    }

    fn get_combined(&self) -> Vec<u8> {
        let mut combined = Vec::with_capacity(self.total_size);
        for chunk in &self.chunks {
            combined.extend_from_slice(chunk);
        }
        combined
    }

    #[allow(dead_code)]
    fn clear(&mut self) {
        self.chunks.clear();
        self.total_size = 0;
    }
}

/// 音频缓冲区管理器
#[derive(Clone)]
pub struct AudioBufferManager {
    buffers: Arc<RwLock<HashMap<String, AudioBuffer>>>, // key: "{session_id}:{utterance_index}"
    /// 记录每个 session 最近一次收到 audio_chunk 的时间（用于停顿自动切句）
    last_chunk_at_ms: Arc<RwLock<HashMap<String, i64>>>,
}

impl AudioBufferManager {
    pub fn new() -> Self {
        Self {
            buffers: Arc::new(RwLock::new(HashMap::new())),
            last_chunk_at_ms: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 记录收到音频块，并判断是否超过停顿阈值（毫秒）。
    /// 返回 true 表示：本次与上次间隔 > pause_ms，应视为“新任务开始”（需要先结束上一任务）。
    pub async fn record_chunk_and_check_pause(&self, session_id: &str, now_ms: i64, pause_ms: u64) -> bool {
        let mut map = self.last_chunk_at_ms.write().await;
        let exceeded = map
            .get(session_id)
            .map(|prev| now_ms.saturating_sub(*prev) > pause_ms as i64)
            .unwrap_or(false);
        map.insert(session_id.to_string(), now_ms);
        exceeded
    }

    pub async fn get_last_chunk_at_ms(&self, session_id: &str) -> Option<i64> {
        self.last_chunk_at_ms.read().await.get(session_id).copied()
    }

    /// 添加音频块
    pub async fn add_chunk(&self, session_id: &str, utterance_index: u64, chunk: Vec<u8>) {
        let key = format!("{}:{}", session_id, utterance_index);
        let mut buffers = self.buffers.write().await;
        let buffer = buffers.entry(key).or_insert_with(AudioBuffer::new);
        buffer.add_chunk(chunk);
    }

    /// 获取并清空累积的音频数据
    pub async fn take_combined(&self, session_id: &str, utterance_index: u64) -> Option<Vec<u8>> {
        let key = format!("{}:{}", session_id, utterance_index);
        let mut buffers = self.buffers.write().await;
        if let Some(buffer) = buffers.remove(&key) {
            let combined = buffer.get_combined();
            Some(combined)
        } else {
            None
        }
    }

    /// 清空指定会话的缓冲区
    #[allow(dead_code)]
    pub async fn clear(&self, session_id: &str, utterance_index: u64) {
        let key = format!("{}:{}", session_id, utterance_index);
        let mut buffers = self.buffers.write().await;
        buffers.remove(&key);
    }

    /// 清空所有缓冲区（用于会话关闭时）
    #[allow(dead_code)]
    pub async fn clear_all_for_session(&self, session_id: &str) {
        let mut buffers = self.buffers.write().await;
        buffers.retain(|key, _| !key.starts_with(&format!("{}:", session_id)));
        let mut map = self.last_chunk_at_ms.write().await;
        map.remove(session_id);
    }
}

