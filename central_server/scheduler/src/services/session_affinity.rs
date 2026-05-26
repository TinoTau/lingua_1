//! Session affinity binding + migration event log (Lexicon V2 Phase 5).

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;

use crate::redis_runtime::RedisRuntime;

const SESSION_KEY_PREFIX: &str = "scheduler:session:";
const MIGRATION_LOG_SUFFIX: &str = ":migration_events";
const MIGRATION_LOCK_PREFIX: &str = "session:migration:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMigrationEvent {
    pub session_id: String,
    pub from_node_id: Option<String>,
    pub to_node_id: String,
    pub reason: String,
    pub timestamp_ms: i64,
}

pub struct SessionAffinityService {
    redis: Arc<RedisRuntime>,
}

impl SessionAffinityService {
    pub fn new(redis: Arc<RedisRuntime>) -> Self {
        Self { redis }
    }

    fn session_key(session_id: &str) -> String {
        format!("{}{}", SESSION_KEY_PREFIX, session_id)
    }

    fn migration_lock_key(session_id: &str) -> String {
        format!("{}{}", MIGRATION_LOCK_PREFIX, session_id)
    }

    /// Acquire per-session migration lock (SET NX EX).
    pub async fn try_acquire_migration_lock(&self, session_id: &str, ttl_secs: u64) -> Result<bool> {
        let key = Self::migration_lock_key(session_id);
        let script = r#"
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
  return 1
end
return 0
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg("1")
            .arg(ttl_secs.to_string());
        let acquired: i64 = self.redis.redis_query(cmd).await?;
        Ok(acquired == 1)
    }

    pub async fn release_migration_lock(&self, session_id: &str) -> Result<()> {
        let key = Self::migration_lock_key(session_id);
        let mut cmd = redis::cmd("DEL");
        cmd.arg(&key);
        self.redis.redis_query::<()>(cmd).await?;
        Ok(())
    }

    pub async fn get_assigned_node_id(&self, session_id: &str) -> Result<Option<String>> {
        let key = Self::session_key(session_id);
        let mut cmd = redis::cmd("HGET");
        cmd.arg(&key).arg("assigned_node_id");
        let value: Option<String> = self.redis.redis_query(cmd).await?;
        Ok(value.filter(|s| !s.is_empty()))
    }

    /// Bind session to node when unbound; returns effective assigned node id.
    pub async fn bind_session_node(&self, session_id: &str, node_id: &str) -> Result<String> {
        let key = Self::session_key(session_id);
        let script = r#"
if redis.call('EXISTS', KEYS[1]) == 0 or redis.call('HGET', KEYS[1], 'assigned_node_id') == false then
  redis.call('HSET', KEYS[1], 'assigned_node_id', ARGV[1])
end
return redis.call('HGET', KEYS[1], 'assigned_node_id')
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(&key).arg(node_id);
        let assigned: Option<String> = self.redis.redis_query(cmd).await?;
        Ok(assigned.unwrap_or_else(|| node_id.to_string()))
    }

    /// When selected node differs from previous binding, log migration and update binding.
    pub async fn reconcile_session_node(
        &self,
        session_id: &str,
        selected_node_id: &str,
        reason: &str,
    ) -> Result<String> {
        let previous = self.get_assigned_node_id(session_id).await?;
        let assigned = self.bind_session_node(session_id, selected_node_id).await?;

        if let Some(ref from) = previous {
            if from != &assigned {
                self.record_migration_event(SessionMigrationEvent {
                    session_id: session_id.to_string(),
                    from_node_id: Some(from.clone()),
                    to_node_id: assigned.clone(),
                    reason: reason.to_string(),
                    timestamp_ms: chrono::Utc::now().timestamp_millis(),
                })
                .await?;
                info!(
                    session_id = %session_id,
                    from_node = %from,
                    to_node = %assigned,
                    reason = %reason,
                    "Session affinity migration recorded"
                );
            }
        }

        Ok(assigned)
    }

    /// Force-update session binding (migration success path).
    pub async fn force_bind_session_node(&self, session_id: &str, node_id: &str) -> Result<()> {
        let key = Self::session_key(session_id);
        let mut cmd = redis::cmd("HSET");
        cmd.arg(&key).arg("assigned_node_id").arg(node_id);
        self.redis.redis_query::<()>(cmd).await?;
        Ok(())
    }

    pub async fn record_migration_event(&self, event: SessionMigrationEvent) -> Result<()> {
        let key = format!("{}{}", Self::session_key(&event.session_id), MIGRATION_LOG_SUFFIX);
        let payload = serde_json::to_string(&event)?;
        let mut cmd = redis::cmd("RPUSH");
        cmd.arg(&key).arg(payload);
        self.redis.redis_query::<()>(cmd).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_key_format() {
        assert_eq!(
            SessionAffinityService::session_key("abc"),
            "scheduler:session:abc"
        );
    }
}
