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
    let shutdown_signal = async move {
        tokio::signal::ctrl_c()
            .await
            .expect("无法安装 Ctrl+C 信号处理器");
        info!("收到关闭信号，开始优雅关闭...");
        
        // 清理节点连接
        let nodes = app_state_for_shutdown.node_registry.nodes.read().await;
        if !nodes.is_empty() {
            info!("清理 {} 个节点连接", nodes.len());
            let node_ids: Vec<String> = nodes.keys().cloned().collect();
            drop(nodes);
            let phase2_runtime = app_state_for_shutdown.phase2.as_ref().map(|rt| rt.as_ref());
            for node_id in node_ids {
                app_state_for_shutdown.node_connections.unregister(&node_id).await;
                app_state_for_shutdown.node_registry.mark_node_offline(&node_id, phase2_runtime).await;
            }
        }
        
        info!("资源清理完成，等待连接关闭...");
    };
    
    // 使用优雅关闭启动服务器
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await?;
    
    info!("调度服务器已优雅关闭");
    Ok(())
}

