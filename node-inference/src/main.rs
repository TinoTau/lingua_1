//! 节点推理服务主程序入口

use anyhow::Result;
use std::path::PathBuf;

// 导入库模块
use lingua_node_inference::{InferenceService, http_server};

mod logging_config;

#[tokio::main]
async fn main() -> Result<()> {
    // 加载日志配置（支持模块级日志开关）
    let logging_config = logging_config::LoggingConfig::load();
    
    // 构建日志过滤器（合并配置文件和环境变量）
    let env_filter = logging_config.build_env_filter();
    
    // 初始化日志（简洁格式，只显示 message 内容）
    // 使用环境变量 LOG_FORMAT 控制输出格式：simple（默认）或 json
    // 日志级别由配置文件（observability.json）或环境变量（RUST_LOG）控制
    let log_format = std::env::var("LOG_FORMAT").unwrap_or_else(|_| "simple".to_string());
    
    if log_format == "json" {
        // JSON 格式（用于生产环境或日志收集系统）
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(env_filter)
            .with_current_span(false)
            .with_span_list(false)
            .init();
    } else {
        // 简洁格式（只显示 message 内容，默认）
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(false)
            .with_thread_ids(false)
            .with_thread_names(false)
            .with_file(false)
            .with_line_number(false)
            .with_level(false)
            .without_time()
            .compact()
            .init();
    }

    let models_dir = PathBuf::from(std::env::var("MODELS_DIR").unwrap_or_else(|_| "./models".to_string()));
    let service = InferenceService::new(models_dir)?;

    // 启动 HTTP 服务器
    let port = std::env::var("INFERENCE_SERVICE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5009);

    http_server::start_server(service, port).await?;

    Ok(())
}

