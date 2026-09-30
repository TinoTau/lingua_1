use super::{CorrectionError, CorrectionEventV1, CorrectionRepository};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct SqliteCorrectionRepository {
    conn: Mutex<Connection>,
    #[allow(dead_code)]
    path: PathBuf,
}

impl SqliteCorrectionRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CorrectionError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CorrectionError::Storage(e.to_string()))?;
        }
        let conn = Connection::open(&path).map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let repo = Self {
            conn: Mutex::new(conn),
            path,
        };
        repo.migrate()?;
        Ok(repo)
    }

    pub fn open_in_memory() -> Result<Self, CorrectionError> {
        let conn =
            Connection::open_in_memory().map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let repo = Self {
            conn: Mutex::new(conn),
            path: PathBuf::from(":memory:"),
        };
        repo.migrate()?;
        Ok(repo)
    }

    fn migrate(&self) -> Result<(), CorrectionError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS correction_events (
              event_id TEXT PRIMARY KEY NOT NULL,
              user_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              utterance_index INTEGER NOT NULL,
              system_text TEXT NOT NULL,
              corrected_text TEXT NOT NULL,
              corrections_json TEXT NOT NULL,
              source_profile_version INTEGER,
              pipeline_version TEXT,
              idempotency_key TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_corr_idem
              ON correction_events(user_id, idempotency_key);
            CREATE INDEX IF NOT EXISTS idx_corr_user
              ON correction_events(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_corr_utterance
              ON correction_events(user_id, session_id, utterance_index, created_at);
            "#,
        )
        .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        Ok(())
    }

    fn row_to_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<CorrectionEventV1> {
        let corrections_json: String = row.get(6)?;
        let corrections = serde_json::from_str(&corrections_json).unwrap_or_default();
        let created_at_s: String = row.get(10)?;
        let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_s)
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or_else(|_| chrono::Utc::now());
        Ok(CorrectionEventV1 {
            event_id: row.get(0)?,
            user_id: row.get(1)?,
            session_id: row.get(2)?,
            utterance_index: row.get::<_, i64>(3)? as u64,
            system_text: row.get(4)?,
            corrected_text: row.get(5)?,
            corrections,
            source_profile_version: row
                .get::<_, Option<i64>>(7)?
                .map(|v| v as u64),
            pipeline_version: row.get(8)?,
            idempotency_key: row.get(9)?,
            created_at,
        })
    }
}

impl CorrectionRepository for SqliteCorrectionRepository {
    fn insert(&self, event: &CorrectionEventV1) -> Result<(), CorrectionError> {
        let corrections_json = serde_json::to_string(&event.corrections)
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        conn.execute(
            r#"INSERT INTO correction_events (
                event_id, user_id, session_id, utterance_index,
                system_text, corrected_text, corrections_json,
                source_profile_version, pipeline_version, idempotency_key, created_at
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"#,
            params![
                event.event_id,
                event.user_id,
                event.session_id,
                event.utterance_index as i64,
                event.system_text,
                event.corrected_text,
                corrections_json,
                event.source_profile_version.map(|v| v as i64),
                event.pipeline_version,
                event.idempotency_key,
                event.created_at.to_rfc3339(),
            ],
        )
        .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        Ok(())
    }

