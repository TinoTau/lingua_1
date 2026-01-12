//! Redis 故障降级机制
//! 
//! 当 Redis 故障或网络延迟过高时，自动降级到本地缓存模式

use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{warn, info};
use std::time::{Duration, Instant};

/// 降级模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DegradeMode {
    /// 正常模式：使用 Redis + 本地缓存
    Normal,
    /// 降级模式 1：只使用 L2 缓存（延迟缓存）
    L2Only,
    /// 降级模式 2：只使用本地缓存（local-only）
    LocalOnly,
}

impl Default for DegradeMode {
    fn default() -> Self {
        DegradeMode::Normal
    }
}

/// 降级管理器
/// 
/// 负责监控 Redis 健康状态，自动切换到降级模式
#[derive(Clone)]
pub struct DegradationManager {
    mode: Arc<RwLock<DegradeMode>>,
    redis_timeout_threshold_ms: u64,
    redis_error_count: Arc<RwLock<u64>>,
    last_redis_success: Arc<RwLock<Option<Instant>>>,
    degrade_start_time: Arc<RwLock<Option<Instant>>>,
}

impl DegradationManager {
    pub fn new(redis_timeout_threshold_ms: u64) -> Self {
        Self {
            mode: Arc::new(RwLock::new(DegradeMode::Normal)),
            redis_timeout_threshold_ms,
            redis_error_count: Arc::new(RwLock::new(0)),
            last_redis_success: Arc::new(RwLock::new(Some(Instant::now()))),
            degrade_start_time: Arc::new(RwLock::new(None)),
        }
    }

    /// 获取当前降级模式
    pub async fn get_mode(&self) -> DegradeMode {
        *self.mode.read().await
    }

    /// 记录 Redis 操作成功
    pub async fn record_redis_success(&self) {
        let mut count = self.redis_error_count.write().await;
        *count = 0; // 重置错误计数
        let mut last_success = self.last_redis_success.write().await;
        *last_success = Some(Instant::now());
        
        // 如果当前处于降级模式，尝试恢复
        let current_mode = *self.mode.read().await;
        if current_mode != DegradeMode::Normal {
            info!("Redis 操作成功，尝试恢复正常模式");
            let mut mode = self.mode.write().await;
            *mode = DegradeMode::Normal;
            let mut degrade_time = self.degrade_start_time.write().await;
            *degrade_time = None;
        }
    }

    /// 记录 Redis 操作失败
    pub async fn record_redis_error(&self, error_duration_ms: u64) {
        let mut count = self.redis_error_count.write().await;
        *count += 1;
        
        // 检查是否需要降级
        let should_degrade = error_duration_ms > self.redis_timeout_threshold_ms || *count >= 3;
        
        if should_degrade {
            let current_mode = *self.mode.read().await;
            if current_mode == DegradeMode::Normal {
                warn!(
                    error_count = *count,
                    error_duration_ms = error_duration_ms,
                    threshold_ms = self.redis_timeout_threshold_ms,
                    "Redis 错误次数或延迟超过阈值，切换到 L2Only 降级模式"
                );
                let mut mode = self.mode.write().await;
                *mode = DegradeMode::L2Only;
                let mut degrade_time = self.degrade_start_time.write().await;
                *degrade_time = Some(Instant::now());
            } else if *count >= 10 {
                // 错误次数过多，切换到 LocalOnly 模式
                if current_mode != DegradeMode::LocalOnly {
                    warn!(
                        error_count = *count,
                        "Redis 错误次数过多，切换到 LocalOnly 降级模式"
                    );
                    let mut mode = self.mode.write().await;
                    *mode = DegradeMode::LocalOnly;
                }
            }
        }
    }

    /// 检查是否应该降级
    pub async fn should_degrade(&self) -> bool {
        let mode = self.mode.read().await;
        *mode != DegradeMode::Normal
    }

    /// 获取降级开始时间（用于监控）
    pub async fn get_degrade_duration(&self) -> Option<Duration> {
        let degrade_time = self.degrade_start_time.read().await;
        degrade_time.map(|t| t.elapsed())
    }

    /// 手动设置降级模式（用于测试或手动降级）
    pub async fn set_mode(&self, mode: DegradeMode) {
        let mut current_mode = self.mode.write().await;
        if *current_mode != mode {
            info!(from_mode = ?*current_mode, to_mode = ?mode, "手动切换降级模式");
            *current_mode = mode;
            if mode != DegradeMode::Normal {
                let mut degrade_time = self.degrade_start_time.write().await;
                *degrade_time = Some(Instant::now());
            } else {
                let mut degrade_time = self.degrade_start_time.write().await;
                *degrade_time = None;
            }
        }
    }
}
