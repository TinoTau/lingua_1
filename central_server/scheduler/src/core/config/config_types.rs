use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::config_types_redis::RedisRuntimeConfig;
use super::config_types_scheduler::{
    AsrRerunConfig, BackgroundTasksConfig, CoreServicesConfig, DeveloperConfig, JobTimeoutPolicyConfig,
    LoadBalancerConfig, LimitsConfig, ModelNotAvailableConfig, NodeHealthConfig, ObservabilityConfig,
    PerformanceConfig, RetryConfig, TaskBindingConfig, TestingConfig, TimeoutsConfig, WebTaskSegmentationConfig,
};

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
    #[serde(default)]
    pub job_timeout: JobTimeoutPolicyConfig,
    pub job_timeout_seconds: u64,
    pub heartbeat_interval_seconds: u64,
    #[serde(default)]
    pub load_balancer: LoadBalancerConfig,
    #[serde(default)]
    pub node_health: NodeHealthConfig,
    #[serde(default)]
    pub background_tasks: BackgroundTasksConfig,
    #[serde(default)]
    pub timeouts: TimeoutsConfig,
    #[serde(default)]
    pub retry: RetryConfig,
    #[serde(default)]
    pub limits: LimitsConfig,
    #[serde(default)]
    pub testing: TestingConfig,
    #[serde(default)]
    pub performance: PerformanceConfig,
    #[serde(default)]
    pub developer: DeveloperConfig,
    #[serde(default)]
    pub model_not_available: ModelNotAvailableConfig,
    #[serde(default)]
    pub task_binding: TaskBindingConfig,
    #[serde(default)]
    pub web_task_segmentation: WebTaskSegmentationConfig,
    #[serde(default)]
    pub observability: ObservabilityConfig,
    #[serde(default)]
    pub core_services: CoreServicesConfig,
    #[serde(default, rename = "redis_runtime", alias = "phase2")]
    pub redis_runtime: RedisRuntimeConfig,
    #[serde(default)]
    pub asr_rerun: AsrRerunConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                port: 5010,
                host: "0.0.0.0".to_string(),
            },
            model_hub: ModelHubConfig {
                base_url: "http://localhost:5000".to_string(),
                storage_path: PathBuf::from("../model-hub/models/services"),
            },
            scheduler: SchedulerConfig::default(),
        }
    }
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            max_concurrent_jobs_per_node: 4,
            job_timeout_seconds: 30,
            heartbeat_interval_seconds: 15,
            job_timeout: JobTimeoutPolicyConfig::default(),
            load_balancer: LoadBalancerConfig::default(),
            node_health: NodeHealthConfig::default(),
            model_not_available: ModelNotAvailableConfig::default(),
            task_binding: TaskBindingConfig::default(),
            web_task_segmentation: WebTaskSegmentationConfig::default(),
            observability: ObservabilityConfig::default(),
            core_services: CoreServicesConfig::default(),
            redis_runtime: RedisRuntimeConfig::default(),
            asr_rerun: AsrRerunConfig::default(),
            background_tasks: BackgroundTasksConfig::default(),
            timeouts: TimeoutsConfig::default(),
            retry: RetryConfig::default(),
            limits: LimitsConfig::default(),
            testing: TestingConfig::default(),
            performance: PerformanceConfig::default(),
            developer: DeveloperConfig::default(),
        }
    }
}