    fn find_by_id(&self, event_id: &str) -> Result<Option<CorrectionEventV1>, CorrectionError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                r#"SELECT event_id, user_id, session_id, utterance_index,
                   system_text, corrected_text, corrections_json,
                   source_profile_version, pipeline_version, idempotency_key, created_at
                   FROM correction_events WHERE event_id = ?1"#,
            )
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let mut rows = stmt
            .query(params![event_id])
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        if let Some(row) = rows.next().map_err(|e| CorrectionError::Storage(e.to_string()))? {
            Ok(Some(
                Self::row_to_event(row).map_err(|e| CorrectionError::Storage(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    fn find_by_user(
        &self,
        user_id: &str,
        limit: usize,
    ) -> Result<Vec<CorrectionEventV1>, CorrectionError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                r#"SELECT event_id, user_id, session_id, utterance_index,
                   system_text, corrected_text, corrections_json,
                   source_profile_version, pipeline_version, idempotency_key, created_at
                   FROM correction_events WHERE user_id = ?1
                   ORDER BY created_at DESC LIMIT ?2"#,
            )
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map(params![user_id, limit as i64], |row| Self::row_to_event(row))
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CorrectionError::Storage(e.to_string()))?);
        }
        Ok(out)
    }

    fn find_by_idempotency(
        &self,
        user_id: &str,
        idempotency_key: &str,
    ) -> Result<Option<CorrectionEventV1>, CorrectionError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                r#"SELECT event_id, user_id, session_id, utterance_index,
                   system_text, corrected_text, corrections_json,
                   source_profile_version, pipeline_version, idempotency_key, created_at
                   FROM correction_events WHERE user_id = ?1 AND idempotency_key = ?2"#,
            )
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let mut rows = stmt
            .query(params![user_id, idempotency_key])
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        if let Some(row) = rows.next().map_err(|e| CorrectionError::Storage(e.to_string()))? {
            Ok(Some(
                Self::row_to_event(row).map_err(|e| CorrectionError::Storage(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    fn find_by_utterance(
        &self,
        user_id: &str,
        session_id: &str,
        utterance_index: u64,
    ) -> Result<Vec<CorrectionEventV1>, CorrectionError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                r#"SELECT event_id, user_id, session_id, utterance_index,
                   system_text, corrected_text, corrections_json,
                   source_profile_version, pipeline_version, idempotency_key, created_at
                   FROM correction_events
                   WHERE user_id = ?1 AND session_id = ?2 AND utterance_index = ?3
                   ORDER BY created_at DESC, event_id DESC"#,
            )
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map(
                params![user_id, session_id, utterance_index as i64],
                |row| Self::row_to_event(row),
            )
            .map_err(|e| CorrectionError::Storage(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CorrectionError::Storage(e.to_string()))?);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::correction::{new_event_from_request, SubmitCorrectionRequest};

    #[test]
    fn insert_idempotent_and_isolation() {
        let repo = SqliteCorrectionRepository::open_in_memory().unwrap();
        let req = SubmitCorrectionRequest {
            user_id: "user-a".into(),
            session_id: "s-1".into(),
            utterance_index: 3,
            system_text: "系统文本".into(),
            corrected_text: "纠正文本".into(),
            corrections: vec![],
            source_profile_version: Some(1),
            pipeline_version: Some("v4".into()),
            idempotency_key: "idem-1".into(),
        };
        let e1 = new_event_from_request(req.clone()).unwrap();
        repo.insert(&e1).unwrap();
        let again = repo
            .find_by_idempotency("user-a", "idem-1")
            .unwrap()
            .unwrap();
        assert_eq!(again.system_text, "系统文本");
        assert_eq!(again.corrected_text, "纠正文本");
        assert_ne!(again.system_text, again.corrected_text);

        let mut req_b = req.clone();
        req_b.user_id = "user-b".into();
        let e_b = new_event_from_request(req_b).unwrap();
        repo.insert(&e_b).unwrap();
        assert_eq!(repo.find_by_user("user-a", 10).unwrap().len(), 1);
        assert_eq!(repo.find_by_user("user-b", 10).unwrap().len(), 1);
        assert!(repo.find_by_id(&e1.event_id).unwrap().is_some());
    }

    #[test]
    fn same_utterance_multiple_explicit_corrections() {
        let repo = SqliteCorrectionRepository::open_in_memory().unwrap();
        let base = SubmitCorrectionRequest {
            user_id: "user-a".into(),
            session_id: "s-ABCDEF12".into(),
            utterance_index: 1,
            system_text: "A".into(),
            corrected_text: "B".into(),
            corrections: vec![],
            source_profile_version: None,
            pipeline_version: None,
            idempotency_key: "idem-b".into(),
        };
        let e1 = new_event_from_request(base.clone()).unwrap();
        repo.insert(&e1).unwrap();

        let mut second = base;
        second.corrected_text = "C".into();
        second.idempotency_key = "idem-c".into();
        let e2 = new_event_from_request(second).unwrap();
        repo.insert(&e2).unwrap();

        let all = repo.find_by_user("user-a", 10).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|e| e.system_text == "A"));
        let corrected: Vec<_> = all.iter().map(|e| e.corrected_text.as_str()).collect();
        assert!(corrected.contains(&"B"));
        assert!(corrected.contains(&"C"));
    }

    #[test]
    fn reject_noop_at_event_factory() {
        let req = SubmitCorrectionRequest {
            user_id: "u".into(),
            session_id: "s-1".into(),
            utterance_index: 0,
            system_text: "same".into(),
            corrected_text: "same".into(),
            corrections: vec![],
            source_profile_version: None,
            pipeline_version: None,
            idempotency_key: "k".into(),
        };
        assert!(new_event_from_request(req).is_err());
    }
}
