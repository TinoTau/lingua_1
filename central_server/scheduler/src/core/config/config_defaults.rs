use super::config_types::*;
use std::path::PathBuf;

// Phase3 所有默认值函数已删除

pub fn default_true() -> bool {
    true
}

// Phase 2 默认值函数
pub fn default_phase2_instance_id() -> String {
    "auto".to_string()
}

pub fn default_phase2_owner_ttl_seconds() -> u64 {
    45
}

pub fn default_phase2_stream_block_ms() -> u64 {
    1000
}

pub fn default_phase2_stream_count() -> usize {
    64
}

pub fn default_phase2_stream_group() -> String {
    "scheduler".to_string()
}

pub fn default_phase2_stream_maxlen() -> usize {
    10_000
}

pub fn default_phase2_dlq_maxlen() -> usize {
    10_000
}

pub fn default_phase2_dlq_max_deliveries() -> u64 {
    10
}

pub fn default_phase2_dlq_min_idle_ms() -> u64 {
    60_000
}

pub fn default_phase2_dlq_scan_interval_ms() -> u64 {
    5000
}

pub fn default_phase2_dlq_scan_count() -> usize {
    100
}

impl Default for Phase2Config {
    fn default() -> Self {
        Self {
            enabled: true,  // 默认启用 Phase2
            instance_id: default_phase2_instance_id(),
            redis: Phase2RedisConfig::default(),
            owner_ttl_seconds: default_phase2_owner_ttl_seconds(),
            stream_block_ms: default_phase2_stream_block_ms(),
            stream_count: default_phase2_stream_count(),
            stream_group: default_phase2_stream_group(),
            stream_maxlen: default_phase2_stream_maxlen(),
            dlq_enabled: true,
            dlq_maxlen: default_phase2_dlq_maxlen(),
            dlq_max_deliveries: default_phase2_dlq_max_deliveries(),
            dlq_min_idle_ms: default_phase2_dlq_min_idle_ms(),
            dlq_scan_interval_ms: default_phase2_dlq_scan_interval_ms(),
            dlq_scan_count: default_phase2_dlq_scan_count(),
            node_snapshot: Phase2NodeSnapshotConfig::default(),
            schema_compat: Phase2SchemaCompatConfig::default(),
        }
    }
}

pub fn default_phase2_stats_snapshot_ttl_seconds() -> u64 {
    60
}

pub fn default_phase2_stats_snapshot_interval_ms() -> u64 {
    5000
}

pub fn default_phase2_session_bind_ttl_seconds() -> u64 {
    3600
}

impl Default for Phase2SchemaCompatConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            stats_snapshot_enabled: false,
            stats_snapshot_ttl_seconds: default_phase2_stats_snapshot_ttl_seconds(),
            stats_snapshot_interval_ms: default_phase2_stats_snapshot_interval_ms(),
            node_caps_enabled: false,
            node_caps_ttl_seconds: 0,
            session_bind_enabled: false,
            session_bind_ttl_seconds: default_phase2_session_bind_ttl_seconds(),
        }
    }
}

pub fn default_phase2_node_snapshot_enabled() -> bool {
    true
}

pub fn default_phase2_node_presence_ttl_seconds() -> u64 {
    45
}

pub fn default_phase2_node_refresh_interval_ms() -> u64 {
    2000
}

pub fn default_phase2_node_remove_stale_after_seconds() -> u64 {
    600
}

impl Default for Phase2NodeSnapshotConfig {
    fn default() -> Self {
        Self {
            enabled: default_phase2_node_snapshot_enabled(),
            presence_ttl_seconds: default_phase2_node_presence_ttl_seconds(),
            refresh_interval_ms: default_phase2_node_refresh_interval_ms(),
            remove_stale_after_seconds: default_phase2_node_remove_stale_after_seconds(),
        }
    }
}

pub fn default_phase2_redis_mode() -> String {
    "single".to_string()
}

