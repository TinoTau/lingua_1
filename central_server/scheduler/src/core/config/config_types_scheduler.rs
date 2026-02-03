use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobTimeoutPolicyConfig {
    /// Pending（未成功派发）状态的超时秒数（从 job.created_at 计时）
    #[serde(default = "super::config_defaults::default_job_pending_timeout_seconds")]
    pub pending_timeout_seconds: u64,
    /// 超时后自动重派最大次数（不包含首次派发）
    #[serde(default = "super::config_defaults::default_job_failover_max_attempts")]
    pub failover_max_attempts: u32,
    /// 超时扫描间隔（毫秒）
    #[serde(default = "super::config_defaults::default_job_timeout_scan_interval_ms")]
    pub scan_interval_ms: u64,
    /// 是否给节点发送取消指令（best-effort）
    #[serde(default = "super::config_defaults::default_job_timeout_send_cancel")]
    pub send_cancel: bool,
}

/// 核心链路服务包 ID（与 ModelHub services_index.json 中的 service_id 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreServicesConfig {
    /// ASR 服务包（可为空；为空则不参与 required 列表）
    #[serde(default = "super::config_defaults::default_core_asr_service_id")]
    pub asr_service_id: String,
    /// NMT 服务包（可为空）
    #[serde(default = "super::config_defaults::default_core_nmt_service_id")]
    pub nmt_service_id: String,
    /// TTS 服务包（可为空）
    #[serde(default = "super::config_defaults::default_core_tts_service_id")]
    pub tts_service_id: String,
}

/// 任务级绑定与并发占用配置（Phase 1）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskBindingConfig {
    /// request_id → (job_id,node_id) 绑定租约 TTL（秒）
    #[serde(default = "super::config_defaults::default_task_binding_lease_seconds")]
    pub lease_seconds: u64,
    /// 节点 reserved job 记录 TTL（秒）
    #[serde(default = "super::config_defaults::default_task_binding_reserved_ttl_seconds")]
    pub reserved_ttl_seconds: u64,
    #[serde(default)]
    pub spread_enabled: bool,
    #[serde(default = "super::config_defaults::default_task_binding_spread_window_seconds")]
    pub spread_window_seconds: u64,
}

/// Web 端音频分段（AudioChunk）任务边界配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebTaskSegmentationConfig {
    #[serde(default = "super::config_defaults::default_web_pause_ms")]
    pub pause_ms: u64,
    #[serde(default = "super::config_defaults::default_max_audio_duration_ms")]
    pub max_duration_ms: u64,
    #[serde(default)]
    pub edge_stabilization: EdgeStabilizationConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeStabilizationConfig {
    #[serde(default = "super::config_defaults::default_hangover_auto_ms")]
    pub hangover_auto_ms: u64,
    #[serde(default = "super::config_defaults::default_hangover_manual_ms")]
    pub hangover_manual_ms: u64,
    #[serde(default = "super::config_defaults::default_padding_auto_ms")]
    pub padding_auto_ms: u64,
    #[serde(default = "super::config_defaults::default_padding_manual_ms")]
    pub padding_manual_ms: u64,
    #[serde(default = "super::config_defaults::default_short_merge_threshold_ms")]
    pub short_merge_threshold_ms: u64,
}

/// MODEL_NOT_AVAILABLE 处理配置（Phase 1）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelNotAvailableConfig {
    #[serde(default = "super::config_defaults::default_model_na_unavailable_ttl_seconds")]
    pub unavailable_ttl_seconds: u64,
    #[serde(default = "super::config_defaults::default_model_na_debounce_window_seconds")]
    pub debounce_window_seconds: u64,
    #[serde(default = "super::config_defaults::default_model_na_node_ratelimit_window_seconds")]
    pub node_ratelimit_window_seconds: u64,
    #[serde(default = "super::config_defaults::default_model_na_node_ratelimit_max")]
    pub node_ratelimit_max: u32,
}

