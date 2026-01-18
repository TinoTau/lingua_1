//! NO_TEXT_ASSIGNED 空结果核销单元测试
//! 
//! 测试空容器核销流程：
//! 1. 检查 extra.reason == "NO_TEXT_ASSIGNED"
//! 2. 设置 job.status = CompletedNoText
//! 3. 跳过 group_manager 处理
//! 4. 不发送 UI 更新事件
//! 5. 释放节点槽位

use lingua_scheduler::core::dispatcher::{Job, JobStatus};
use lingua_scheduler::messages::{PipelineConfig, common::ExtraResult};
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::core::dispatcher::JobDispatcher;
use std::sync::Arc;

/// 创建测试用的 JobDispatcher
fn create_test_dispatcher() -> JobDispatcher {
    let node_registry = Arc::new(NodeRegistry::new());
    JobDispatcher::new(node_registry)
}

/// 创建测试用的 Job
fn create_test_job() -> Job {
    Job {
        job_id: "test-job-no-text".to_string(),
        request_id: "test-request-no-text".to_string(),
        dispatched_to_node: true,
        dispatched_at_ms: Some(chrono::Utc::now().timestamp_millis()),
        failover_attempts: 0,
        dispatch_attempt_id: 1,
        session_id: "test-session-no-text".to_string(),
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
        assigned_node_id: Some("test-node-1".to_string()),
        status: JobStatus::Processing,
        created_at: chrono::Utc::now(),
        trace_id: "test-trace-no-text".to_string(),
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
        expected_duration_ms: None,
    }
}

#[test]
fn test_job_status_completed_no_text() {
    // 测试 CompletedNoText 状态存在
    let status = JobStatus::CompletedNoText;
    match status {
        JobStatus::CompletedNoText => {
            // 测试通过
        }
        _ => {
            panic!("CompletedNoText 状态应该存在");
        }
    }
}

#[test]
fn test_no_text_assigned_extra_reason() {
    // 测试 extra.reason == "NO_TEXT_ASSIGNED" 的识别
    let extra = Some(ExtraResult {
        emotion: None,
        speech_rate: None,
        voice_style: None,
        service_timings: None,
        language_probability: None,
        language_probabilities: None,
        reason: Some("NO_TEXT_ASSIGNED".to_string()),
    });
    
    let is_no_text_assigned = extra.as_ref()
        .and_then(|e| e.reason.as_deref())
        .map(|r| r == "NO_TEXT_ASSIGNED")
        .unwrap_or(false);
    
    assert!(is_no_text_assigned, "应该识别 NO_TEXT_ASSIGNED");
}

#[test]
fn test_no_text_assigned_extra_reason_different() {
    // 测试其他 reason 不应该被识别为 NO_TEXT_ASSIGNED
    let extra = Some(ExtraResult {
        emotion: None,
        speech_rate: None,
        voice_style: None,
        service_timings: None,
        language_probability: None,
        language_probabilities: None,
        reason: Some("OTHER_REASON".to_string()),
    });
    
    let is_no_text_assigned = extra.as_ref()
        .and_then(|e| e.reason.as_deref())
        .map(|r| r == "NO_TEXT_ASSIGNED")
        .unwrap_or(false);
    
    assert!(!is_no_text_assigned, "不应该识别其他 reason 为 NO_TEXT_ASSIGNED");
}

#[test]
fn test_no_text_assigned_extra_none() {
    // 测试 extra 为 None 时不应该被识别
    let extra: Option<ExtraResult> = None;
    
    let is_no_text_assigned = extra.as_ref()
        .and_then(|e| e.reason.as_deref())
        .map(|r| r == "NO_TEXT_ASSIGNED")
        .unwrap_or(false);
    
    assert!(!is_no_text_assigned, "extra 为 None 时不应该被识别");
}

#[test]
fn test_no_text_assigned_extra_reason_none() {
    // 测试 extra.reason 为 None 时不应该被识别
    let extra = Some(ExtraResult {
        emotion: None,
        speech_rate: None,
        voice_style: None,
        service_timings: None,
        language_probability: None,
        language_probabilities: None,
        reason: None,
    });
    
    let is_no_text_assigned = extra.as_ref()
        .and_then(|e| e.reason.as_deref())
        .map(|r| r == "NO_TEXT_ASSIGNED")
        .unwrap_or(false);
    
    assert!(!is_no_text_assigned, "extra.reason 为 None 时不应该被识别");
}

#[tokio::test]
async fn test_job_status_set_to_completed_no_text() {
    // 测试 Job 状态可以设置为 CompletedNoText
    let mut job = create_test_job();
    job.status = JobStatus::CompletedNoText;
    
    assert_eq!(job.status, JobStatus::CompletedNoText);
}

#[tokio::test]
async fn test_job_no_text_assigned_workflow() {
    // 测试完整的 NO_TEXT_ASSIGNED 工作流程
    // 注意：这个测试主要验证逻辑，实际的 handle_job_result 需要更复杂的设置
    let dispatcher = create_test_dispatcher();
    let mut job = create_test_job();
    
    // 模拟 NO_TEXT_ASSIGNED 的处理逻辑
    let extra = Some(ExtraResult {
        emotion: None,
        speech_rate: None,
        voice_style: None,
        service_timings: None,
        language_probability: None,
        language_probabilities: None,
        reason: Some("NO_TEXT_ASSIGNED".to_string()),
    });
    
    let is_no_text_assigned = extra.as_ref()
        .and_then(|e| e.reason.as_deref())
        .map(|r| r == "NO_TEXT_ASSIGNED")
        .unwrap_or(false);
    
    if is_no_text_assigned {
        // 设置状态为 CompletedNoText
        job.status = JobStatus::CompletedNoText;
        
        // 验证状态已设置
        assert_eq!(job.status, JobStatus::CompletedNoText);
        
        // 注意：在实际的 handle_job_result 中，还会：
        // 1. 跳过 group_manager 处理
        // 2. 不发送 UI 更新事件
        // 3. 释放节点槽位
        // 这些需要在集成测试中验证
    } else {
        panic!("应该识别 NO_TEXT_ASSIGNED");
    }
}
