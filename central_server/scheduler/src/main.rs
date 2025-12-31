use anyhow::Result;
use crate::core::Config;
use crate::app::{setup_logging, initialize_app, create_router, start_server};
use tracing::info;

mod core;
mod messages;
mod node_registry;
mod websocket;
mod utils;
mod managers;
mod services;
mod metrics;
mod timeout;
mod model_not_available;
mod phase2;
mod phase3;
mod app;

#[tokio::main]
async fn main() -> Result<()> {
    // 设置日志
    setup_logging()?;

    // 加载配置
    let config = Config::load()?;
    info!("配置加载成功");

    // 初始化应用
    let app_state = initialize_app(&config).await?;

    // 设置优雅关闭信号处理（需要在构建路由之前克隆）
    let app_state_for_shutdown = app_state.clone();
    
    // 构建路由
    let app = create_router(app_state);
    
    // 启动服务器
    start_server(app, config.server.port, app_state_for_shutdown).await?;
    
    Ok(())
}
