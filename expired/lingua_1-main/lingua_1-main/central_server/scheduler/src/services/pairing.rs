use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc, Duration};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingCode {
    pub code: String,
    pub node_id: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct PairingService {
    codes: Arc<RwLock<HashMap<String, PairingCode>>>,
    #[allow(dead_code)]
    expiry_duration: Duration,
}

impl PairingService {
    pub fn new() -> Self {
        Self {
            codes: Arc::new(RwLock::new(HashMap::new())),
            expiry_duration: Duration::minutes(5),
        }
    }


    pub async fn validate_pairing_code(&self, code: &str) -> Option<String> {
        let mut codes = self.codes.write().await;
        
        if let Some(pairing_code) = codes.get(code) {
            if pairing_code.expires_at > Utc::now() {
                let node_id = pairing_code.node_id.clone();
                codes.remove(code);
                Some(node_id)
            } else {
                codes.remove(code);
                None
            }
        } else {
            None
        }
    }

}

