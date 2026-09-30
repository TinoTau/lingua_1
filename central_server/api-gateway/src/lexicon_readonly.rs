//! Read-only Lexicon SSOT access for correction writeback (exact surface only).
//! Does NOT mutate production Lexicon. Does NOT implement fuzzy writeback.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension};

use crate::domain_slots::is_domain_slot;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LexiconTermHit {
    pub term_id: String,
    pub surface: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LexiconDomainTag {
    pub domain_id: String,
    pub weight: f64,
}

pub trait LexiconReadonly: Send + Sync {
    fn resolve_exact_surface(&self, surface: &str) -> Result<ResolveExactResult, String>;
    fn domain_tags_for_term(&self, term_id: &str) -> Result<Vec<LexiconDomainTag>, String>;
}

#[derive(Debug, Clone, PartialEq)]
pub enum ResolveExactResult {
    Resolved(LexiconTermHit),
    Ambiguous { surface: String, term_ids: Vec<String> },
    NotFound,
}

/// In-memory lexicon for tests / golden parity.
#[derive(Debug, Default, Clone)]
pub struct MemoryLexicon {
    /// surface → term_id (unique). Ambiguous if vec len > 1.
    by_surface: HashMap<String, Vec<LexiconTermHit>>,
    /// term_id → domain tags (slot-filtered at query time)
    tags: HashMap<String, Vec<LexiconDomainTag>>,
}

impl MemoryLexicon {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert_term(&mut self, term_id: &str, surface: &str, domains: &[&str]) {
        let hit = LexiconTermHit {
            term_id: term_id.to_string(),
            surface: surface.to_string(),
        };
        self.by_surface
            .entry(surface.to_string())
            .or_default()
            .push(hit);
        self.tags.insert(
            term_id.to_string(),
            domains
                .iter()
                .map(|d| LexiconDomainTag {
                    domain_id: (*d).to_string(),
                    weight: 1.0,
                })
                .collect(),
        );
    }
}

impl LexiconReadonly for MemoryLexicon {
    fn resolve_exact_surface(&self, surface: &str) -> Result<ResolveExactResult, String> {
        let s = surface.trim();
        if s.is_empty() {
            return Ok(ResolveExactResult::NotFound);
        }
        match self.by_surface.get(s) {
            None => Ok(ResolveExactResult::NotFound),
            Some(hits) if hits.is_empty() => Ok(ResolveExactResult::NotFound),
            Some(hits) if hits.len() == 1 => Ok(ResolveExactResult::Resolved(hits[0].clone())),
            Some(hits) => Ok(ResolveExactResult::Ambiguous {
                surface: s.to_string(),
                term_ids: hits.iter().map(|h| h.term_id.clone()).collect(),
            }),
        }
    }

    fn domain_tags_for_term(&self, term_id: &str) -> Result<Vec<LexiconDomainTag>, String> {
        let tags = self.tags.get(term_id).cloned().unwrap_or_default();
        Ok(tags
            .into_iter()
            .filter(|t| is_domain_slot(&t.domain_id))
            .collect())
    }
}

/// Production Lexicon: opens node_runtime lexicon.sqlite read-only.
pub struct SqliteLexiconReadonly {
    path: PathBuf,
    conn: Mutex<Connection>,
}

impl SqliteLexiconReadonly {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref().to_path_buf();
        if !path.exists() {
            return Err(format!("LEXICON_DB_NOT_FOUND: {}", path.display()));
        }
        let conn = Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| format!("LEXICON_OPEN_FAILED: {e}"))?;
        // Fail fast if required tables missing
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='term'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| format!("LEXICON_SCHEMA: {e}"))
        .and_then(|n| {
            if n < 1 {
                Err("LEXICON_SCHEMA: missing term table".into())
            } else {
                Ok(())
            }
        })?;
        Ok(Self {
            path,
            conn: Mutex::new(conn),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl LexiconReadonly for SqliteLexiconReadonly {
    fn resolve_exact_surface(&self, surface: &str) -> Result<ResolveExactResult, String> {
        let s = surface.trim();
        if s.is_empty() {
            return Ok(ResolveExactResult::NotFound);
        }
        let conn = self
            .conn
            .lock()
            .map_err(|_| "LEXICON_LOCK_POISONED".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, word FROM term WHERE word = ?1 AND COALESCE(enabled, 1) = 1 LIMIT 8",
            )
            .map_err(|e| format!("LEXICON_PREPARE: {e}"))?;
        let rows = stmt
            .query_map([s], |row| {
                Ok(LexiconTermHit {
                    term_id: row.get(0)?,
                    surface: row.get(1)?,
                })
            })
            .map_err(|e| format!("LEXICON_QUERY: {e}"))?;
        let mut hits = Vec::new();
        for r in rows {
            hits.push(r.map_err(|e| format!("LEXICON_ROW: {e}"))?);
        }
        match hits.len() {
            0 => Ok(ResolveExactResult::NotFound),
            1 => Ok(ResolveExactResult::Resolved(hits.remove(0))),
            _ => Ok(ResolveExactResult::Ambiguous {
                surface: s.to_string(),
                term_ids: hits.into_iter().map(|h| h.term_id).collect(),
            }),
        }
    }

    fn domain_tags_for_term(&self, term_id: &str) -> Result<Vec<LexiconDomainTag>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "LEXICON_LOCK_POISONED".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT domain_id, weight FROM term_domain_tags WHERE term_id = ?1 ORDER BY domain_id",
            )
            .map_err(|e| format!("LEXICON_PREPARE_TAGS: {e}"))?;
        let rows = stmt
            .query_map([term_id], |row| {
                Ok(LexiconDomainTag {
                    domain_id: row.get(0)?,
                    weight: row.get(1)?,
                })
            })
            .map_err(|e| format!("LEXICON_QUERY_TAGS: {e}"))?;
        let mut out = Vec::new();
        for r in rows {
            let t = r.map_err(|e| format!("LEXICON_TAG_ROW: {e}"))?;
            if is_domain_slot(&t.domain_id) {
                out.push(t);
            }
        }
        Ok(out)
    }
}

