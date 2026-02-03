// Job 幂等键管理模块
// 实现统一的 job_key 机制，用于防止重复创建 job

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
}

impl JobType {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobType::Translation => "translation",
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
/// 已移除本地锁，改用 Redis 实现
#[derive(Clone)]
pub struct JobIdempotencyManager {
    redis_runtime: Option<std::sync::Arc<crate::redis_runtime::RedisRuntime>>,
    /// TTL（毫秒），默认 5 分钟
    ttl_ms: i64,
}

impl JobIdempotencyManager {
    pub fn new() -> Self {
        Self {
            redis_runtime: None,
            ttl_ms: 5 * 60 * 1000, // 5 分钟
        }
    }

    pub fn set_redis_runtime(&mut self, redis_runtime: Option<std::sync::Arc<crate::redis_runtime::RedisRuntime>>) {
        self.redis_runtime = redis_runtime;
    }

    /// 获取或创建 job_id（幂等）
    /// 如果 job_key 已存在，返回已存在的 job_id
    /// 如果不存在，创建新的映射并返回 job_id
    /// 使用 Redis 简单 key-value 存储，不再依赖 request_binding
    pub async fn get_or_create_job_id(&self, job_key: &JobKey, job_id: String) -> String {
        if let Some(ref rt) = self.redis_runtime {
            // 直接使用 Redis key-value 存储，key 格式：scheduler:job_key:{job_key}
            let key = format!("scheduler:job_key:{}", job_key);
            
            // 尝试获取已存在的 job_id
            if let Some(existing_job_id) = rt.redis_get_string(&key).await.ok().flatten() {
                return existing_job_id;
            }
            
            // 使用 SETNX 原子操作创建新的映射
            let ttl_seconds = (self.ttl_ms / 1000) as u64;
            let created = rt.redis_set_nx_ex_string(&key, &job_id, ttl_seconds).await.unwrap_or(false);
            
            if created {
                // 成功创建，返回新的 job_id
                return job_id;
            } else {
                // 创建失败（其他实例已创建），重新获取
                if let Some(existing_job_id) = rt.redis_get_string(&key).await.ok().flatten() {
                    return existing_job_id;
                }
            }
        }
        // Phase2 不可用时，直接返回 job_id（无幂等保护）
        job_id
    }

    /// 获取 job_id（如果存在）
    pub async fn get_job_id(&self, job_key: &JobKey) -> Option<String> {
        // 如果 Phase2 可用，从 Redis 读取
        if let Some(ref rt) = self.redis_runtime {
            let key = format!("scheduler:job_key:{}", job_key);
            return rt.redis_get_string(&key).await.ok().flatten();
        }
        None
    }
}

impl Default for JobIdempotencyManager {
    fn default() -> Self {
        Self::new()
    }
}

