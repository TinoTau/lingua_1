//! 节点推理服务主程序入口

use anyhow::Result;
use std::path::PathBuf;

// 导入库模块
use lingua_node_inference::{InferenceService, http_server};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let models_dir = PathBuf::from(std::env::var("MODELS_DIR").unwrap_or_else(|_| "./models".to_string()));
    let service = InferenceService::new(models_dir)?;

    // 启动 HTTP 服务器
    let port = std::env::var("INFERENCE_SERVICE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(9000);

    http_server::start_server(service, port).await?;

    Ok(())
}

