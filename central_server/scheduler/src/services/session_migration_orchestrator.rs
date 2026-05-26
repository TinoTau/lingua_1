//! Scheduler-side session migration orchestrator — HTTP evacuate/import, binding after import only.

use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};

use super::session_affinity::{SessionAffinityService, SessionMigrationEvent};

const MIGRATION_BACKOFF_MS: [u64; 3] = [2000, 5000, 15000];
const MIGRATION_MAX_ATTEMPTS: usize = 3;
const MIGRATION_LOCK_TTL_SECS: u64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerSessionMigrationEvent {
    pub session_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub reason: String,
    pub snapshot_version: String,
    pub status: String,
    pub started_at_ms: i64,
    pub completed_at_ms: i64,
    pub duration_ms: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMigrationOrchestratorResult {
    pub ok: bool,
    pub session_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub reason: String,
    pub snapshot_version: String,
    pub status: String,
    pub migration_attempt: u32,
    pub duration_ms: u64,
    pub error: Option<String>,
}

pub struct SessionMigrationOrchestrator {
    http: Client,
    affinity: Arc<SessionAffinityService>,
}

impl SessionMigrationOrchestrator {
    pub fn new(affinity: Arc<SessionAffinityService>) -> Self {
        Self {
            http: Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .expect("reqwest client"),
            affinity,
        }
    }

    fn node_base_url(node_id: &str) -> Result<String> {
        let key = format!(
            "NODE_MIGRATION_BASE_URL_{}",
            node_id.to_uppercase().replace('-', "_")
        );
        if let Ok(url) = std::env::var(&key) {
            if !url.trim().is_empty() {
                return Ok(url.trim().trim_end_matches('/').to_string());
            }
        }
        if let Ok(default) = std::env::var("NODE_MIGRATION_BASE_URL_DEFAULT") {
            if !default.trim().is_empty() {
                return Ok(default.trim().trim_end_matches('/').to_string());
            }
        }
        Err(anyhow!(
            "missing node migration base URL for {node_id}; set {key} or NODE_MIGRATION_BASE_URL_DEFAULT"
        ))
    }

    pub async fn migrate_session(
        &self,
        session_id: &str,
        from_node_id: &str,
        to_node_id: &str,
        reason: &str,
    ) -> Result<SessionMigrationOrchestratorResult> {
        let started = Instant::now();
        let started_at_ms = chrono::Utc::now().timestamp_millis();

        if !self.affinity.try_acquire_migration_lock(session_id, MIGRATION_LOCK_TTL_SECS).await? {
            return Ok(SessionMigrationOrchestratorResult {
                ok: false,
                session_id: session_id.to_string(),
                from_node_id: from_node_id.to_string(),
                to_node_id: to_node_id.to_string(),
                reason: reason.to_string(),
                snapshot_version: "session-migration-v1".to_string(),
                status: "lock_held".to_string(),
                migration_attempt: 0,
                duration_ms: started.elapsed().as_millis() as u64,
                error: Some("migration already in progress".to_string()),
            });
        }

        let result = self
            .migrate_session_inner(session_id, from_node_id, to_node_id, reason, started_at_ms)
            .await;

        let _ = self.affinity.release_migration_lock(session_id).await;

        let mut out = result?;
        out.duration_ms = started.elapsed().as_millis() as u64;
        Ok(out)
    }

    async fn migrate_session_inner(
        &self,
        session_id: &str,
        from_node_id: &str,
        to_node_id: &str,
        reason: &str,
        started_at_ms: i64,
    ) -> Result<SessionMigrationOrchestratorResult> {
        let source_base = Self::node_base_url(from_node_id)?;
        let target_base = Self::node_base_url(to_node_id)?;

        self.record_event(
            session_id,
            from_node_id,
            to_node_id,
            reason,
            "started",
            "session-migration-v1",
            started_at_ms,
            started_at_ms,
            0,
            None,
        )
        .await?;

        let mut last_error: Option<String> = None;
        let mut last_snapshot = "session-migration-v1".to_string();

        for attempt in 0..MIGRATION_MAX_ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(MIGRATION_BACKOFF_MS[attempt - 1])).await;
            }

            match self
                .run_attempt(&source_base, &target_base, session_id, from_node_id, to_node_id)
                .await
            {
                Ok(payload) => {
                    let snapshot_version = payload
                        .get("schemaVersion")
                        .and_then(|v| v.as_str())
                        .unwrap_or("session-migration-v1")
                        .to_string();

                    self.affinity
                        .force_bind_session_node(session_id, to_node_id)
                        .await?;

                    let completed_at_ms = chrono::Utc::now().timestamp_millis();
                    let duration_ms = (completed_at_ms - started_at_ms).max(0) as u64;

                    self.record_event(
                        session_id,
                        from_node_id,
                        to_node_id,
                        reason,
                        "success",
                        &snapshot_version,
                        started_at_ms,
                        completed_at_ms,
                        duration_ms,
                        None,
                    )
                    .await?;

                    info!(
                        session_id = %session_id,
                        from_node = %from_node_id,
                        to_node = %to_node_id,
                        reason = %reason,
                        attempt = attempt + 1,
                        "Session migration orchestrator success"
                    );

                    return Ok(SessionMigrationOrchestratorResult {
                        ok: true,
                        session_id: session_id.to_string(),
                        from_node_id: from_node_id.to_string(),
                        to_node_id: to_node_id.to_string(),
                        reason: reason.to_string(),
                        snapshot_version,
                        status: "success".to_string(),
                        migration_attempt: (attempt + 1) as u32,
                        duration_ms,
                        error: None,
                    });
                }
                Err((status, err, snapshot_version)) => {
                    last_error = Some(err.clone());
                    last_snapshot = snapshot_version.clone();
                    self.record_event(
                        session_id,
                        from_node_id,
                        to_node_id,
                        reason,
                        &status,
                        &snapshot_version,
                        started_at_ms,
                        chrono::Utc::now().timestamp_millis(),
                        0,
                        Some(err.clone()),
                    )
                    .await?;
                    warn!(
                        session_id = %session_id,
                        attempt = attempt + 1,
                        status = %status,
                        error = %err,
                        "Session migration attempt failed"
                    );
                }
            }
        }

        let completed_at_ms = chrono::Utc::now().timestamp_millis();
        Ok(SessionMigrationOrchestratorResult {
            ok: false,
            session_id: session_id.to_string(),
            from_node_id: from_node_id.to_string(),
            to_node_id: to_node_id.to_string(),
            reason: reason.to_string(),
            snapshot_version: last_snapshot,
            status: "failed".to_string(),
            migration_attempt: MIGRATION_MAX_ATTEMPTS as u32,
            duration_ms: (completed_at_ms - started_at_ms).max(0) as u64,
            error: last_error,
        })
    }

    async fn run_attempt(
        &self,
        source_base: &str,
        target_base: &str,
        session_id: &str,
        from_node_id: &str,
        to_node_id: &str,
    ) -> std::result::Result<Value, (String, String, String)> {
        let evacuate_url = format!("{source_base}/session-migration/evacuate");
        let evacuate_body = serde_json::json!({
            "sessionId": session_id,
            "sourceNodeId": from_node_id,
            "targetNodeId": to_node_id,
        });

        let evacuate_resp = self
            .http
            .post(&evacuate_url)
            .json(&evacuate_body)
            .send()
            .await
            .map_err(|e| {
                (
                    "export_failed".to_string(),
                    e.to_string(),
                    "session-migration-v1".to_string(),
                )
            })?;

        if !evacuate_resp.status().is_success() {
            let detail = evacuate_resp.text().await.unwrap_or_default();
            return Err((
                "export_failed".to_string(),
                format!("evacuate failed: {detail}"),
                "session-migration-v1".to_string(),
            ));
        }

        let evacuate_json: Value = evacuate_resp.json().await.map_err(|e| {
            (
                "export_failed".to_string(),
                e.to_string(),
                "session-migration-v1".to_string(),
            )
        })?;

        let payload = evacuate_json
            .get("payload")
            .cloned()
            .ok_or_else(|| {
                (
                    "export_failed".to_string(),
                    "evacuate response missing payload".to_string(),
                    "session-migration-v1".to_string(),
                )
            })?;

        let snapshot_version = payload
            .get("schemaVersion")
            .and_then(|v| v.as_str())
            .unwrap_or("session-migration-v1")
            .to_string();

        let import_url = format!("{target_base}/session-migration/import");
        let import_body = serde_json::json!({
            "targetNodeId": to_node_id,
            "replaceExisting": true,
            "payload": payload,
        });

        let import_resp = self
            .http
            .post(&import_url)
            .json(&import_body)
            .send()
            .await
            .map_err(|e| {
                (
                    "import_failed".to_string(),
                    e.to_string(),
                    snapshot_version.clone(),
                )
            })?;

        if !import_resp.status().is_success() {
            let detail = import_resp.text().await.unwrap_or_default();
            return Err((
                "import_failed".to_string(),
                format!("import failed: {detail}"),
                snapshot_version,
            ));
        }

        Ok(payload)
    }

    async fn record_event(
        &self,
        session_id: &str,
        from_node_id: &str,
        to_node_id: &str,
        reason: &str,
        status: &str,
        snapshot_version: &str,
        started_at_ms: i64,
        completed_at_ms: i64,
        duration_ms: u64,
        error: Option<String>,
    ) -> Result<()> {
        let event = SessionMigrationEvent {
            session_id: session_id.to_string(),
            from_node_id: Some(from_node_id.to_string()),
            to_node_id: to_node_id.to_string(),
            reason: format!("{reason}|status={status}|snapshot={snapshot_version}|durationMs={duration_ms}"),
            timestamp_ms: completed_at_ms,
        };
        self.affinity.record_migration_event(event).await?;

        let _detail = SchedulerSessionMigrationEvent {
            session_id: session_id.to_string(),
            from_node_id: from_node_id.to_string(),
            to_node_id: to_node_id.to_string(),
            reason: reason.to_string(),
            snapshot_version: snapshot_version.to_string(),
            status: status.to_string(),
            started_at_ms,
            completed_at_ms,
            duration_ms: duration_ms as i64,
            error,
        };

        Ok(())
    }
}
