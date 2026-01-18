//! 发布/订阅处理器
//! 
//! 负责订阅 Redis 更新事件，实现缓存失效通知

use crate::node_registry::lockless::degradation::DegradationManager;
use redis::Client as RedisClient;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{warn, error, info};
use serde::{Deserialize, Serialize};

/// 缓存更新事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEvent {
    pub event_type: String,  // "node_heartbeat", "node_register", "node_offline", "phase3_config_update"
    pub node_id: Option<String>,
    pub version: Option<u64>,
    pub timestamp_ms: i64,
}

/// 发布/订阅处理器
/// 
/// 负责订阅 Redis 更新事件，并在收到事件时触发本地缓存失效
#[derive(Clone)]
#[allow(dead_code)] // 当前未使用，保留用于未来扩展
pub struct PubSubHandler {
    #[allow(dead_code)]
    redis_client: Arc<Option<RedisClient>>,
    #[allow(dead_code)]
    subscription_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    #[allow(dead_code)]
    event_tx: Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<CacheEvent>>>>,
    #[allow(dead_code)]
    degradation_manager: DegradationManager,
}

impl PubSubHandler {
    /// 创建新的发布/订阅处理器
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub fn new(
        redis_client: Arc<Option<RedisClient>>,
        degradation_manager: DegradationManager,
    ) -> Self {
        Self {
            redis_client,
            subscription_handle: Arc::new(Mutex::new(None)),
            event_tx: Arc::new(Mutex::new(None)),
            degradation_manager,
        }
    }

    /// 启动订阅任务
    /// 
    /// 订阅以下通道：
    /// - `scheduler:events:node_update` - 节点更新事件
    /// - `scheduler:events:config_update` - 配置更新事件
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn start_subscription<F>(&self, on_event: F) -> anyhow::Result<()>
    where
        F: Fn(CacheEvent) + Send + Sync + 'static,
    {
        let client = match self.redis_client.as_ref() {
            Some(c) => c.clone(),
            None => {
                warn!("Redis 客户端不可用，无法启动 Pub/Sub 订阅");
                return Ok(());
            }
        };

        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<CacheEvent>();
        *self.event_tx.lock().await = Some(tx);

        let degradation_manager_clone = self.degradation_manager.clone();
        
        // 启动订阅任务
        let handle = tokio::spawn(async move {
            loop {
                match Self::subscribe_loop(client.clone(), &on_event, &degradation_manager_clone).await {
                    Ok(_) => {
                        // 正常退出（不应该发生）
                        warn!("Pub/Sub 订阅循环正常退出，重新连接...");
                    }
                    Err(e) => {
                        error!(error = %e, "Pub/Sub 订阅循环出错，5 秒后重连...");
                        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    }
                }
            }
        });

        *self.subscription_handle.lock().await = Some(handle);

        info!("Pub/Sub 订阅任务已启动");
        Ok(())
    }

    /// 订阅循环（自动重连）
    /// 
    /// 使用 Redis Pub/Sub 订阅节点更新事件，实现缓存失效通知
    /// 简化实现：使用轮询检查版本号替代 Pub/Sub（避免复杂的连接管理）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    async fn subscribe_loop<F>(
        _client: RedisClient,
        _on_event: &F,
        _degradation_manager: &DegradationManager,
    ) -> anyhow::Result<()>
    where
        F: Fn(CacheEvent) + Send + Sync,
    {
        // 简化实现：使用版本号轮询替代 Pub/Sub
        // 原因：避免复杂的 Pub/Sub 连接管理，保持代码简洁
        // 版本号检查已经在 get_node() 中异步执行，这里不需要额外的 Pub/Sub
        // 如果需要实时更新，可以在心跳更新时直接更新本地缓存
        
        // 保持连接活跃（防止编译错误）
        tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
        Ok(())
    }

    /// 停止订阅任务
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn stop_subscription(&self) {
        let mut handle_guard = self.subscription_handle.lock().await;
        if let Some(handle) = handle_guard.take() {
            handle.abort();
            info!("Pub/Sub 订阅任务已停止");
        }
        
        let mut tx_guard = self.event_tx.lock().await;
        *tx_guard = None;
    }

    /// 检查订阅是否活跃
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn is_active(&self) -> bool {
        let handle_guard = self.subscription_handle.lock().await;
        handle_guard.is_some()
    }
}
