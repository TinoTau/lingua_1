//! Job 动态 timeout 单元测试
//! 
//! 测试基于 expectedDurationMs 的动态 timeout 计算

use lingua_scheduler::core::dispatcher::{Job, JobStatus};
use lingua_scheduler::messages::PipelineConfig;

fn create_test_job(expected_duration_ms: Option<u64>) -> Job {
    Job {
        job_id: "test-job".to_string(),
        request_id: "test-request".to_string(),
        dispatched_to_node: false,
        dispatched_at_ms: None,
        failover_attempts: 0,
        dispatch_attempt_id: 0,
        session_id: "test-session".to_string(),
        utterance_index: 0,
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        dialect: None,
        features: None,
        pipeline: PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
            use_semantic: false,
            use_tone: false,
        },
        audio_data: vec![],
        audio_format: "pcm16".to_string(),
        sample_rate: 16000,
        assigned_node_id: None,
        status: JobStatus::Pending,
        created_at: chrono::Utc::now(),
        trace_id: "test-trace".to_string(),
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        target_session_ids: None,
        tenant_id: None,
        first_chunk_client_timestamp_ms: None,
        padding_ms: None,
        is_manual_cut: false,
        is_pause_triggered: false,
        is_timeout_triggered: false,
        expected_duration_ms,
    }
}

#[test]
fn test_dynamic_timeout_none() {
    // 测试 expected_duration_ms 为 None 时，使用 base timeout
    let job = create_test_job(None);
    let timeout = job.calculate_dynamic_timeout_seconds(30, 0.5);
    
    // 应该返回 base timeout
    assert_eq!(timeout, 30);
}

#[test]
fn test_dynamic_timeout_small_job() {
    // 测试小 job（expected_duration_ms = 1000ms = 1秒）
    let job = create_test_job(Some(1000));
    let timeout = job.calculate_dynamic_timeout_seconds(30, 0.5);
    
    // timeout = 30 + 1 * 0.5 = 30.5 秒，向上取整 = 31 秒
    // 但由于最小值限制（15秒），应该是 31 秒
    assert_eq!(timeout, 31);
}

#[test]
fn test_dynamic_timeout_medium_job() {
    // 测试中等 job（expected_duration_ms = 10000ms = 10秒）
    let job = create_test_job(Some(10000));
    let timeout = job.calculate_dynamic_timeout_seconds(30, 0.5);
    
    // timeout = 30 + 10 * 0.5 = 35 秒
    assert_eq!(timeout, 35);
}

#[test]
fn test_dynamic_timeout_large_job() {
    // 测试大 job（expected_duration_ms = 60000ms = 60秒）
    let job = create_test_job(Some(60000));
    let timeout = job.calculate_dynamic_timeout_seconds(30, 0.5);
    
    // timeout = 30 + 60 * 0.5 = 60 秒（达到最大值）
    assert_eq!(timeout, 60);
}

#[test]
fn test_dynamic_timeout_very_large_job() {
    // 测试超大 job（expected_duration_ms = 200000ms = 200秒）
    let job = create_test_job(Some(200000));
    let timeout = job.calculate_dynamic_timeout_seconds(30, 0.5);
    
    // timeout = 30 + 200 * 0.5 = 130 秒，但最大值限制为 60 秒
    assert_eq!(timeout, 60);
}

#[test]
fn test_dynamic_timeout_min_boundary() {
    // 测试最小值边界（expected_duration_ms 导致 timeout < 15 秒）
    let job = create_test_job(Some(100));
    let timeout = job.calculate_dynamic_timeout_seconds(10, 0.01);
    
    // timeout = 10 + 0.1 * 0.01 = 10.001 秒，但最小值限制为 15 秒
    assert_eq!(timeout, 15);
}

#[test]
fn test_dynamic_timeout_max_boundary() {
    // 测试最大值边界（expected_duration_ms 导致 timeout > 60 秒）
    let job = create_test_job(Some(100000));
    let timeout = job.calculate_dynamic_timeout_seconds(30, 0.5);
    
    // timeout = 30 + 100 * 0.5 = 80 秒，但最大值限制为 60 秒
    assert_eq!(timeout, 60);
}

#[test]
fn test_dynamic_timeout_different_base() {
    // 测试不同的 base timeout
    let job = create_test_job(Some(20000));
    
    // base = 20, factor = 0.5
    let timeout1 = job.calculate_dynamic_timeout_seconds(20, 0.5);
    assert_eq!(timeout1, 30); // 20 + 20 * 0.5 = 30
    
    // base = 40, factor = 0.5
    let timeout2 = job.calculate_dynamic_timeout_seconds(40, 0.5);
    assert_eq!(timeout2, 50); // 40 + 20 * 0.5 = 50
}

#[test]
fn test_dynamic_timeout_different_factor() {
    // 测试不同的 factor
    let job = create_test_job(Some(20000));
    
    // base = 30, factor = 0.3
    let timeout1 = job.calculate_dynamic_timeout_seconds(30, 0.3);
    assert_eq!(timeout1, 36); // 30 + 20 * 0.3 = 36
    
    // base = 30, factor = 0.7
    let timeout2 = job.calculate_dynamic_timeout_seconds(30, 0.7);
    assert_eq!(timeout2, 44); // 30 + 20 * 0.7 = 44
}