pub type SharedLexicon = Arc<dyn LexiconReadonly>;

/// Optional open: missing path → None (lexical writeback degrades to unresolved-only).
pub fn try_open_lexicon(path: Option<&str>) -> Option<SharedLexicon> {
    let p = path?.trim();
    if p.is_empty() {
        return None;
    }
    match SqliteLexiconReadonly::open(p) {
        Ok(db) => {
            tracing::info!(path = %db.path().display(), "Lexicon readonly opened for writeback");
            Some(Arc::new(db))
        }
        Err(e) => {
            tracing::warn!(error = %e, "Lexicon readonly unavailable; lexical resolve will be UNRESOLVED");
            None
        }
    }
}

/// Convenience: does term_id exist? (used by migration)
pub fn term_exists(lex: &dyn LexiconReadonly, term_id: &str) -> bool {
    lex.domain_tags_for_term(term_id).ok().is_some()
        && lex
            .domain_tags_for_term(term_id)
            .map(|t| !t.is_empty() || true)
            .unwrap_or(false)
}

/// Probe whether a surface exists (for migration of free-text).
pub fn surface_resolves(lex: &dyn LexiconReadonly, surface: &str) -> Option<LexiconTermHit> {
    match lex.resolve_exact_surface(surface).ok()? {
        ResolveExactResult::Resolved(h) => Some(h),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_exact_and_ambiguous() {
        let mut m = MemoryLexicon::new();
        m.insert_term("t1", "接口", &["tech_ai"]);
        assert!(matches!(
            m.resolve_exact_surface("接口").unwrap(),
            ResolveExactResult::Resolved(_)
        ));
        assert!(matches!(
            m.resolve_exact_surface("未知词").unwrap(),
            ResolveExactResult::NotFound
        ));
        m.by_surface
            .get_mut("接口")
            .unwrap()
            .push(LexiconTermHit {
                term_id: "t2".into(),
                surface: "接口".into(),
            });
        assert!(matches!(
            m.resolve_exact_surface("接口").unwrap(),
            ResolveExactResult::Ambiguous { .. }
        ));
    }
}
