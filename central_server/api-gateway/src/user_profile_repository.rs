//! UserProfileRepository — storage behind domain interface (SQLite V1, migratable).

use crate::user_identity::User;
use crate::user_profile::{UserProfileError, UserProfileV1, USER_PROFILE_SCHEMA_VERSION};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub trait UserProfileRepository: Send + Sync {
    fn ensure_user(&self, user: &User) -> Result<(), UserProfileError>;
    fn get_profile(&self, user_id: &str) -> Result<UserProfileV1, UserProfileError>;
    fn get_or_create_default(&self, user: &User) -> Result<UserProfileV1, UserProfileError>;
    /// Optimistic update: expected_profile_version must match stored version.
    fn update_profile(
        &self,
        user_id: &str,
        expected_profile_version: u64,
        profile: &UserProfileV1,
    ) -> Result<UserProfileV1, UserProfileError>;
    /// Apply ProfileDelta with same-event idempotency. Additive on latest profile.
    fn apply_profile_delta(
        &self,
        user_id: &str,
        delta: &crate::profile_delta::ProfileDeltaV1,
    ) -> Result<crate::profile_delta::ApplyDeltaResult, UserProfileError> {
        self.apply_profile_delta_with_lexicon(user_id, delta, None)
    }

    fn apply_profile_delta_with_lexicon(
        &self,
        user_id: &str,
        delta: &crate::profile_delta::ProfileDeltaV1,
        lexicon: Option<&dyn crate::lexicon_readonly::LexiconReadonly>,
    ) -> Result<crate::profile_delta::ApplyDeltaResult, UserProfileError>;
}

pub struct SqliteUserProfileRepository {
    conn: Mutex<Connection>,
    #[allow(dead_code)]
    path: PathBuf,
}

impl SqliteUserProfileRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, UserProfileError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| UserProfileError::Storage(e.to_string()))?;
        }
        let conn = Connection::open(&path).map_err(|e| UserProfileError::Storage(e.to_string()))?;
        let repo = Self {
            conn: Mutex::new(conn),
            path,
        };
        repo.migrate()?;
        Ok(repo)
    }

    pub fn open_in_memory() -> Result<Self, UserProfileError> {
        let conn = Connection::open_in_memory().map_err(|e| UserProfileError::Storage(e.to_string()))?;
        let repo = Self {
            conn: Mutex::new(conn),
            path: PathBuf::from(":memory:"),
        };
        repo.migrate()?;
        Ok(repo)
    }

    fn migrate(&self) -> Result<(), UserProfileError> {
        let conn = self.conn.lock().map_err(|e| UserProfileError::Storage(e.to_string()))?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS users (
              user_id TEXT PRIMARY KEY NOT NULL,
              tenant_id TEXT NOT NULL,
              display_name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_profiles (
              user_id TEXT PRIMARY KEY NOT NULL,
              schema_version INTEGER NOT NULL,
              profile_version INTEGER NOT NULL,
              profile_json BLOB NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(user_id)
            );
            CREATE TABLE IF NOT EXISTS profile_delta_applications (
              user_id TEXT NOT NULL,
              event_id TEXT NOT NULL,
              profile_version_after INTEGER NOT NULL,
              applied_at TEXT NOT NULL,
              PRIMARY KEY (user_id, event_id)
            );
            "#,
        )
        .map_err(|e| UserProfileError::Storage(e.to_string()))?;
        Ok(())
    }
}

impl UserProfileRepository for SqliteUserProfileRepository {
    fn ensure_user(&self, user: &User) -> Result<(), UserProfileError> {
        let conn = self.conn.lock().map_err(|e| UserProfileError::Storage(e.to_string()))?;
        conn.execute(
            r#"INSERT OR IGNORE INTO users (user_id, tenant_id, display_name, created_at)
               VALUES (?1, ?2, ?3, ?4)"#,
            params![
                user.user_id,
                user.tenant_id,
                user.display_name,
                user.created_at.to_rfc3339()
            ],
        )
        .map_err(|e| UserProfileError::Storage(e.to_string()))?;
        Ok(())
    }

