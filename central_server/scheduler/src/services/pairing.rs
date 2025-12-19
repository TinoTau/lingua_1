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

    #[allow(dead_code)]
    pub async fn generate_pairing_code(&self, node_id: String) -> String {
        // 生成 6 位数字码
        // 使用时间戳和节点ID生成（简化实现）
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let code = format!("{:06}", (timestamp % 1000000));

        let pairing_code = PairingCode {
            code: code.clone(),
            node_id,
            created_at: Utc::now(),
            expires_at: Utc::now() + self.expiry_duration,
        };

        let mut codes = self.codes.write().await;
        codes.insert(code.clone(), pairing_code);
        code
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

    #[allow(dead_code)]
    pub async fn cleanup_expired_codes(&self) {
        let mut codes = self.codes.write().await;
        let now = Utc::now();
        codes.retain(|_, code| code.expires_at > now);
    }
}

