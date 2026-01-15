// Job 幂等键管理模块
// 实现统一的 job_key 机制，用于防止重复创建 job

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;

/// Job 幂等键
/// 格式：{tenant_id}:{session_id}:{utterance_index}:{job_type}:{tgt_lang}:{features_hash}
pub type JobKey = String;

/// Job 类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum JobType {
    /// 翻译任务（ASR + NMT + TTS）
    Translation,
    /// 仅 ASR
    #[allow(dead_code)]
    AsrOnly,
    /// 仅翻译（ASR + NMT）
    #[allow(dead_code)]
    TranslationOnly,
}

impl JobType {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobType::Translation => "translation",
            JobType::AsrOnly => "asr_only",
            JobType::TranslationOnly => "translation_only",
        }
    }
}

/// 生成 Job Key
pub fn make_job_key(
    tenant_id: Option<&str>,
    session_id: &str,
    utterance_index: u64,
    job_type: JobType,
    tgt_lang: &str,
    features: Option<&crate::messages::FeatureFlags>,
) -> JobKey {
    // 计算 features hash
    let features_hash = if let Some(features) = features {
        let mut hasher = DefaultHasher::new();
        // 序列化 features 并计算 hash
        // 简化实现：使用 features 的字符串表示
        format!("{:?}", features).hash(&mut hasher);
        format!("{:x}", hasher.finish())
    } else {
        "none".to_string()
    };

    let tenant_part = tenant_id.unwrap_or("default");
    format!(
        "{}:{}:{}:{}:{}:{}",
        tenant_part,
        session_id,
        utterance_index,
        job_type.as_str(),
        tgt_lang,
        features_hash
    )
}

/// Job Key 到 Job ID 的映射管理器
/// 已移除本地锁，改用 Phase2 的 Redis 实现
#[derive(Clone)]
pub struct JobIdempotencyManager {
    /// Phase2 运行时（可选）
    phase2: Option<std::sync::Arc<crate::phase2::Phase2Runtime>>,
    /// TTL（毫秒），默认 5 分钟
    ttl_ms: i64,
}

impl JobIdempotencyManager {
    pub fn new() -> Self {
        Self {
            phase2: None,
            ttl_ms: 5 * 60 * 1000, // 5 分钟
        }
    }

    pub fn set_phase2(&mut self, phase2: Option<std::sync::Arc<crate::phase2::Phase2Runtime>>) {
        self.phase2 = phase2;
    }

    /// 获取或创建 job_id（幂等）
    /// 如果 job_key 已存在，返回已存在的 job_id
    /// 如果不存在，创建新的映射并返回 job_id
    /// 注意：当前实现使用 job_key 作为 request_id，通过 Phase2 的 request_binding 实现幂等
    pub async fn get_or_create_job_id(&self, job_key: &JobKey, job_id: String) -> String {
        // 如果 Phase2 可用，使用 Redis 存储
        if let Some(ref rt) = self.phase2 {
            // 使用 job_key 作为 request_id，通过 request_binding 实现幂等
            if let Some(binding) = rt.get_request_binding(job_key).await {
                return binding.job_id;
            }
            // 创建新的 request_binding
            let ttl_seconds = (self.ttl_ms / 1000) as u64;
            rt.set_request_binding(job_key, &job_id, None, ttl_seconds, false).await;
            return job_id;
        }
        // Phase2 不可用时，直接返回 job_id（无幂等保护）
        job_id
    }

    /// 获取 job_id（如果存在）
    pub async fn get_job_id(&self, job_key: &JobKey) -> Option<String> {
        // 如果 Phase2 可用，从 Redis 读取
        if let Some(ref rt) = self.phase2 {
            if let Some(binding) = rt.get_request_binding(job_key).await {
                return Some(binding.job_id);
            }
        }
        None
    }
}

impl Default for JobIdempotencyManager {
    fn default() -> Self {
        Self::new()
    }
}