    fn get_profile(&self, user_id: &str) -> Result<UserProfileV1, UserProfileError> {
        let conn = self.conn.lock().map_err(|e| UserProfileError::Storage(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT profile_json FROM user_profiles WHERE user_id = ?1")
            .map_err(|e| UserProfileError::Storage(e.to_string()))?;
        let bytes: Vec<u8> = stmt
            .query_row(params![user_id], |row| row.get(0))
            .map_err(|_| UserProfileError::UserNotFound(user_id.to_string()))?;
        UserProfileV1::from_bytes(&bytes)
    }

    fn get_or_create_default(&self, user: &User) -> Result<UserProfileV1, UserProfileError> {
        self.ensure_user(user)?;
        match self.get_profile(&user.user_id) {
            Ok(p) => Ok(p),
            Err(UserProfileError::UserNotFound(_)) => {
                let profile = UserProfileV1::empty_default();
                let bytes = profile.serialize_checked()?;
                let conn = self.conn.lock().map_err(|e| UserProfileError::Storage(e.to_string()))?;
                conn.execute(
                    r#"INSERT INTO user_profiles (user_id, schema_version, profile_version, profile_json, updated_at)
                       VALUES (?1, ?2, ?3, ?4, ?5)"#,
                    params![
                        user.user_id,
                        USER_PROFILE_SCHEMA_VERSION as i64,
                        0i64,
                        bytes,
                        chrono::Utc::now().to_rfc3339()
                    ],
                )
                .map_err(|e| UserProfileError::Storage(e.to_string()))?;
                Ok(profile)
            }
            Err(e) => Err(e),
        }
    }

    fn update_profile(
        &self,
        user_id: &str,
        expected_profile_version: u64,
        profile: &UserProfileV1,
    ) -> Result<UserProfileV1, UserProfileError> {
        let mut next = profile.clone();
        next.schema_version = USER_PROFILE_SCHEMA_VERSION;
        // Caller supplies desired content; we enforce version bump from expected.
        if next.profile_version != expected_profile_version + 1
            && next.profile_version != expected_profile_version
        {
            // Normalize: always store expected+1 on successful update.
            next.profile_version = expected_profile_version + 1;
        } else {
            next.profile_version = expected_profile_version + 1;
        }
        let bytes = next.serialize_checked()?;

        let conn = self.conn.lock().map_err(|e| UserProfileError::Storage(e.to_string()))?;
        let current: i64 = conn
            .query_row(
                "SELECT profile_version FROM user_profiles WHERE user_id = ?1",
                params![user_id],
                |row| row.get(0),
            )
            .map_err(|_| UserProfileError::UserNotFound(user_id.to_string()))?;
        if current as u64 != expected_profile_version {
            return Err(UserProfileError::StaleVersion {
                expected: expected_profile_version,
                actual: current as u64,
            });
        }
        let changed = conn
            .execute(
                r#"UPDATE user_profiles
                   SET schema_version = ?1, profile_version = ?2, profile_json = ?3, updated_at = ?4
                   WHERE user_id = ?5 AND profile_version = ?6"#,
                params![
                    USER_PROFILE_SCHEMA_VERSION as i64,
                    next.profile_version as i64,
                    bytes,
                    chrono::Utc::now().to_rfc3339(),
                    user_id,
                    expected_profile_version as i64
                ],
            )
            .map_err(|e| UserProfileError::Storage(e.to_string()))?;
        if changed != 1 {
            return Err(UserProfileError::StaleVersion {
                expected: expected_profile_version,
                actual: current as u64,
            });
        }
        Ok(next)
    }

    fn apply_profile_delta_with_lexicon(
        &self,
        user_id: &str,
        delta: &crate::profile_delta::ProfileDeltaV1,
        lexicon: Option<&dyn crate::lexicon_readonly::LexiconReadonly>,
    ) -> Result<crate::profile_delta::ApplyDeltaResult, UserProfileError> {
        // Same event cannot apply twice
        let already_applied = {
            let conn = self.conn.lock().map_err(|e| UserProfileError::Storage(e.to_string()))?;
            conn.query_row(
                "SELECT 1 FROM profile_delta_applications WHERE user_id = ?1 AND event_id = ?2",
                params![user_id, delta.source_event_id],
                |row| row.get::<_, i64>(0),
            )
            .is_ok()
        };
        if already_applied {
            let current = self.get_profile(user_id)?;
            return Ok(crate::profile_delta::ApplyDeltaResult {
                profile: current.clone(),
                profile_version_before: current.profile_version,
                profile_version_after: current.profile_version,
                skipped: true,
                skip_reason: Some("EVENT_ALREADY_APPLIED".into()),
                lexical_diagnostics: None,
            });
        }

        if delta.superseded_for_profile {
            let current = self.get_profile(user_id)?;
            return Ok(crate::profile_delta::ApplyDeltaResult {
                profile: current.clone(),
                profile_version_before: current.profile_version,
                profile_version_after: current.profile_version,
                skipped: true,
                skip_reason: Some("SUPERSEDED_FOR_PROFILE".into()),
                lexical_diagnostics: None,
            });
        }

        // Reload latest; apply additively (handles stale base_profile_version simply)
        let current = self.get_profile(user_id)?;
        let applied =
            crate::profile_delta::apply_profile_delta_with_lexicon(&current, delta, lexicon);
        if applied.skipped {
            return Ok(applied);
        }
        crate::profile_delta::validate_profile_bound(&applied.profile)?;

        // Persist with optimistic retry once on version conflict
        match self.update_profile(user_id, current.profile_version, &applied.profile) {
            Ok(stored) => {
                {
                    let conn = self.conn.lock().map_err(|e| UserProfileError::Storage(e.to_string()))?;
                    conn.execute(
                        r#"INSERT INTO profile_delta_applications
                           (user_id, event_id, profile_version_after, applied_at)
                           VALUES (?1, ?2, ?3, ?4)"#,
                        params![
                            user_id,
                            delta.source_event_id,
                            stored.profile_version as i64,
                            chrono::Utc::now().to_rfc3339()
                        ],
                    )
                    .map_err(|e| UserProfileError::Storage(e.to_string()))?;
                }
                Ok(crate::profile_delta::ApplyDeltaResult {
                    profile: stored.clone(),
                    profile_version_before: applied.profile_version_before,
                    profile_version_after: stored.profile_version,
                    skipped: false,
                    skip_reason: None,
                    lexical_diagnostics: applied.lexical_diagnostics,
                })
            }
            Err(UserProfileError::StaleVersion { .. }) => {
                // Reload and re-apply once
                let latest = self.get_profile(user_id)?;
                let applied2 =
                    crate::profile_delta::apply_profile_delta_with_lexicon(&latest, delta, lexicon);
                if applied2.skipped {
                    return Ok(applied2);
                }
                crate::profile_delta::validate_profile_bound(&applied2.profile)?;
                let stored = self.update_profile(user_id, latest.profile_version, &applied2.profile)?;
                {
                    let conn = self.conn.lock().map_err(|e| UserProfileError::Storage(e.to_string()))?;
                    let _ = conn.execute(
                        r#"INSERT OR IGNORE INTO profile_delta_applications
                           (user_id, event_id, profile_version_after, applied_at)
                           VALUES (?1, ?2, ?3, ?4)"#,
                        params![
                            user_id,
                            delta.source_event_id,
                            stored.profile_version as i64,
                            chrono::Utc::now().to_rfc3339()
                        ],
                    );
                }
                Ok(crate::profile_delta::ApplyDeltaResult {
                    profile: stored.clone(),
                    profile_version_before: applied2.profile_version_before,
                    profile_version_after: stored.profile_version,
                    skipped: false,
                    skip_reason: None,
                    lexical_diagnostics: applied2.lexical_diagnostics,
                })
            }
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::user_identity::User;

    fn sample_user() -> User {
        User {
            user_id: "user-test1".into(),
            tenant_id: "tenant-t1".into(),
            display_name: "Test".into(),
            created_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn create_read_version_update_and_stale() {
        let repo = SqliteUserProfileRepository::open_in_memory().unwrap();
        let user = sample_user();
        let p0 = repo.get_or_create_default(&user).unwrap();
        assert_eq!(p0.profile_version, 0);

        let mut p1 = p0.clone();
        p1.phonetic_bias.insert("n/l".into(), 0.2);
        let saved = repo.update_profile(&user.user_id, 0, &p1).unwrap();
        assert_eq!(saved.profile_version, 1);

        let stale = repo.update_profile(&user.user_id, 0, &p1);
        assert!(matches!(stale, Err(UserProfileError::StaleVersion { .. })));

        let read = repo.get_profile(&user.user_id).unwrap();
        assert_eq!(read.profile_version, 1);
        assert_eq!(read.phonetic_bias.get("n/l"), Some(&0.2));
    }

    #[test]
    fn reject_over_32kib_on_update() {
        let repo = SqliteUserProfileRepository::open_in_memory().unwrap();
        let user = sample_user();
        repo.get_or_create_default(&user).unwrap();
        let mut huge = UserProfileV1::empty_default();
        huge.personal_terms = vec!["y".repeat(40_000)];
        let err = repo.update_profile(&user.user_id, 0, &huge).unwrap_err();
        assert!(matches!(err, UserProfileError::PayloadTooLarge { .. }));
    }

    #[test]
    fn apply_same_event_twice_skipped() {
        let repo = SqliteUserProfileRepository::open_in_memory().unwrap();
        let user = sample_user();
        repo.get_or_create_default(&user).unwrap();
        let delta = crate::profile_delta::ProfileDeltaV1 {
            schema_version: 1,
            base_profile_version: Some(0),
            source_event_id: "corr-once".into(),
            phonetic_updates: vec![crate::profile_delta::FeatureUpdate {
                feature_key: "n_l".into(),
                evidence: 1.0,
                weight: 1.0,
                sample_count_delta: 1,
            }],
            tone_updates: vec![],
            personal_term_updates: vec![],
            domain_updates: vec![],
            extractor_version: "v1".into(),
            feature_schema_version: "s".into(),
            normalizer_version: "n".into(),
            superseded_for_profile: false,
        };
        let r1 = repo.apply_profile_delta(&user.user_id, &delta).unwrap();
        assert!(!r1.skipped);
        assert_eq!(r1.profile_version_after, 1);
        let r2 = repo.apply_profile_delta(&user.user_id, &delta).unwrap();
        assert!(r2.skipped);
        assert_eq!(r2.skip_reason.as_deref(), Some("EVENT_ALREADY_APPLIED"));
        assert_eq!(r2.profile_version_after, 1);
    }
}
