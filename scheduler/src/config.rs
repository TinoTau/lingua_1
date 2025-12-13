use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub model_hub: ModelHubConfig,
    pub scheduler: SchedulerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub port: u16,
    pub host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelHubConfig {
    pub base_url: String,
    pub storage_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerConfig {
    pub max_concurrent_jobs_per_node: usize,
    pub job_timeout_seconds: u64,
    pub heartbeat_interval_seconds: u64,
    #[serde(default)]
    pub load_balancer: LoadBalancerConfig,
    #[serde(default)]
    pub node_health: NodeHealthConfig,
}

/// 节点健康检查配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeHealthConfig {
    /// 心跳间隔（秒）
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_seconds: u64,
    /// 心跳超时（秒），超过此时间未收到心跳则判为 offline
    #[serde(default = "default_heartbeat_timeout")]
    pub heartbeat_timeout_seconds: u64,
    /// registering → ready 需要连续正常心跳次数
    #[serde(default = "default_health_check_count")]
    pub health_check_count: usize,
    /// warmup 超时（秒），超过此时间仍未 ready 则转 degraded
    #[serde(default = "default_warmup_timeout")]
    pub warmup_timeout_seconds: u64,
    /// 失败率阈值：连续 N 次中失败 ≥ M 次，或连续失败 M 次
    #[serde(default = "default_failure_threshold")]
    pub failure_threshold: FailureThreshold,
    /// 状态转换定期扫描间隔（秒）
    #[serde(default = "default_status_scan_interval")]
    pub status_scan_interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailureThreshold {
    /// 检查窗口大小（例如：5 次）
    pub window_size: usize,
    /// 失败次数阈值（例如：3 次）
    pub failure_count: usize,
    /// 连续失败次数阈值（例如：3 次）
    pub consecutive_failure_count: usize,
}

fn default_heartbeat_interval() -> u64 {
    15
}

fn default_heartbeat_timeout() -> u64 {
    45
}

fn default_health_check_count() -> usize {
    3
}

fn default_warmup_timeout() -> u64 {
    60
}

fn default_failure_threshold() -> FailureThreshold {
    FailureThreshold {
        window_size: 5,
        failure_count: 3,
        consecutive_failure_count: 3,
    }
}

fn default_status_scan_interval() -> u64 {
    30
}

impl Default for NodeHealthConfig {
    fn default() -> Self {
        Self {
            heartbeat_interval_seconds: default_heartbeat_interval(),
            heartbeat_timeout_seconds: default_heartbeat_timeout(),
            health_check_count: default_health_check_count(),
            warmup_timeout_seconds: default_warmup_timeout(),
            failure_threshold: default_failure_threshold(),
            status_scan_interval_seconds: default_status_scan_interval(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancerConfig {
    #[serde(default = "default_load_balancer_strategy")]
    pub strategy: String,
    /// 资源使用率阈值（超过此值的节点将被跳过）
    #[serde(default = "default_resource_threshold")]
    pub resource_threshold: f32,
}

fn default_resource_threshold() -> f32 {
    25.0 // 默认 25%
}

fn default_load_balancer_strategy() -> String {
    "least_connections".to_string()
}

impl Default for LoadBalancerConfig {
    fn default() -> Self {
        Self {
            strategy: default_load_balancer_strategy(),
            resource_threshold: default_resource_threshold(),
        }
    }
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        let config_path = PathBuf::from("config.toml");
        
        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            let config: Config = toml::from_str(&content)?;
            Ok(config)
        } else {
            // 使用默认配置
            Ok(Config::default())
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                port: 8080,
                host: "0.0.0.0".to_string(),
            },
            model_hub: ModelHubConfig {
                base_url: "http://localhost:5000".to_string(),
                storage_path: PathBuf::from("./models"),
            },
            scheduler: SchedulerConfig {
                max_concurrent_jobs_per_node: 4,
                job_timeout_seconds: 30,
                heartbeat_interval_seconds: 15,
                load_balancer: LoadBalancerConfig {
                    strategy: "least_connections".to_string(),
                    resource_threshold: default_resource_threshold(),
                },
                node_health: NodeHealthConfig::default(),
            },
        }
    }
}

