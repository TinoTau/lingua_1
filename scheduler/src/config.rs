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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancerConfig {
    #[serde(default = "default_load_balancer_strategy")]
    pub strategy: String,
}

fn default_load_balancer_strategy() -> String {
    "least_connections".to_string()
}

impl Default for LoadBalancerConfig {
    fn default() -> Self {
        Self {
            strategy: default_load_balancer_strategy(),
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
                },
            },
        }
    }
}

