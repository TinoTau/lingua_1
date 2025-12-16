use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use sha2::{Sha256, Digest};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tenant {
    pub tenant_id: String,
    pub name: String,
    pub api_key_hash: String,
    pub max_concurrent_sessions: usize,
    pub max_requests_per_second: usize,
    pub enabled: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
pub struct TenantManager {
    tenants: Arc<RwLock<HashMap<String, Tenant>>>,
    api_key_to_tenant: Arc<RwLock<HashMap<String, String>>>, // API Key -> tenant_id
}

impl TenantManager {
    pub fn new() -> Self {
        Self {
            tenants: Arc::new(RwLock::new(HashMap::new())),
            api_key_to_tenant: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn validate_api_key(&self, api_key: &str) -> Option<String> {
        let mapping = self.api_key_to_tenant.read().await;
        mapping.get(api_key).cloned()
    }

    pub async fn get_tenant(&self, tenant_id: &str) -> Option<Tenant> {
        let tenants = self.tenants.read().await;
        tenants.get(tenant_id).cloned()
    }

    pub async fn create_tenant(&self, name: String, api_key: String) -> Tenant {
        let tenant_id = format!("tenant-{}", uuid::Uuid::new_v4());
        let api_key_hash = hash_api_key(&api_key);
        
        let tenant = Tenant {
            tenant_id: tenant_id.clone(),
            name,
            api_key_hash,
            max_concurrent_sessions: 10,
            max_requests_per_second: 100,
            enabled: true,
            created_at: chrono::Utc::now(),
        };

        let mut tenants = self.tenants.write().await;
        tenants.insert(tenant_id.clone(), tenant.clone());

        let mut mapping = self.api_key_to_tenant.write().await;
        mapping.insert(api_key, tenant_id);

        tenant
    }

    pub async fn list_tenants(&self) -> Vec<Tenant> {
        let tenants = self.tenants.read().await;
        tenants.values().cloned().collect()
    }
}

fn hash_api_key(api_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(api_key.as_bytes());
    format!("{:x}", hasher.finalize())
}

