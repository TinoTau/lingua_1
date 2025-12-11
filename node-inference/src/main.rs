//! 节点推理服务主程序入口

use anyhow::Result;
use std::path::PathBuf;

// 导入库模块
use lingua_node_inference::InferenceService;

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let models_dir = PathBuf::from(std::env::var("MODELS_DIR").unwrap_or_else(|_| "./models".to_string()));
    let _service = InferenceService::new(models_dir)?;

    // TODO: 实现 HTTP/gRPC 服务接口，供 Electron 节点调用
    // 当前作为库使用，由 Electron 节点直接调用

    Ok(())
}

