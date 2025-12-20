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
    AsrOnly,
    /// 仅翻译（ASR + NMT）
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
#[derive(Clone)]
pub struct JobIdempotencyManager {
    /// job_key -> (job_id, created_at_ms)
    mappings: Arc<RwLock<HashMap<JobKey, (String, i64)>>>,
    /// TTL（毫秒），默认 5 分钟
    ttl_ms: i64,
}

impl JobIdempotencyManager {
    pub fn new() -> Self {
        Self {
            mappings: Arc::new(RwLock::new(HashMap::new())),
            ttl_ms: 5 * 60 * 1000, // 5 分钟
        }
    }

    pub fn new_with_ttl(ttl_seconds: u64) -> Self {
        Self {
            mappings: Arc::new(RwLock::new(HashMap::new())),
            ttl_ms: (ttl_seconds * 1000) as i64,
        }
    }

    /// 获取或创建 job_id（幂等）
    /// 如果 job_key 已存在，返回已存在的 job_id
    /// 如果不存在，创建新的映射并返回 job_id
    pub async fn get_or_create_job_id(&self, job_key: &JobKey, job_id: String) -> String {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut mappings = self.mappings.write().await;

        // 清理过期项
        self.cleanup_expired(&mut mappings, now_ms);

        // 检查是否已存在
        if let Some((existing_job_id, _)) = mappings.get(job_key) {
            return existing_job_id.clone();
        }

        // 创建新映射
        mappings.insert(job_key.clone(), (job_id.clone(), now_ms));
        job_id
    }

    /// 检查 job_key 是否已存在
    pub async fn exists(&self, job_key: &JobKey) -> bool {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mappings = self.mappings.read().await;

        if let Some((_, created_at)) = mappings.get(job_key) {
            // 检查是否过期
            if now_ms - *created_at < self.ttl_ms {
                return true;
            }
        }
        false
    }

    /// 获取 job_id（如果存在）
    pub async fn get_job_id(&self, job_key: &JobKey) -> Option<String> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mappings = self.mappings.read().await;

        if let Some((job_id, created_at)) = mappings.get(job_key) {
            // 检查是否过期
            if now_ms - *created_at < self.ttl_ms {
                return Some(job_id.clone());
            }
        }
        None
    }

    /// 清理过期项
    fn cleanup_expired(&self, mappings: &mut HashMap<JobKey, (String, i64)>, now_ms: i64) {
        mappings.retain(|_, (_, created_at)| {
            now_ms - *created_at < self.ttl_ms
        });
    }

    /// 手动清理过期项（用于定期清理任务）
    pub async fn cleanup(&self) {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut mappings = self.mappings.write().await;
        self.cleanup_expired(&mut mappings, now_ms);
    }
}

impl Default for JobIdempotencyManager {
    fn default() -> Self {
        Self::new()
    }
}

