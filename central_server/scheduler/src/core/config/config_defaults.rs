use super::config_types_scheduler::FailureThreshold;

// Phase3 所有默认值函数已删除

pub fn default_true() -> bool {
    true
}

// Redis 运行时默认值
pub fn default_redis_runtime_instance_id() -> String {
    "auto".to_string()
}

pub fn default_redis_runtime_owner_ttl_seconds() -> u64 {
    45
}

pub fn default_redis_runtime_stream_block_ms() -> u64 {
    1000
}

pub fn default_redis_runtime_stream_count() -> usize {
    64
}

pub fn default_redis_runtime_stream_group() -> String {
    "scheduler".to_string()
}

pub fn default_redis_runtime_stream_maxlen() -> usize {
    10_000
}

pub fn default_redis_runtime_dlq_maxlen() -> usize {
    10_000
}

pub fn default_redis_runtime_dlq_max_deliveries() -> u64 {
    10
}

pub fn default_redis_runtime_dlq_min_idle_ms() -> u64 {
    60_000
}

pub fn default_redis_runtime_dlq_scan_interval_ms() -> u64 {
    5000
}

pub fn default_redis_runtime_dlq_scan_count() -> usize {
    100
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

pub fn default_phase2_redis_mode() -> String {
    "single".to_string()
}

pub fn default_phase2_redis_url() -> String {
    "redis://127.0.0.1:6379".to_string()
}

pub fn default_phase2_key_prefix() -> String {
    "lingua".to_string()
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

// Web Task Segmentation 默认值函数
pub fn default_web_pause_ms() -> u64 {
    3000  // 3秒（已修复：从5秒减少到3秒，与Web端静音超时保持一致）
}

pub fn default_max_audio_duration_ms() -> u64 {
    10000  // 10秒（最大音频时长限制，从20秒缩短为10秒，便于更快切分长句）
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

// Load Balancer 默认值函数
pub fn default_resource_threshold() -> f32 {
    85.0 // 默认 85%（CPU、GPU、内存使用率超过此值将被跳过）
}

pub fn default_load_balancer_strategy() -> String {
    "least_connections".to_string()
}

// Observability 默认值函数
pub fn default_obs_lock_wait_warn_ms() -> u64 {
    10
}

pub fn default_obs_path_warn_ms() -> u64 {
    50
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

// TestingConfig 默认值函数
pub fn default_test_redis_url() -> String { "redis://127.0.0.1:6379".to_string() }
pub fn default_test_service_catalog_url() -> String { "http://127.0.0.1:0".to_string() }
pub fn default_test_server_bind() -> String { "127.0.0.1:0".to_string() }
pub fn default_test_dashboard_snapshot_ttl_seconds() -> u64 { 3600 }

// PerformanceConfig 默认值函数
pub fn default_async_task_channel_capacity() -> usize { 1000 }
pub fn default_ws_connection_pool_initial_capacity() -> usize { 100 }
pub fn default_job_cache_initial_capacity() -> usize { 1000 }
pub fn default_session_cache_initial_capacity() -> usize { 500 }

