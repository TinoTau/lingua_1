//! Session 运行时状态（每个 session 一把锁）
//! 
//! 来自同一个 Session 的翻译任务串行控制，使用一把 Session 锁
//! 根据 v3.1 设计，在 Session 锁内决定 preferred_pool 和绑定 lang_pair

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, warn};
use crate::node_registry::RuntimeSnapshot;
use crate::core::config::Phase3Config;

/// Session 运行时状态
/// 根据 v3.0 设计，用于调度路径的 Session 锁机制
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
    /// 根据 v3.1 设计，如果 lang_pair 改变，需要重置 preferred_pool
    pub fn set_bound_lang_pair(&mut self, src_lang: String, tgt_lang: String) {
        let new_pair = (src_lang.clone(), tgt_lang.clone());
        
        // 如果 lang_pair 改变，重置绑定
        if let Some(ref old_pair) = self.bound_lang_pair {
            if old_pair.0 != src_lang || old_pair.1 != tgt_lang {
                debug!(
                    old_pair = ?old_pair,
                    new_pair = ?new_pair,
                    "语言对改变，重置 preferred_pool"
                );
                self.preferred_pool = None;
                self.bound_lang_pair = Some(new_pair);
                return;
            }
        }
        
        if self.bound_lang_pair != Some(new_pair.clone()) {
            debug!(
                old_pair = ?self.bound_lang_pair,
                new_pair = ?new_pair,
                "更新绑定语言对"
            );
            self.bound_lang_pair = Some(new_pair);
        }
    }

    /// 根据 v3.1 设计，在 Session 锁内决定 preferred_pool
    /// 使用 snapshot.lang_index 和 Phase3Config 来决定
    /// 
    /// 逻辑：
    /// 1. 检查 lang_pair 是否改变，如果改变则重置绑定
    /// 2. 如果已有 preferred_pool 且 lang_pair 匹配，直接返回
    /// 3. 否则，使用 lang_index 查找候选 pools，根据配置选择 preferred_pool
    pub fn decide_preferred_pool(
        &mut self,
        src_lang: &str,
        tgt_lang: &str,
        routing_key: &str,
        snapshot: &RuntimeSnapshot,
        phase3_config: &Phase3Config,
    ) -> Option<u16> {
        // 步骤 1: 检查 lang_pair 是否改变，如果改变则重置绑定
        if let Some(ref bound_pair) = self.bound_lang_pair {
            if bound_pair.0 != src_lang || bound_pair.1 != tgt_lang {
                debug!(
                    old_pair = ?bound_pair,
                    new_src = %src_lang,
                    new_tgt = %tgt_lang,
                    "语言对改变，重置 preferred_pool"
                );
                self.preferred_pool = None;
                self.bound_lang_pair = None;
            }
        }

        // 步骤 2: 如果已经有 preferred_pool 且 lang_pair 匹配，直接返回
        if let Some(pool_id) = self.preferred_pool {
            if let Some(ref bound_pair) = self.bound_lang_pair {
                if bound_pair.0 == src_lang && bound_pair.1 == tgt_lang {
                    return Some(pool_id);
                }
            }
        }

        // 步骤 3: 使用 lang_index 查找候选 pools
        let lang_index_set_count = snapshot.lang_index.language_set_count();
        let available_sets = snapshot.lang_index.language_set_keys(10);
        debug!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            lang_index_set_count = lang_index_set_count,
            available_language_sets = ?available_sets,
            phase3_enabled = phase3_config.enabled,
            phase3_mode = %phase3_config.mode,
            phase3_pool_count = phase3_config.pools.len(),
            "开始查找候选 pools（使用 lang_index）"
        );
        let eligible_pools = if src_lang == "auto" {
            // 未知源语言：使用混合池（多对一 Pool）
            snapshot.lang_index.find_pools_for_lang_set(&[tgt_lang.to_string()])
        } else {
            // 已知源语言：直接按语言对查找
            snapshot.lang_index.find_pools_for_lang_pair(src_lang, tgt_lang)
        };
        
        debug!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            eligible_pool_count = eligible_pools.len(),
            eligible_pool_ids = ?eligible_pools,
            "查找候选 pools 完成"
        );

        if eligible_pools.is_empty() {
            warn!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                lang_index_set_count = snapshot.lang_index.language_set_count(),
                available_language_sets = ?snapshot.lang_index.language_set_keys(10),
                phase3_enabled = phase3_config.enabled,
                phase3_mode = %phase3_config.mode,
                phase3_pool_count = phase3_config.pools.len(),
                "未找到支持该语言对的 Pool"
            );
            return None;
        }

        // 步骤 4: 根据 Phase3Config 决定 preferred_pool
        let preferred_pool = if let Some(ov) = phase3_config
            .tenant_overrides
            .iter()
            .find(|x| x.tenant_id == routing_key)
        {
            // Tenant override：优先使用指定的 pool
            if eligible_pools.contains(&ov.pool_id) {
                ov.pool_id
            } else {
                debug!(
                    tenant_id = %routing_key,
                    override_pool = ov.pool_id,
                    "Tenant override pool 不在候选 pools 中，fallback 到第一个匹配的 pool"
                );
                eligible_pools[0] // fallback 到第一个匹配的 pool
            }
        } else if phase3_config.enable_session_affinity {
            // Session affinity：使用 hash 选择
            let idx = crate::phase3::pick_index_for_key(
                eligible_pools.len(),
                phase3_config.hash_seed,
                routing_key,
            );
            eligible_pools[idx]
        } else {
            // 无 session affinity：使用第一个匹配的 pool（稳定选择）
            eligible_pools[0]
        };

        // 步骤 5: 更新 Session 状态
        self.set_preferred_pool(preferred_pool);
        self.set_bound_lang_pair(src_lang.to_string(), tgt_lang.to_string());

        debug!(
            session_preferred_pool = preferred_pool,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            routing_key = %routing_key,
            eligible_pool_count = eligible_pools.len(),
            "Session 锁内决定 preferred_pool 完成"
        );

        Some(preferred_pool)
    }

    /// 更新缓存的 Pool 成员
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
/// 根据 v3.0 设计，用于调度路径的 Session 锁机制
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
/// 根据 v3.0 设计，用于调度路径的 Session 管理
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
    pub fn get_or_create_entry(&self, session_id: &str) -> Arc<SessionEntry> {
        self.sessions
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(SessionEntry::new()))
            .clone()
    }

    /// 根据 v3.1 设计，在 Session 锁内决定 preferred_pool
    /// 这是调度路径的关键函数，应该在 Session 锁内完成所有决策
    pub async fn decide_pool_for_session(
        &self,
        session_id: &str,
        src_lang: &str,
        tgt_lang: &str,
        routing_key: &str,
        snapshot: &RuntimeSnapshot,
        phase3_config: &Phase3Config,
    ) -> Option<u16> {
        let lock_start = std::time::Instant::now();
        let entry = self.get_or_create_entry(session_id);
        debug!(
            session_id = %session_id,
            lock_wait_elapsed_ms = lock_start.elapsed().as_millis(),
            "开始获取 Session 锁"
        );
        let mut session_state = entry.get_state().await;
        let lock_acquired_elapsed = lock_start.elapsed();
        if lock_acquired_elapsed.as_millis() > 10 {
            warn!(
                session_id = %session_id,
                lock_wait_ms = lock_acquired_elapsed.as_millis(),
                "Session 锁等待时间较长"
            );
        }
        
        debug!(
            session_id = %session_id,
            existing_preferred_pool = ?session_state.preferred_pool,
            existing_bound_lang_pair = ?session_state.bound_lang_pair,
            "Session 状态已获取，开始决定 preferred_pool"
        );
        let result = session_state.decide_preferred_pool(
            src_lang,
            tgt_lang,
            routing_key,
            snapshot,
            phase3_config,
        );
        debug!(
            session_id = %session_id,
            preferred_pool = ?result,
            lock_held_ms = lock_start.elapsed().as_millis(),
            "Session 锁内决定 preferred_pool 完成，即将释放锁"
        );
        result
    }

    /// 获取 Session 条目（如果存在）
    pub fn get_entry(&self, session_id: &str) -> Option<Arc<SessionEntry>> {
        self.sessions.get(session_id).map(|entry| entry.clone())
    }

    /// 移除 Session 条目
    pub fn remove_entry(&self, session_id: &str) -> bool {
        let removed = self.sessions.remove(session_id).is_some();
        if removed {
            debug!(session_id = %session_id, "移除 Session 条目");
        }
        removed
    }

    /// 获取所有 Session ID（用于统计）
    pub fn get_all_session_ids(&self) -> Vec<String> {
        self.sessions.iter().map(|entry| entry.key().clone()).collect()
    }

    /// 清理过期的 Session 条目（可选，用于内存管理）
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
    pub fn stats(&self) -> SessionRuntimeManagerStats {
        SessionRuntimeManagerStats {
            session_count: self.sessions.len(),
        }
    }
}

/// Session 运行时管理器统计信息
#[derive(Debug, Clone)]
pub struct SessionRuntimeManagerStats {
    pub session_count: usize,
}

impl Default for SessionRuntimeManager {
    fn default() -> Self {
        Self::new()
    }
}
