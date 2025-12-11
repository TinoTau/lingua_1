use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_id: String,
    pub src_lang: String,
    pub tgt_lang: String,
    pub paired_node_id: Option<String>,
    pub utterance_index: u64,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, Session>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn create_session(&self, src_lang: String, tgt_lang: String) -> Session {
        let session_id = format!("s-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        let session = Session {
            session_id: session_id.clone(),
            src_lang,
            tgt_lang,
            paired_node_id: None,
            utterance_index: 0,
            created_at: chrono::Utc::now(),
        };

        let mut sessions = self.sessions.write().await;
        sessions.insert(session_id, session.clone());
        session
    }

    pub async fn get_session(&self, session_id: &str) -> Option<Session> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).cloned()
    }

    pub async fn update_session(&self, session_id: &str, update: SessionUpdate) -> bool {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            match update {
                SessionUpdate::PairNode(node_id) => {
                    session.paired_node_id = Some(node_id);
                }
                SessionUpdate::IncrementUtteranceIndex => {
                    session.utterance_index += 1;
                }
            }
            true
        } else {
            false
        }
    }

    pub async fn remove_session(&self, session_id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.remove(session_id);
    }
}

#[derive(Debug)]
pub enum SessionUpdate {
    PairNode(String),
    IncrementUtteranceIndex,
}

