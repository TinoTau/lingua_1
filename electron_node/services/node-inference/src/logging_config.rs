//! 日志配置模块
//! 支持从配置文件加载模块级别的日志设置，并合并环境变量的设置

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// 默认日志级别（如果模块未指定）
    #[serde(default = "default_log_level")]
    pub default_level: String,
    
    /// 模块级别的日志设置
    /// key: 模块名称（如 "lingua_node_inference::inference"）
    /// value: 日志级别（如 "debug", "info", "warn", "error"）
    #[serde(default)]
    pub modules: HashMap<String, String>,
}

fn default_log_level() -> String {
    "info".to_string()
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            default_level: "info".to_string(),
            modules: HashMap::new(),
        }
    }
}

impl LoggingConfig {
    /// 从配置文件加载日志配置
    /// 配置文件路径固定为：config/observability.json（相对于服务运行目录）
    pub fn load() -> Self {
        // 固定路径：config/observability.json
        let config_path = PathBuf::from("config/observability.json");
        
        if config_path.exists() {
            match std::fs::read_to_string(&config_path) {
                Ok(content) => {
                    match serde_json::from_str::<LoggingConfig>(&content) {
                        Ok(config) => {
                            // 注意：此时日志系统尚未初始化，使用 println! 输出
                            println!("已加载日志配置文件: {:?}", config_path);
                            return config;
                        }
                        Err(e) => {
                            eprintln!("解析日志配置文件失败: {:?}, 错误: {}", config_path, e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("读取日志配置文件失败: {:?}, 错误: {}", config_path, e);
                }
            }
        }
        
        // 如果配置文件不存在，返回默认配置
        LoggingConfig::default()
    }
    
    /// 构建 EnvFilter，合并配置文件和环境变量的设置
    /// 优先级：环境变量 > 配置文件 > 默认值
    pub fn build_env_filter(&self) -> EnvFilter {
        // 首先检查环境变量 RUST_LOG
        if std::env::var("RUST_LOG").is_ok() {
            // 如果环境变量存在，使用环境变量（优先级最高）
            return EnvFilter::from_default_env();
        }
        
        // 如果没有环境变量，使用配置文件构建过滤器
        let mut filter_parts = Vec::new();
        
        // 添加默认级别
        filter_parts.push(self.default_level.clone());
        
        // 添加模块级别的设置
        for (module, level) in &self.modules {
            filter_parts.push(format!("{}={}", module, level));
        }
        
        let filter_str = filter_parts.join(",");
        
        EnvFilter::try_new(&filter_str)
            .unwrap_or_else(|_| {
                tracing::warn!("日志过滤器构建失败，使用默认配置");
                EnvFilter::new(self.default_level.clone())
            })
    }
}