/// 节点健康检查配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeHealthConfig {
    #[serde(default = "super::config_defaults::default_heartbeat_interval")]
    pub heartbeat_interval_seconds: u64,
    #[serde(default = "super::config_defaults::default_heartbeat_timeout")]
    pub heartbeat_timeout_seconds: u64,
    #[serde(default = "super::config_defaults::default_health_check_count")]
    pub health_check_count: usize,
    #[serde(default = "super::config_defaults::default_warmup_timeout")]
    pub warmup_timeout_seconds: u64,
    #[serde(default = "super::config_defaults::default_failure_threshold")]
    pub failure_threshold: FailureThreshold,
    #[serde(default = "super::config_defaults::default_status_scan_interval")]
    pub status_scan_interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailureThreshold {
    pub window_size: usize,
    pub failure_count: usize,
    pub consecutive_failure_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancerConfig {
    #[serde(default = "super::config_defaults::default_load_balancer_strategy")]
    pub strategy: String,
    #[serde(default = "super::config_defaults::default_resource_threshold")]
    pub resource_threshold: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservabilityConfig {
    #[serde(default = "super::config_defaults::default_obs_lock_wait_warn_ms")]
    pub lock_wait_warn_ms: u64,
    #[serde(default = "super::config_defaults::default_obs_path_warn_ms")]
    pub path_warn_ms: u64,
}

/// OBS-3: ASR 重跑限频/超时机制配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrRerunConfig {
    #[serde(default = "super::config_defaults::default_asr_rerun_max_count")]
    pub max_rerun_count: u32,
    #[serde(default = "super::config_defaults::default_asr_rerun_timeout_ms")]
    pub rerun_timeout_ms: u64,
    #[serde(default = "super::config_defaults::default_asr_rerun_conference_mode_strict")]
    pub conference_mode_strict: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundTasksConfig {
    #[serde(default = "super::config_defaults::default_preload_delay_seconds")]
    pub preload_delay_seconds: u64,
    #[serde(default = "super::config_defaults::default_job_result_dedup_cleanup_interval_seconds")]
    pub job_result_dedup_cleanup_interval_seconds: u64,
    #[serde(default = "super::config_defaults::default_session_cleanup_interval_seconds")]
    pub session_cleanup_interval_seconds: u64,
    #[serde(default = "super::config_defaults::default_job_cleanup_interval_seconds")]
    pub job_cleanup_interval_seconds: u64,
    #[serde(default = "super::config_defaults::default_session_active_result_check_interval_seconds")]
    pub session_active_result_check_interval_seconds: u64,
    #[serde(default = "super::config_defaults::default_node_status_scan_interval_seconds")]
    pub node_status_scan_interval_seconds: u64,
    #[serde(default = "super::config_defaults::default_dashboard_snapshot_cache_ttl_seconds")]
    pub dashboard_snapshot_cache_ttl_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeoutsConfig {
    #[serde(default = "super::config_defaults::default_ws_message_preview_max_chars")]
    pub ws_message_preview_max_chars: usize,
    #[serde(default = "super::config_defaults::default_phase2_presence_wait_timeout_seconds", alias = "phase2_presence_wait_timeout_seconds")]
    pub redis_presence_wait_timeout_seconds: u64,
    #[serde(default = "super::config_defaults::default_phase2_presence_check_interval_ms", alias = "phase2_presence_check_interval_ms")]
    pub redis_presence_check_interval_ms: u64,
    #[serde(default = "super::config_defaults::default_phase2_node_registration_timeout_seconds", alias = "phase2_node_registration_timeout_seconds")]
    pub redis_node_registration_timeout_seconds: u64,
    #[serde(default = "super::config_defaults::default_phase2_node_snapshot_sync_timeout_seconds", alias = "phase2_node_snapshot_sync_timeout_seconds")]
    pub redis_node_snapshot_sync_timeout_seconds: u64,
    #[serde(default = "super::config_defaults::default_phase2_pool_config_sync_timeout_seconds", alias = "phase2_pool_config_sync_timeout_seconds")]
    pub redis_pool_config_sync_timeout_seconds: u64,
    #[serde(default = "super::config_defaults::default_phase2_pool_config_check_interval_ms", alias = "phase2_pool_config_check_interval_ms")]
    pub redis_pool_config_check_interval_ms: u64,
    #[serde(default = "super::config_defaults::default_ws_ack_timeout_seconds")]
    pub ws_ack_timeout_seconds: u64,
    #[serde(default = "super::config_defaults::default_ws_translation_result_timeout_seconds")]
    pub ws_translation_result_timeout_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    #[serde(default = "super::config_defaults::default_min_ttl_seconds")]
    pub min_ttl_seconds: u64,
    #[serde(default = "super::config_defaults::default_min_ttl_ms")]
    pub min_ttl_ms: u64,
    #[serde(default = "super::config_defaults::default_redis_stream_min_maxlen")]
    pub redis_stream_min_maxlen: usize,
    #[serde(default = "super::config_defaults::default_pubsub_reconnect_delay_seconds")]
    pub pubsub_reconnect_delay_seconds: u64,
    #[serde(default = "super::config_defaults::default_pubsub_keepalive_timeout_seconds")]
    pub pubsub_keepalive_timeout_seconds: u64,
    #[serde(default = "super::config_defaults::default_node_cache_version_check_timeout_ms")]
    pub node_cache_version_check_timeout_ms: u64,
    #[serde(default = "super::config_defaults::default_node_cache_miss_ttl_ms")]
    pub node_cache_miss_ttl_ms: i64,
    #[serde(default = "super::config_defaults::default_job_min_attempt_id")]
    pub job_min_attempt_id: u32,
    #[serde(default = "super::config_defaults::default_phase2_group_create_retry_delay_ms", alias = "phase2_group_create_retry_delay_ms")]
    pub redis_group_create_retry_delay_ms: u64,
    #[serde(default = "super::config_defaults::default_phase2_xreadgroup_retry_delay_ms", alias = "phase2_xreadgroup_retry_delay_ms")]
    pub redis_xreadgroup_retry_delay_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitsConfig {
    #[serde(default = "super::config_defaults::default_phase2_owner_ttl_base_seconds", alias = "phase2_owner_ttl_base_seconds")]
    pub redis_owner_ttl_base_seconds: u64,
    #[serde(default = "super::config_defaults::default_phase2_owner_ttl_divisor", alias = "phase2_owner_ttl_divisor")]
    pub redis_owner_ttl_divisor: u64,
    #[serde(default = "super::config_defaults::default_phase2_owner_ttl_min_seconds", alias = "phase2_owner_ttl_min_seconds")]
    pub redis_owner_ttl_min_seconds: u64,
    #[serde(default = "super::config_defaults::default_phase2_presence_ttl_min_seconds", alias = "phase2_presence_ttl_min_seconds")]
    pub redis_presence_ttl_min_seconds: u64,
    #[serde(default = "super::config_defaults::default_phase2_presence_ttl_divisor", alias = "phase2_presence_ttl_divisor")]
    pub redis_presence_ttl_divisor: u64,
    #[serde(default = "super::config_defaults::default_phase2_presence_ttl_absolute_min_seconds", alias = "phase2_presence_ttl_absolute_min_seconds")]
    pub redis_presence_ttl_absolute_min_seconds: u64,
    #[serde(default = "super::config_defaults::default_redis_min_count")]
    pub redis_min_count: usize,
    #[serde(default = "super::config_defaults::default_pool_min_count")]
    pub pool_min_count: u16,
    #[serde(default = "super::config_defaults::default_phase2_reclaim_interval_seconds", alias = "phase2_reclaim_interval_seconds")]
    pub redis_reclaim_interval_seconds: u64,
    #[serde(default = "super::config_defaults::default_phase2_dlq_scan_interval_min_ms", alias = "phase2_dlq_scan_interval_min_ms")]
    pub redis_dlq_scan_interval_min_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestingConfig {
    #[serde(default = "super::config_defaults::default_test_redis_url")]
    pub redis_url: String,
    #[serde(default = "super::config_defaults::default_test_service_catalog_url")]
    pub service_catalog_url: String,
    #[serde(default = "super::config_defaults::default_test_server_bind")]
    pub test_server_bind: String,
    #[serde(default = "super::config_defaults::default_test_dashboard_snapshot_ttl_seconds")]
    pub dashboard_snapshot_ttl_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceConfig {
    #[serde(default = "super::config_defaults::default_async_task_channel_capacity")]
    pub async_task_channel_capacity: usize,
    #[serde(default = "super::config_defaults::default_ws_connection_pool_initial_capacity")]
    pub ws_connection_pool_initial_capacity: usize,
    #[serde(default = "super::config_defaults::default_job_cache_initial_capacity")]
    pub job_cache_initial_capacity: usize,
    #[serde(default = "super::config_defaults::default_session_cache_initial_capacity")]
    pub session_cache_initial_capacity: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeveloperConfig {
    #[serde(default)]
    pub dev_mode: bool,
    #[serde(default = "super::config_defaults::default_true")]
    pub print_config_on_startup: bool,
    #[serde(default)]
    pub enable_config_hot_reload: bool,
}

impl Default for JobTimeoutPolicyConfig {
    fn default() -> Self {
        Self {
            pending_timeout_seconds: super::config_defaults::default_job_pending_timeout_seconds(),
            failover_max_attempts: super::config_defaults::default_job_failover_max_attempts(),
            scan_interval_ms: super::config_defaults::default_job_timeout_scan_interval_ms(),
            send_cancel: super::config_defaults::default_job_timeout_send_cancel(),
        }
    }
}

impl Default for CoreServicesConfig {
    fn default() -> Self {
        Self {
            asr_service_id: super::config_defaults::default_core_asr_service_id(),
            nmt_service_id: super::config_defaults::default_core_nmt_service_id(),
            tts_service_id: super::config_defaults::default_core_tts_service_id(),
        }
    }
}

impl Default for TaskBindingConfig {
    fn default() -> Self {
        Self {
            lease_seconds: super::config_defaults::default_task_binding_lease_seconds(),
            reserved_ttl_seconds: super::config_defaults::default_task_binding_reserved_ttl_seconds(),
            spread_enabled: false,
            spread_window_seconds: super::config_defaults::default_task_binding_spread_window_seconds(),
        }
    }
}

impl Default for EdgeStabilizationConfig {
    fn default() -> Self {
        Self {
            hangover_auto_ms: super::config_defaults::default_hangover_auto_ms(),
            hangover_manual_ms: super::config_defaults::default_hangover_manual_ms(),
            padding_auto_ms: super::config_defaults::default_padding_auto_ms(),
            padding_manual_ms: super::config_defaults::default_padding_manual_ms(),
            short_merge_threshold_ms: super::config_defaults::default_short_merge_threshold_ms(),
        }
    }
}

impl Default for WebTaskSegmentationConfig {
    fn default() -> Self {
        Self {
            pause_ms: super::config_defaults::default_web_pause_ms(),
            max_duration_ms: super::config_defaults::default_max_audio_duration_ms(),
            edge_stabilization: EdgeStabilizationConfig::default(),
        }
    }
}

impl Default for ModelNotAvailableConfig {
    fn default() -> Self {
        Self {
            unavailable_ttl_seconds: super::config_defaults::default_model_na_unavailable_ttl_seconds(),
            debounce_window_seconds: super::config_defaults::default_model_na_debounce_window_seconds(),
            node_ratelimit_window_seconds: super::config_defaults::default_model_na_node_ratelimit_window_seconds(),
            node_ratelimit_max: super::config_defaults::default_model_na_node_ratelimit_max(),
        }
    }
}

impl Default for FailureThreshold {
    fn default() -> Self {
        Self {
            window_size: 5,
            failure_count: 3,
            consecutive_failure_count: 3,
        }
    }
}

impl Default for NodeHealthConfig {
    fn default() -> Self {
        Self {
            heartbeat_interval_seconds: super::config_defaults::default_heartbeat_interval(),
            heartbeat_timeout_seconds: super::config_defaults::default_heartbeat_timeout(),
            health_check_count: super::config_defaults::default_health_check_count(),
            warmup_timeout_seconds: super::config_defaults::default_warmup_timeout(),
            failure_threshold: FailureThreshold::default(),
            status_scan_interval_seconds: super::config_defaults::default_status_scan_interval(),
        }
    }
}

impl Default for LoadBalancerConfig {
    fn default() -> Self {
        Self {
            strategy: super::config_defaults::default_load_balancer_strategy(),
            resource_threshold: super::config_defaults::default_resource_threshold(),
        }
    }
}

impl Default for ObservabilityConfig {
    fn default() -> Self {
        Self {
            lock_wait_warn_ms: super::config_defaults::default_obs_lock_wait_warn_ms(),
            path_warn_ms: super::config_defaults::default_obs_path_warn_ms(),
        }
    }
}

impl Default for AsrRerunConfig {
    fn default() -> Self {
        Self {
            max_rerun_count: super::config_defaults::default_asr_rerun_max_count(),
            rerun_timeout_ms: super::config_defaults::default_asr_rerun_timeout_ms(),
            conference_mode_strict: super::config_defaults::default_asr_rerun_conference_mode_strict(),
        }
    }
}

impl Default for BackgroundTasksConfig {
    fn default() -> Self {
        Self {
            preload_delay_seconds: super::config_defaults::default_preload_delay_seconds(),
            job_result_dedup_cleanup_interval_seconds: super::config_defaults::default_job_result_dedup_cleanup_interval_seconds(),
            session_cleanup_interval_seconds: super::config_defaults::default_session_cleanup_interval_seconds(),
            job_cleanup_interval_seconds: super::config_defaults::default_job_cleanup_interval_seconds(),
            session_active_result_check_interval_seconds: super::config_defaults::default_session_active_result_check_interval_seconds(),
            node_status_scan_interval_seconds: super::config_defaults::default_node_status_scan_interval_seconds(),
            dashboard_snapshot_cache_ttl_seconds: super::config_defaults::default_dashboard_snapshot_cache_ttl_seconds(),
        }
    }
}

impl Default for TimeoutsConfig {
    fn default() -> Self {
        Self {
            ws_message_preview_max_chars: super::config_defaults::default_ws_message_preview_max_chars(),
            redis_presence_wait_timeout_seconds: super::config_defaults::default_phase2_presence_wait_timeout_seconds(),
            redis_presence_check_interval_ms: super::config_defaults::default_phase2_presence_check_interval_ms(),
            redis_node_registration_timeout_seconds: super::config_defaults::default_phase2_node_registration_timeout_seconds(),
            redis_node_snapshot_sync_timeout_seconds: super::config_defaults::default_phase2_node_snapshot_sync_timeout_seconds(),
            redis_pool_config_sync_timeout_seconds: super::config_defaults::default_phase2_pool_config_sync_timeout_seconds(),
            redis_pool_config_check_interval_ms: super::config_defaults::default_phase2_pool_config_check_interval_ms(),
            ws_ack_timeout_seconds: super::config_defaults::default_ws_ack_timeout_seconds(),
            ws_translation_result_timeout_seconds: super::config_defaults::default_ws_translation_result_timeout_seconds(),
        }
    }
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            min_ttl_seconds: super::config_defaults::default_min_ttl_seconds(),
            min_ttl_ms: super::config_defaults::default_min_ttl_ms(),
            redis_stream_min_maxlen: super::config_defaults::default_redis_stream_min_maxlen(),
            pubsub_reconnect_delay_seconds: super::config_defaults::default_pubsub_reconnect_delay_seconds(),
            pubsub_keepalive_timeout_seconds: super::config_defaults::default_pubsub_keepalive_timeout_seconds(),
            node_cache_version_check_timeout_ms: super::config_defaults::default_node_cache_version_check_timeout_ms(),
            node_cache_miss_ttl_ms: super::config_defaults::default_node_cache_miss_ttl_ms(),
            job_min_attempt_id: super::config_defaults::default_job_min_attempt_id(),
            redis_group_create_retry_delay_ms: super::config_defaults::default_phase2_group_create_retry_delay_ms(),
            redis_xreadgroup_retry_delay_ms: super::config_defaults::default_phase2_xreadgroup_retry_delay_ms(),
        }
    }
}

impl Default for LimitsConfig {
    fn default() -> Self {
        Self {
            redis_owner_ttl_base_seconds: super::config_defaults::default_phase2_owner_ttl_base_seconds(),
            redis_owner_ttl_divisor: super::config_defaults::default_phase2_owner_ttl_divisor(),
            redis_owner_ttl_min_seconds: super::config_defaults::default_phase2_owner_ttl_min_seconds(),
            redis_presence_ttl_min_seconds: super::config_defaults::default_phase2_presence_ttl_min_seconds(),
            redis_presence_ttl_divisor: super::config_defaults::default_phase2_presence_ttl_divisor(),
            redis_presence_ttl_absolute_min_seconds: super::config_defaults::default_phase2_presence_ttl_absolute_min_seconds(),
            redis_min_count: super::config_defaults::default_redis_min_count(),
            pool_min_count: super::config_defaults::default_pool_min_count(),
            redis_reclaim_interval_seconds: super::config_defaults::default_phase2_reclaim_interval_seconds(),
            redis_dlq_scan_interval_min_ms: super::config_defaults::default_phase2_dlq_scan_interval_min_ms(),
        }
    }
}

impl Default for TestingConfig {
    fn default() -> Self {
        Self {
            redis_url: super::config_defaults::default_test_redis_url(),
            service_catalog_url: super::config_defaults::default_test_service_catalog_url(),
            test_server_bind: super::config_defaults::default_test_server_bind(),
            dashboard_snapshot_ttl_seconds: super::config_defaults::default_test_dashboard_snapshot_ttl_seconds(),
        }
    }
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            async_task_channel_capacity: super::config_defaults::default_async_task_channel_capacity(),
            ws_connection_pool_initial_capacity: super::config_defaults::default_ws_connection_pool_initial_capacity(),
            job_cache_initial_capacity: super::config_defaults::default_job_cache_initial_capacity(),
            session_cache_initial_capacity: super::config_defaults::default_session_cache_initial_capacity(),
        }
    }
}

impl Default for DeveloperConfig {
    fn default() -> Self {
        Self {
            dev_mode: false,
            print_config_on_startup: true,
            enable_config_hot_reload: false,
        }
    }
}
