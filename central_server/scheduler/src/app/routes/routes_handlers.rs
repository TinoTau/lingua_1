use crate::core::AppState;
use axum::{
    extract::ws::WebSocketUpgrade,
    response::Response,
    Router,
};
use std::net::SocketAddr;
use tracing::info;
use crate::websocket::{handle_session, handle_node};

// WebSocket 处理函数
pub async fn handle_session_ws(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_session(socket, state))
}

pub async fn handle_node_ws(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_node(socket, state))
}

pub async fn start_server(
    app: Router,
    port: u16,
    app_state_for_shutdown: AppState,
) -> anyhow::Result<()> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("调度服务器监听地址: {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    
    // 创建关闭信号通道，用于跨平台信号处理
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    
    // 设置信号处理器（支持 Ctrl+C 和 SIGTERM）
    let shutdown_tx1 = shutdown_tx.clone();
    tokio::spawn(async move {
        // Windows: 只支持 Ctrl+C (SIGINT)
        // Unix: 支持 SIGINT 和 SIGTERM
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sigterm = match signal(SignalKind::terminate()) {
                Ok(s) => s,
                Err(e) => {
                    tracing::error!(error = %e, "无法安装 SIGTERM 信号处理器");
                    return;
                }
            };
            
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {
                    info!("收到 Ctrl+C 信号");
                }
                _ = sigterm.recv() => {
                    info!("收到 SIGTERM 信号");
                }
            }
        }
        
        #[cfg(not(unix))]
        {
            tokio::signal::ctrl_c()
                .await
                .expect("无法安装 Ctrl+C 信号处理器");
            info!("收到 Ctrl+C 信号");
        }
        
        let _ = shutdown_tx1.send(());
    });
    
    let shutdown_signal = async move {
        // 等待关闭信号
        if shutdown_rx.recv().await.is_none() {
            // Channel 已关闭，可能是其他原因导致的关闭
            info!("关闭信号通道已关闭");
            return;
        }
        
        info!("收到关闭信号，开始优雅关闭...");
        
        // 清理节点连接（使用 ManagementRegistry）
        let node_ids: Vec<String> = {
            let mgmt = app_state_for_shutdown.node_registry.management_registry.read().await;
            mgmt.nodes.keys().cloned().collect()
        };
        if !node_ids.is_empty() {
            info!("清理 {} 个节点连接", node_ids.len());
            let phase2_runtime = app_state_for_shutdown.phase2.as_ref().map(|rt| rt.as_ref());
            for node_id in node_ids {
                app_state_for_shutdown.node_connections.unregister(&node_id).await;
                app_state_for_shutdown.node_registry.mark_node_offline(&node_id, phase2_runtime).await;
            }
        }
        
        // 清理 Phase2 资源（如果有）
        if let Some(ref _rt) = app_state_for_shutdown.phase2 {
            info!("清理 Phase2 资源...");
            // Phase2Runtime 应该有自己的清理逻辑（如果有）
            // 这里只是记录日志，实际的清理可能在 Phase2Runtime 的 Drop 实现中
        }
        
        info!("资源清理完成，等待 axum 优雅关闭连接...");
        // 注意：with_graceful_shutdown 会等待所有连接关闭，所以这里不需要额外的等待
        // shutdown_signal future 完成后，axum 会开始关闭服务器，等待所有连接关闭
    };
    
    // 使用优雅关闭启动服务器
    info!("调度服务器已启动，等待连接...");
    match axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await
    {
        Ok(_) => {
            info!("调度服务器已优雅关闭");
        }
        Err(e) => {
            tracing::error!(error = %e, "服务器关闭时出错");
            return Err(anyhow::anyhow!("服务器关闭时出错: {}", e));
        }
    }
    
    Ok(())
}

