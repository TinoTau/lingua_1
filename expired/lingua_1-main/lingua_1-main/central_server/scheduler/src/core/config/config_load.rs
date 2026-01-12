use super::config_types::Config;
use std::path::PathBuf;

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