pub fn default_phase2_redis_url() -> String {
    "redis://127.0.0.1:6379".to_string()
}

pub fn default_phase2_key_prefix() -> String {
    "lingua".to_string()
}

impl Default for Phase2RedisConfig {
    fn default() -> Self {
        Self {
            mode: default_phase2_redis_mode(),
            url: default_phase2_redis_url(),
            cluster_urls: Vec::new(),
            key_prefix: default_phase2_key_prefix(),
        }
    }
}

// Job Timeout 默认值函数
pub fn default_job_pending_timeout_seconds() -> u64 {
    10
}

pub fn default_job_failover_max_attempts() -> u32 {
    3
}

pub fn default_job_timeout_scan_interval_ms() -> u64 {
    1000
}

pub fn default_job_timeout_send_cancel() -> bool {
    true
}

impl Default for JobTimeoutPolicyConfig {
    fn default() -> Self {
        Self {
            pending_timeout_seconds: default_job_pending_timeout_seconds(),
            failover_max_attempts: default_job_failover_max_attempts(),
            scan_interval_ms: default_job_timeout_scan_interval_ms(),
            send_cancel: default_job_timeout_send_cancel(),
        }
    }
}

// Core Services 默认值函数
pub fn default_core_asr_service_id() -> String {
    "node-inference".to_string()
}

pub fn default_core_nmt_service_id() -> String {
    "nmt-m2m100".to_string()
}

pub fn default_core_tts_service_id() -> String {
    "piper-tts".to_string()
}

impl Default for CoreServicesConfig {
    fn default() -> Self {
        Self {
            asr_service_id: default_core_asr_service_id(),
            nmt_service_id: default_core_nmt_service_id(),
            tts_service_id: default_core_tts_service_id(),
        }
    }
}

// Task Binding 默认值函数
pub fn default_task_binding_lease_seconds() -> u64 {
    90
}

pub fn default_task_binding_reserved_ttl_seconds() -> u64 {
    90
}

pub fn default_task_binding_spread_window_seconds() -> u64 {
    30
}

impl Default for TaskBindingConfig {
    fn default() -> Self {
        Self {
            lease_seconds: default_task_binding_lease_seconds(),
            reserved_ttl_seconds: default_task_binding_reserved_ttl_seconds(),
            spread_enabled: false,
            spread_window_seconds: default_task_binding_spread_window_seconds(),
        }
    }
}

// Web Task Segmentation 默认值函数
pub fn default_web_pause_ms() -> u64 {
    3000  // 3秒（已修复：从5秒减少到3秒，与Web端静音超时保持一致）
}

pub fn default_max_audio_duration_ms() -> u64 {
    10000  // 10秒（最大音频时长限制，从20秒缩短为10秒，便于更快切分长句）
}

impl Default for WebTaskSegmentationConfig {
    fn default() -> Self {
        Self { 
            pause_ms: default_web_pause_ms(),
            max_duration_ms: default_max_audio_duration_ms(),
            edge_stabilization: EdgeStabilizationConfig::default(),
        }
    }
}

// Edge Stabilization 默认值函数
pub fn default_hangover_auto_ms() -> u64 {
    150  // 自动 finalize：150ms
}

pub fn default_hangover_manual_ms() -> u64 {
    200  // 手动截断：200ms
}

pub fn default_padding_auto_ms() -> u64 {
    220  // 自动 finalize：220ms
}

pub fn default_padding_manual_ms() -> u64 {
    280  // 手动截断：280ms
}

pub fn default_short_merge_threshold_ms() -> u64 {
    400  // <400ms 片段合并
}

impl Default for EdgeStabilizationConfig {
    fn default() -> Self {
        Self {
            hangover_auto_ms: default_hangover_auto_ms(),
            hangover_manual_ms: default_hangover_manual_ms(),
            padding_auto_ms: default_padding_auto_ms(),
            padding_manual_ms: default_padding_manual_ms(),
            short_merge_threshold_ms: default_short_merge_threshold_ms(),
        }
    }
}

