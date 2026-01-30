// 轻量观测（方向A）：采样日志 + 计数
// - 通过阈值判断“慢锁等待/慢路径”，超过阈值就 warn
// - 同时计入 /api/v1/metrics 的计数器

use std::sync::atomic::{AtomicU64, Ordering};

lazy_static::lazy_static! {
    static ref LOCK_WAIT_WARN_MS: AtomicU64 = AtomicU64::new(10);
    static ref PATH_WARN_MS: AtomicU64 = AtomicU64::new(50);
}

pub fn set_thresholds(lock_wait_warn_ms: u64, path_warn_ms: u64) {
    LOCK_WAIT_WARN_MS.store(lock_wait_warn_ms, Ordering::Relaxed);
    PATH_WARN_MS.store(path_warn_ms, Ordering::Relaxed);
}

pub fn thresholds() -> (u64, u64) {
    (
        LOCK_WAIT_WARN_MS.load(Ordering::Relaxed),
        PATH_WARN_MS.load(Ordering::Relaxed),
    )
}


pub fn record_path_latency(path_name: &'static str, elapsed_ms: u64) {
    let threshold = PATH_WARN_MS.load(Ordering::Relaxed);
    if elapsed_ms >= threshold {
        crate::metrics::on_slow_path(path_name);
        tracing::warn!(
            path = path_name,
            elapsed_ms = elapsed_ms,
            threshold_ms = threshold,
            "关键路径耗时超过阈值"
        );
    }
}


