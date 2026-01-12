//! 节点推理服务主程序入口

use anyhow::Result;
use std::path::PathBuf;
use tracing_subscriber::filter::EnvFilter;
use tracing_subscriber::fmt::time::UtcTime;
use tracing_appender::non_blocking;
use file_rotate::{compression::Compression, suffix::{AppendTimestamp, FileLimit}, ContentLimit, FileRotate};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

// 导入库模块
use lingua_node_inference::{InferenceService, http_server};

mod logging_config;

#[tokio::main]
async fn main() -> Result<()> {
    // 在日志系统初始化前，使用 stderr 输出错误信息
    // 创建日志目录（在日志系统初始化前）
    let log_dir = PathBuf::from("logs");
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!("ERROR: Failed to create logs directory: {:?}, error: {}", log_dir, e);
        return Err(anyhow::anyhow!("Failed to create logs directory: {}", e));
    }
    
    // 加载日志配置（支持模块级日志开关）
    let logging_config = logging_config::LoggingConfig::load();
    
    // 构建日志过滤器（合并配置文件和环境变量）
    let env_filter = logging_config.build_env_filter();
    
    let log_path = log_dir.join("node-inference.log");
    
    // 配置文件日志（所有级别，附带时间戳，按 5MB 轮转，保留最近 5 个）
    let rotating_appender = FileRotate::new(
        log_path,
        AppendTimestamp::default(FileLimit::MaxFiles(5)),
        ContentLimit::Bytes(5 * 1024 * 1024),
        Compression::None,
    );
    let (non_blocking_appender, guard) = non_blocking(rotating_appender);
    
    // 文件日志格式（完整信息，使用完整的过滤器）
    let file_layer = tracing_subscriber::fmt::layer()
        .with_timer(UtcTime::rfc_3339())
        .with_writer(non_blocking_appender)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .with_level(true)
        .with_ansi(false)
        .json()
        .with_filter(env_filter.clone());
    
    // 终端日志格式（显示 INFO 及以上级别，简洁格式）
    let console_filter = EnvFilter::new("info");
    let stderr_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(false)
        .with_thread_ids(false)
        .with_thread_names(false)
        .with_file(false)
        .with_line_number(false)
        .with_level(true)
        .without_time()
        .compact()
        .with_filter(console_filter);
    
    // 初始化日志系统（文件 + 终端 INFO 及以上）
    tracing_subscriber::registry()
        .with(file_layer)
        .with(stderr_layer)
        .init();
    
    // 保持 guard 不被释放（确保日志缓冲区被刷新）
    // 使用 Box::leak 确保 guard 在程序运行期间一直存在
    Box::leak(Box::new(guard));
    
    // 初始化 ASR 文本过滤配置
    lingua_node_inference::text_filter::init_config();
    // 验证配置加载
    let config = lingua_node_inference::text_filter::config::get_config();
    tracing::info!(
        filter_brackets = config.rules.filter_brackets,
        bracket_chars_count = config.rules.bracket_chars.len(),
        exact_matches_count = config.rules.exact_matches.len(),
        "ASR 文本过滤配置已加载"
    );

    let models_dir = PathBuf::from(std::env::var("MODELS_DIR").unwrap_or_else(|_| "./models".to_string()));
    
    // 检查模型目录是否存在
    if !models_dir.exists() {
        let error_msg = format!("ERROR: Models directory does not exist: {:?}", models_dir);
        eprintln!("{}", error_msg);
        tracing::error!("{}", error_msg);
        return Err(anyhow::anyhow!(error_msg));
    }
    
    tracing::info!("Loading models from: {:?}", models_dir);
    let service = InferenceService::new(models_dir)
        .map_err(|e| {
            let error_msg = format!("Failed to initialize InferenceService: {}", e);
            eprintln!("ERROR: {}", error_msg);
            anyhow::anyhow!(error_msg)
        })?;

    // 启动 HTTP 服务器
    let port = std::env::var("INFERENCE_SERVICE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5009);

    tracing::info!("Starting HTTP server on port {}", port);
    http_server::start_server(service, port).await
        .map_err(|e| {
            let error_msg = format!("Failed to start HTTP server: {}", e);
            eprintln!("ERROR: {}", error_msg);
            anyhow::anyhow!(error_msg)
        })?;

    Ok(())
}