// Model Not Available 默认值函数
pub fn default_model_na_unavailable_ttl_seconds() -> u64 {
    60
}

pub fn default_model_na_debounce_window_seconds() -> u64 {
    5
}

pub fn default_model_na_node_ratelimit_window_seconds() -> u64 {
    10
}

pub fn default_model_na_node_ratelimit_max() -> u32 {
    30
}

impl Default for ModelNotAvailableConfig {
    fn default() -> Self {
        Self {
            unavailable_ttl_seconds: default_model_na_unavailable_ttl_seconds(),
            debounce_window_seconds: default_model_na_debounce_window_seconds(),
            node_ratelimit_window_seconds: default_model_na_node_ratelimit_window_seconds(),
            node_ratelimit_max: default_model_na_node_ratelimit_max(),
        }
    }
}

// Node Health 默认值函数
pub fn default_heartbeat_interval() -> u64 {
    15
}

pub fn default_heartbeat_timeout() -> u64 {
    45
}

pub fn default_health_check_count() -> usize {
    1  // 1次心跳即可变为 Ready，加快节点可用速度
}

pub fn default_warmup_timeout() -> u64 {
    60
}

pub fn default_failure_threshold() -> FailureThreshold {
    FailureThreshold {
        window_size: 5,
        failure_count: 3,
        consecutive_failure_count: 3,
    }
}

pub fn default_status_scan_interval() -> u64 {
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

// Load Balancer 默认值函数
pub fn default_resource_threshold() -> f32 {
    85.0 // 默认 85%（CPU、GPU、内存使用率超过此值将被跳过）
}

pub fn default_load_balancer_strategy() -> String {
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

// Observability 默认值函数
pub fn default_obs_lock_wait_warn_ms() -> u64 {
    10
}

pub fn default_obs_path_warn_ms() -> u64 {
    50
}

impl Default for ObservabilityConfig {
    fn default() -> Self {
        Self {
            lock_wait_warn_ms: default_obs_lock_wait_warn_ms(),
            path_warn_ms: default_obs_path_warn_ms(),
        }
    }
}

// ASR Rerun 默认值函数
pub fn default_asr_rerun_max_count() -> u32 {
    2
}

pub fn default_asr_rerun_timeout_ms() -> u64 {
    5000
}

pub fn default_asr_rerun_conference_mode_strict() -> bool {
    true
}

impl Default for AsrRerunConfig {
    fn default() -> Self {
        Self {
            max_rerun_count: default_asr_rerun_max_count(),
            rerun_timeout_ms: default_asr_rerun_timeout_ms(),
            conference_mode_strict: default_asr_rerun_conference_mode_strict(),
        }
    }
}

// Config 默认值
impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                port: 5010,
                host: "0.0.0.0".to_string(),
            },
            model_hub: ModelHubConfig {
                base_url: "http://localhost:5000".to_string(),
                // 默认指向 repo 内 ModelHub 服务包索引目录（可在 config.toml 覆盖）
                // 期望存在 services_index.json（用于 Scheduler 单机冷启动/离线兜底）
                storage_path: PathBuf::from("../model-hub/models/services"),
            },
            scheduler: SchedulerConfig::default(),
        }
    }
}

// SchedulerConfig 默认值
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
            phase2: Phase2Config::default(),
            // phase3: 已删除
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

// ========================================
// 新增默认值函数（消除硬编码）
// ========================================

// BackgroundTasksConfig 默认值函数
pub fn default_preload_delay_seconds() -> u64 { 1 }
pub fn default_job_result_dedup_cleanup_interval_seconds() -> u64 { 30 }
pub fn default_session_cleanup_interval_seconds() -> u64 { 60 }
pub fn default_job_cleanup_interval_seconds() -> u64 { 60 }
pub fn default_session_active_result_check_interval_seconds() -> u64 { 1 }
pub fn default_node_status_scan_interval_seconds() -> u64 { 60 }
pub fn default_dashboard_snapshot_cache_ttl_seconds() -> u64 { 5 }

