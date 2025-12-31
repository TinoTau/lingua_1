// JobResult 去重管理器
// 功能：将收到节点端返回结果的job存放在该session里保留30秒，30秒内再收到同一个返回结果就直接过滤

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;

/// JobResult 去重记录
#[derive(Debug, Clone)]
struct DeduplicationRecord {
    /// 收到结果的时间戳（毫秒）
    received_at_ms: i64,
    /// 保留时间（毫秒），默认30秒
    ttl_ms: i64,
}

/// JobResult 去重管理器
/// 按 session_id 和 job_id 进行去重
#[derive(Clone)]
pub struct JobResultDeduplicator {
    /// session_id -> (job_id -> DeduplicationRecord)
    records: Arc<RwLock<HashMap<String, HashMap<String, DeduplicationRecord>>>>,
    /// 默认TTL（毫秒），30秒
    default_ttl_ms: i64,
}

impl JobResultDeduplicator {
    pub fn new() -> Self {
        Self {
            records: Arc::new(RwLock::new(HashMap::new())),
            default_ttl_ms: 30 * 1000, // 30秒
        }
    }

    /// 检查并记录job_result
    /// 返回true表示这是重复的结果，应该被过滤
    /// 返回false表示这是新的结果，应该被处理
    pub async fn check_and_record(&self, session_id: &str, job_id: &str) -> bool {
        let now_ms = Utc::now().timestamp_millis();
        let mut records = self.records.write().await;

        // 获取或创建session的记录
        let session_records = records.entry(session_id.to_string()).or_insert_with(HashMap::new);

        // 检查是否已经存在该job_id的记录
        if let Some(record) = session_records.get(job_id) {
            let elapsed_ms = now_ms - record.received_at_ms;
            if elapsed_ms < record.ttl_ms {
                // 在TTL内，这是重复的结果
                tracing::info!(
                    session_id = %session_id,
                    job_id = %job_id,
                    elapsed_ms = elapsed_ms,
                    ttl_ms = record.ttl_ms,
                    "Duplicate job_result detected (within TTL), filtering"
                );
                return true; // 重复，应该被过滤
            } else {
                // 已超过TTL，移除旧记录
                session_records.remove(job_id);
            }
        }

        // 记录新的结果
        session_records.insert(
            job_id.to_string(),
            DeduplicationRecord {
                received_at_ms: now_ms,
                ttl_ms: self.default_ttl_ms,
            },
        );

        tracing::debug!(
            session_id = %session_id,
            job_id = %job_id,
            ttl_ms = self.default_ttl_ms,
            "New job_result recorded, will be deduplicated for 30 seconds"
        );

        false // 不是重复，应该被处理
    }

    /// 清理过期的记录（定期调用）
    pub async fn cleanup_expired(&self) {
        let now_ms = Utc::now().timestamp_millis();
        let mut records = self.records.write().await;

        let mut sessions_to_remove = Vec::new();

        for (session_id, session_records) in records.iter_mut() {
            let mut jobs_to_remove = Vec::new();

            for (job_id, record) in session_records.iter() {
                let elapsed_ms = now_ms - record.received_at_ms;
                if elapsed_ms >= record.ttl_ms {
                    jobs_to_remove.push(job_id.clone());
                }
            }

            for job_id in jobs_to_remove {
                session_records.remove(&job_id);
            }

            // 如果session的所有记录都已过期，标记为需要移除
            if session_records.is_empty() {
                sessions_to_remove.push(session_id.clone());
            }
        }

        for session_id in sessions_to_remove {
            records.remove(&session_id);
        }
    }

    /// 移除session的所有记录（当session结束时调用）
    pub async fn remove_session(&self, session_id: &str) {
        let mut records = self.records.write().await;
        records.remove(session_id);
        tracing::debug!(session_id = %session_id, "Removed session from job_result deduplicator");
    }
}

impl Default for JobResultDeduplicator {
    fn default() -> Self {
        Self::new()
    }
}

