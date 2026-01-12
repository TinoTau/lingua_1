// Dashboard 统计快照缓存（后台定期生成 JSON，HTTP 请求只读缓存）
//
// 设计目标：
// - 单机：避免 /api/v1/stats 每次请求都遍历状态、做网络 IO
// - 未来 cluster：把快照生成迁移到独立聚合器/Redis，不改 API handler

use crate::core::AppState;
use crate::metrics::stats::DashboardStats;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
struct Snapshot {
    json: String,
    updated_at_ms: i64,
}

#[derive(Clone)]
pub struct DashboardSnapshotCache {
    refresh_interval: Duration,
    /// 永远有值：冷启动使用空快照，避免请求路径现场生成。
    inner: Arc<RwLock<Snapshot>>,
    /// SingleFlight：同一时间只允许 1 个“非周期”的刷新触发（不阻塞请求）。
    is_generating: Arc<AtomicBool>,
    /// 频率限制：在窗口内最多触发 1 次（默认 30 秒）。
    last_triggered_at_ms: Arc<AtomicU64>,
    trigger_window: Duration,
}

impl DashboardSnapshotCache {
    pub fn new(refresh_interval: Duration) -> Self {
        let empty_json = serde_json::to_string(&DashboardStats::empty()).unwrap_or_else(|_| "{}".to_string());
        Self {
            refresh_interval,
            inner: Arc::new(RwLock::new(Snapshot {
                json: empty_json,
                updated_at_ms: 0,
            })),
            is_generating: Arc::new(AtomicBool::new(false)),
            last_triggered_at_ms: Arc::new(AtomicU64::new(0)),
            trigger_window: Duration::from_secs(30),
        }
    }

    /// 获取快照 JSON（无计算、无网络 IO）
    pub async fn get_json(&self) -> String {
        self.inner.read().await.json.clone()
    }

    pub async fn last_updated_at_ms(&self) -> i64 {
        self.inner.read().await.updated_at_ms
    }

    /// 启动后台刷新任务（非阻塞）
    pub fn start_background_refresh(&self, state: AppState) {
        let this = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(this.refresh_interval);
            loop {
                interval.tick().await;
                if let Err(e) = this.refresh_once(&state).await {
                    tracing::warn!("DashboardSnapshot 刷新失败: {}", e);
                }
            }
        });
    }

    /// 兜底触发刷新（不阻塞请求路径）：SingleFlight + 触发频率限制。
    ///
    /// 典型使用：HTTP handler 发现快照仍是冷启动空值（updated_at_ms==0）或过旧时，调用此方法即可。
    pub fn try_trigger_refresh_nonblocking(&self, state: AppState) {
        let now_ms = chrono::Utc::now().timestamp_millis() as u64;
        let last = self.last_triggered_at_ms.load(Ordering::Relaxed);
        if last != 0 && now_ms.saturating_sub(last) < self.trigger_window.as_millis() as u64 {
            return;
        }

        if self
            .is_generating
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_err()
        {
            return;
        }

        // 先写入触发时间，确保窗口内不会被反复触发（即便本次刷新失败）
        self.last_triggered_at_ms.store(now_ms, Ordering::Release);

        let this = self.clone();
        tokio::spawn(async move {
            if let Err(e) = this.refresh_once(&state).await {
                tracing::warn!("DashboardSnapshot 兜底刷新失败: {}", e);
            }
            this.is_generating.store(false, Ordering::Release);
        });
    }

    async fn refresh_once(&self, state: &AppState) -> Result<(), String> {
        let stats = DashboardStats::collect(state).await;
        let json = serde_json::to_string(&stats).map_err(|e| format!("序列化 DashboardStats 失败: {}", e))?;

        let mut guard = self.inner.write().await;
        *guard = Snapshot {
            json,
            updated_at_ms: chrono::Utc::now().timestamp_millis(),
        };
        Ok(())
    }
}