impl Default for BackgroundTasksConfig {
    fn default() -> Self {
        Self {
            preload_delay_seconds: default_preload_delay_seconds(),
            job_result_dedup_cleanup_interval_seconds: default_job_result_dedup_cleanup_interval_seconds(),
            session_cleanup_interval_seconds: default_session_cleanup_interval_seconds(),
            job_cleanup_interval_seconds: default_job_cleanup_interval_seconds(),
            session_active_result_check_interval_seconds: default_session_active_result_check_interval_seconds(),
            node_status_scan_interval_seconds: default_node_status_scan_interval_seconds(),
            dashboard_snapshot_cache_ttl_seconds: default_dashboard_snapshot_cache_ttl_seconds(),
        }
    }
}

// TimeoutsConfig 默认值函数
pub fn default_ws_message_preview_max_chars() -> usize { 500 }
pub fn default_phase2_presence_wait_timeout_seconds() -> u64 { 3 }
pub fn default_phase2_presence_check_interval_ms() -> u64 { 50 }
pub fn default_phase2_node_registration_timeout_seconds() -> u64 { 2 }
pub fn default_phase2_node_snapshot_sync_timeout_seconds() -> u64 { 3 }
pub fn default_phase2_pool_config_sync_timeout_seconds() -> u64 { 5 }
pub fn default_phase2_pool_config_check_interval_ms() -> u64 { 100 }
pub fn default_ws_ack_timeout_seconds() -> u64 { 3 }
pub fn default_ws_translation_result_timeout_seconds() -> u64 { 5 }

impl Default for TimeoutsConfig {
    fn default() -> Self {
        Self {
            ws_message_preview_max_chars: default_ws_message_preview_max_chars(),
            phase2_presence_wait_timeout_seconds: default_phase2_presence_wait_timeout_seconds(),
            phase2_presence_check_interval_ms: default_phase2_presence_check_interval_ms(),
            phase2_node_registration_timeout_seconds: default_phase2_node_registration_timeout_seconds(),
            phase2_node_snapshot_sync_timeout_seconds: default_phase2_node_snapshot_sync_timeout_seconds(),
            phase2_pool_config_sync_timeout_seconds: default_phase2_pool_config_sync_timeout_seconds(),
            phase2_pool_config_check_interval_ms: default_phase2_pool_config_check_interval_ms(),
            ws_ack_timeout_seconds: default_ws_ack_timeout_seconds(),
            ws_translation_result_timeout_seconds: default_ws_translation_result_timeout_seconds(),
        }
    }
}

// RetryConfig 默认值函数
pub fn default_min_ttl_seconds() -> u64 { 1 }
pub fn default_min_ttl_ms() -> u64 { 1 }
pub fn default_redis_stream_min_maxlen() -> usize { 100 }
pub fn default_pubsub_reconnect_delay_seconds() -> u64 { 5 }
pub fn default_pubsub_keepalive_timeout_seconds() -> u64 { 3600 }
pub fn default_node_cache_version_check_timeout_ms() -> u64 { 100 }
pub fn default_node_cache_miss_ttl_ms() -> i64 { 10 }
pub fn default_job_min_attempt_id() -> u32 { 1 }
pub fn default_phase2_group_create_retry_delay_ms() -> u64 { 500 }
pub fn default_phase2_xreadgroup_retry_delay_ms() -> u64 { 300 }

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            min_ttl_seconds: default_min_ttl_seconds(),
            min_ttl_ms: default_min_ttl_ms(),
            redis_stream_min_maxlen: default_redis_stream_min_maxlen(),
            pubsub_reconnect_delay_seconds: default_pubsub_reconnect_delay_seconds(),
            pubsub_keepalive_timeout_seconds: default_pubsub_keepalive_timeout_seconds(),
            node_cache_version_check_timeout_ms: default_node_cache_version_check_timeout_ms(),
            node_cache_miss_ttl_ms: default_node_cache_miss_ttl_ms(),
            job_min_attempt_id: default_job_min_attempt_id(),
            phase2_group_create_retry_delay_ms: default_phase2_group_create_retry_delay_ms(),
            phase2_xreadgroup_retry_delay_ms: default_phase2_xreadgroup_retry_delay_ms(),
        }
    }
}

