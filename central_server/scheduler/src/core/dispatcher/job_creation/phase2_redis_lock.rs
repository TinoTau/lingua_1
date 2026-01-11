//! Phase 2 Redis 锁管理模块

use super::super::JobDispatcher;
use crate::phase2::Phase2Runtime;
use uuid::Uuid;

/// Redis 锁获取结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LockAcquireResult {
    Success(String), // lock_owner
    Timeout,
}

impl JobDispatcher {
    /// 尝试获取 Redis request 锁（测试用）
    /// 返回 LockAcquireResult::Success(lock_owner) 或 LockAcquireResult::Timeout
    #[cfg(any(test, feature = "test-helpers"))]
    #[allow(dead_code)] // 仅在测试中使用
    pub async fn acquire_phase2_request_lock_test(
        &self,
        rt: &Phase2Runtime,
        request_id: &str,
        trace_id: &str,
        session_id: &str,
    ) -> LockAcquireResult {
        self.acquire_phase2_request_lock_internal(rt, request_id, trace_id, session_id).await
    }

    /// 尝试获取 Redis request 锁（内部方法）
    /// 返回 LockAcquireResult::Success(lock_owner) 或 LockAcquireResult::Timeout
    pub(crate) async fn acquire_phase2_request_lock(
        &self,
        rt: &Phase2Runtime,
        request_id: &str,
        trace_id: &str,
        session_id: &str,
    ) -> LockAcquireResult {
        self.acquire_phase2_request_lock_internal(rt, request_id, trace_id, session_id).await
    }

    /// 尝试获取 Redis request 锁（内部实现）
    async fn acquire_phase2_request_lock_internal(
        &self,
        rt: &Phase2Runtime,
        request_id: &str,
        trace_id: &str,
        session_id: &str,
    ) -> LockAcquireResult {
        let lock_owner = format!("{}:{}", rt.instance_id, Uuid::new_v4().to_string());
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(1000);
        let lock_acquire_start = std::time::Instant::now();

        while tokio::time::Instant::now() < deadline {
            if rt.acquire_request_lock(request_id, &lock_owner, 1500).await {
                let lock_acquire_elapsed = lock_acquire_start.elapsed();
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    elapsed_ms = lock_acquire_elapsed.as_millis(),
                    "Phase2 路径: Redis request 锁获取成功"
                );
                return LockAcquireResult::Success(lock_owner);
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        let lock_acquire_elapsed = lock_acquire_start.elapsed();
        tracing::warn!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            elapsed_ms = lock_acquire_elapsed.as_millis(),
            "Phase2 路径: Redis request 锁获取超时，返回 None"
        );
        LockAcquireResult::Timeout
    }
}
