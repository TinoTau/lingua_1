//! Session 运行时状态（每个 session 一把锁）
//! 
//! 来自同一个 Session 的翻译任务串行控制，使用一把 Session 锁

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, warn};

/// Session 运行时状态
/// 注意：将在调度路径改造时使用，目前仅在测试中使用
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SessionRuntimeState {
    /// 首选的 Pool ID（用于 session affinity）
    pub preferred_pool: Option<u16>,
    /// 绑定的语言对（用于语言对归一化）
    pub bound_lang_pair: Option<(String, String)>,
    /// 缓存的 Pool 成员（可选，用于性能优化）
    pub cached_pool_members: Option<(Vec<String>, i64)>,
}

impl SessionRuntimeState {
    pub fn new() -> Self {
        Self {
            preferred_pool: None,
            bound_lang_pair: None,
            cached_pool_members: None,
        }
    }

    /// 更新首选 Pool
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn set_preferred_pool(&mut self, pool_id: u16) {
        if self.preferred_pool != Some(pool_id) {
            debug!(
                old_pool = ?self.preferred_pool,
                new_pool = pool_id,
                "更新首选 Pool"
            );
            self.preferred_pool = Some(pool_id);
        }
    }

    /// 更新绑定的语言对
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn set_bound_lang_pair(&mut self, src_lang: String, tgt_lang: String) {
        let new_pair = (src_lang.clone(), tgt_lang.clone());
        if self.bound_lang_pair != Some(new_pair.clone()) {
            debug!(
                old_pair = ?self.bound_lang_pair,
                new_pair = ?new_pair,
                "更新绑定语言对"
            );
            self.bound_lang_pair = Some(new_pair);
        }
    }

    /// 更新缓存的 Pool 成员
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn update_pool_members_cache(&mut self, pool_id: u16, members: Vec<String>) {
        let now_ms = chrono::Utc::now().timestamp_millis();
        self.cached_pool_members = Some((members, now_ms));
        debug!(
            pool_id = pool_id,
            member_count = self.cached_pool_members.as_ref().map(|(v, _)| v.len()).unwrap_or(0),
            "更新 Pool 成员缓存"
        );
    }

    /// 获取缓存的 Pool 成员（如果未过期）
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn get_cached_pool_members(&self, _pool_id: u16, cache_ttl_ms: i64) -> Option<Vec<String>> {
        if let Some((members, cached_at)) = &self.cached_pool_members {
            let now_ms = chrono::Utc::now().timestamp_millis();
            if now_ms - cached_at < cache_ttl_ms {
                return Some(members.clone());
            }
        }
        None
    }
}

impl Default for SessionRuntimeState {
    fn default() -> Self {
        Self::new()
    }
}

/// Session 条目（每个 session 一把锁）
/// 注意：将在调度路径改造时使用，目前仅在测试中使用
#[allow(dead_code)]
#[derive(Clone)]
pub struct SessionEntry {
    /// Session 运行时状态（由 Mutex 保护）
    pub mutex: Arc<Mutex<SessionRuntimeState>>,
}

impl SessionEntry {
    pub fn new() -> Self {
        Self {
            mutex: Arc::new(Mutex::new(SessionRuntimeState::new())),
        }
    }

    /// 获取运行时状态（需要持有锁）
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub async fn get_state(&self) -> tokio::sync::MutexGuard<'_, SessionRuntimeState> {
        let start = std::time::Instant::now();
        let guard = self.mutex.lock().await;
        let elapsed = start.elapsed();
        if elapsed.as_millis() > 10 {
            warn!(
                lock_wait_ms = elapsed.as_millis(),
                "Session 锁等待时间较长"
            );
        }
        guard
    }
}

impl Default for SessionEntry {
    fn default() -> Self {
        Self::new()
    }
}

/// Session 运行时管理器（使用 DashMap，每个 session 一把锁）
/// 注意：将在调度路径改造时使用，目前仅在测试中使用
#[allow(dead_code)]
#[derive(Clone)]
pub struct SessionRuntimeManager {
    /// Session 条目映射（DashMap 提供并发安全）
    pub sessions: Arc<DashMap<String, Arc<SessionEntry>>>,
}

impl SessionRuntimeManager {
    /// 创建新的 Session 运行时管理器
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
        }
    }

    /// 获取或创建 Session 条目
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn get_or_create_entry(&self, session_id: &str) -> Arc<SessionEntry> {
        self.sessions
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(SessionEntry::new()))
            .clone()
    }

    /// 获取 Session 条目（如果存在）
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn get_entry(&self, session_id: &str) -> Option<Arc<SessionEntry>> {
        self.sessions.get(session_id).map(|entry| entry.clone())
    }

    /// 移除 Session 条目
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn remove_entry(&self, session_id: &str) -> bool {
        let removed = self.sessions.remove(session_id).is_some();
        if removed {
            debug!(session_id = %session_id, "移除 Session 条目");
        }
        removed
    }

    /// 获取所有 Session ID（用于统计）
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn get_all_session_ids(&self) -> Vec<String> {
        self.sessions.iter().map(|entry| entry.key().clone()).collect()
    }

    /// 清理过期的 Session 条目（可选，用于内存管理）
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn cleanup_expired_sessions(&self, _max_idle_ms: i64) {
        // 注意：DashMap 的迭代是安全的，但清理逻辑需要根据实际需求实现
        // 这里只是示例，实际可能需要更复杂的逻辑
        self.sessions.retain(|_session_id, _entry| {
            // 这里可以添加过期检查逻辑
            // 暂时保留所有条目
            true
        });
    }

    /// 获取统计信息
    #[allow(dead_code)] // 目前未使用，保留用于未来 Session 锁机制
    pub fn stats(&self) -> SessionRuntimeManagerStats {
        SessionRuntimeManagerStats {
            session_count: self.sessions.len(),
        }
    }
}

/// Session 运行时管理器统计信息
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SessionRuntimeManagerStats {
    pub session_count: usize,
}

impl Default for SessionRuntimeManager {
    fn default() -> Self {
        Self::new()
    }
}