// LimitsConfig 默认值函数
pub fn default_phase2_owner_ttl_base_seconds() -> u64 { 10 }
pub fn default_phase2_owner_ttl_divisor() -> u64 { 2 }
pub fn default_phase2_owner_ttl_min_seconds() -> u64 { 5 }
pub fn default_phase2_presence_ttl_min_seconds() -> u64 { 2 }
pub fn default_phase2_presence_ttl_divisor() -> u64 { 2 }
pub fn default_phase2_presence_ttl_absolute_min_seconds() -> u64 { 1 }
pub fn default_redis_min_count() -> usize { 1 }
pub fn default_pool_min_count() -> u16 { 1 }
pub fn default_phase2_reclaim_interval_seconds() -> u64 { 5 }
pub fn default_phase2_dlq_scan_interval_min_ms() -> u64 { 1000 }

impl Default for LimitsConfig {
    fn default() -> Self {
        Self {
            phase2_owner_ttl_base_seconds: default_phase2_owner_ttl_base_seconds(),
            phase2_owner_ttl_divisor: default_phase2_owner_ttl_divisor(),
            phase2_owner_ttl_min_seconds: default_phase2_owner_ttl_min_seconds(),
            phase2_presence_ttl_min_seconds: default_phase2_presence_ttl_min_seconds(),
            phase2_presence_ttl_divisor: default_phase2_presence_ttl_divisor(),
            phase2_presence_ttl_absolute_min_seconds: default_phase2_presence_ttl_absolute_min_seconds(),
            redis_min_count: default_redis_min_count(),
            pool_min_count: default_pool_min_count(),
            phase2_reclaim_interval_seconds: default_phase2_reclaim_interval_seconds(),
            phase2_dlq_scan_interval_min_ms: default_phase2_dlq_scan_interval_min_ms(),
        }
    }
}

// TestingConfig 默认值函数
pub fn default_test_redis_url() -> String { "redis://127.0.0.1:6379".to_string() }
pub fn default_test_service_catalog_url() -> String { "http://127.0.0.1:0".to_string() }
pub fn default_test_server_bind() -> String { "127.0.0.1:0".to_string() }
pub fn default_test_dashboard_snapshot_ttl_seconds() -> u64 { 3600 }

impl Default for TestingConfig {
    fn default() -> Self {
        Self {
            redis_url: default_test_redis_url(),
            service_catalog_url: default_test_service_catalog_url(),
            test_server_bind: default_test_server_bind(),
            dashboard_snapshot_ttl_seconds: default_test_dashboard_snapshot_ttl_seconds(),
        }
    }
}

// PerformanceConfig 默认值函数
pub fn default_async_task_channel_capacity() -> usize { 1000 }
pub fn default_ws_connection_pool_initial_capacity() -> usize { 100 }
pub fn default_job_cache_initial_capacity() -> usize { 1000 }
pub fn default_session_cache_initial_capacity() -> usize { 500 }

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            async_task_channel_capacity: default_async_task_channel_capacity(),
            ws_connection_pool_initial_capacity: default_ws_connection_pool_initial_capacity(),
            job_cache_initial_capacity: default_job_cache_initial_capacity(),
            session_cache_initial_capacity: default_session_cache_initial_capacity(),
        }
    }
}

// DeveloperConfig 默认值函数
impl Default for DeveloperConfig {
    fn default() -> Self {
        Self {
            dev_mode: false,
            print_config_on_startup: true,
            enable_config_hot_reload: false,
        }
    }
}

