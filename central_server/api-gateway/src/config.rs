use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub scheduler: SchedulerConfig,
    pub rate_limit: RateLimitConfig,
    pub tenant: TenantConfig,
    #[serde(default)]
    pub persistence: PersistenceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub port: u16,
    pub host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerConfig {
    pub url: String,
    /// HTTP base for Correction API (derived from `url` if omitted).
    #[serde(default)]
    pub http_base_url: Option<String>,
    /// Server-side Scheduler correction token (never expose to Browser).
    #[serde(default)]
    pub correction_api_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitConfig {
    pub default_max_rps: usize,
    pub default_max_sessions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TenantConfig {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceConfig {
    /// SQLite path for UserProfile SSOT (V1).
    pub user_profile_db_path: String,
    /// Read-only Lexicon SSOT sqlite for correction lexical writeback (exact resolve).
    /// Typically points at repo `node_runtime/lexicon/v3/lexicon.sqlite`.
    #[serde(default)]
    pub lexicon_db_path: Option<String>,
}

impl Default for PersistenceConfig {
    fn default() -> Self {
        Self {
            user_profile_db_path: "data/user_profiles.sqlite3".to_string(),
            lexicon_db_path: Some("../../node_runtime/lexicon/v3/lexicon.sqlite".to_string()),
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
                url: "ws://localhost:5010/ws/session".to_string(),
                http_base_url: Some("http://localhost:5010".to_string()),
                correction_api_token: None,
            },
            rate_limit: RateLimitConfig {
                default_max_rps: 100,
                default_max_sessions: 10,
            },
            tenant: TenantConfig {},
            persistence: PersistenceConfig::default(),
        }
    }
}
