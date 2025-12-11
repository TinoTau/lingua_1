use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub scheduler: SchedulerConfig,
    pub rate_limit: RateLimitConfig,
    pub tenant: TenantConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub port: u16,
    pub host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerConfig {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitConfig {
    pub default_max_rps: usize,
    pub default_max_sessions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantConfig {
    // 租户配置可以通过数据库管理
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        let config_path = std::path::PathBuf::from("config.toml");
        
        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            let config: Config = toml::from_str(&content)?;
            Ok(config)
        } else {
            Ok(Config::default())
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                port: 8081,
                host: "0.0.0.0".to_string(),
            },
            scheduler: SchedulerConfig {
                url: "ws://localhost:8080/ws/session".to_string(),
            },
            rate_limit: RateLimitConfig {
                default_max_rps: 100,
                default_max_sessions: 10,
            },
            tenant: TenantConfig {},
        }
    }
}

