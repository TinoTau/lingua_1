use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::messages::FeatureFlags;
use crate::websocket::session_actor::SessionActorHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_id: String,
    pub client_version: String,
    pub platform: String, // "android" | "ios" | "web" | "api-gateway"
    pub src_lang: String,  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
    pub tgt_lang: String,
    pub dialect: Option<String>,
    pub default_features: Option<FeatureFlags>,
    pub tenant_id: Option<String>, // 租户 ID（用于多租户支持）
    pub paired_node_id: Option<String>,
    pub utterance_index: u64,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// 追踪 ID（用于全链路日志追踪）
    pub trace_id: String,
    /// 翻译模式："one_way" | "two_way_auto"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// 双向模式的语言 A（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_a: Option<String>,
    /// 双向模式的语言 B（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_b: Option<String>,
    /// 自动识别时限制的语言范围（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_langs: Option<Vec<String>>,
    /// 音频格式（"pcm16" | "opus" 等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_format: Option<String>,
    /// 采样率（默认 16000）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
}

#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, Session>>>,
    /// Session Actor 注册表（session_id -> ActorHandle）
    actor_handles: Arc<RwLock<HashMap<String, SessionActorHandle>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            actor_handles: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 注册 Session Actor Handle
    pub async fn register_actor(&self, session_id: String, handle: SessionActorHandle) {
        let mut handles = self.actor_handles.write().await;
        handles.insert(session_id, handle);
    }

    /// 获取 Session Actor Handle
    pub async fn get_actor_handle(&self, session_id: &str) -> Option<SessionActorHandle> {
        let handles = self.actor_handles.read().await;
        handles.get(session_id).cloned()
    }

    /// 移除 Session Actor Handle
    pub async fn remove_actor(&self, session_id: &str) {
        let mut handles = self.actor_handles.write().await;
        handles.remove(session_id);
    }

    pub async fn create_session(
        &self,
        client_version: String,
        platform: String,
        src_lang: String,
        tgt_lang: String,
        dialect: Option<String>,
        default_features: Option<FeatureFlags>,
        tenant_id: Option<String>,
        mode: Option<String>,
        lang_a: Option<String>,
        lang_b: Option<String>,
        auto_langs: Option<Vec<String>>,
        trace_id: Option<String>,
        audio_format: Option<String>,
        sample_rate: Option<u32>,
    ) -> Session {
        let session_id = format!("s-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        // 如果没有提供 trace_id，则生成一个新的 UUID v4
        let trace_id = trace_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let session = Session {
            session_id: session_id.clone(),
            client_version,
            platform,
            src_lang,
            tgt_lang,
            dialect,
            default_features,
            tenant_id,
            paired_node_id: None,
            utterance_index: 0,
            created_at: chrono::Utc::now(),
            trace_id,
            mode,
            lang_a,
            lang_b,
            auto_langs,
            audio_format,
            sample_rate,
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
    
    /// 获取所有会话（用于统计）
    pub async fn list_all_sessions(&self) -> Vec<Session> {
        let sessions = self.sessions.read().await;
        sessions.values().cloned().collect()
    }
}

#[derive(Debug)]
pub enum SessionUpdate {
    PairNode(String),
    IncrementUtteranceIndex,
}

