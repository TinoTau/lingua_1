//! Stable user identity — distinct from tenant_id.
//! Browser cannot forge another user_id: identity is derived from authenticated credential.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Auth context placed on authenticated requests.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthContext {
    pub tenant_id: String,
    pub user_id: String,
}

/// Durable user record (minimal).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct User {
    pub user_id: String,
    pub tenant_id: String,
    pub display_name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Derive a stable server-owned user_id from api_key + tenant_id.
/// Not equal to tenant_id. Not client-supplied.
pub fn derive_stable_user_id(tenant_id: &str, api_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"lingua-user-v1|");
    hasher.update(tenant_id.as_bytes());
    hasher.update(b"|");
    hasher.update(api_key.as_bytes());
    let digest = hasher.finalize();
    let hex = format!("{:x}", digest);
    format!("user-{}", &hex[..16])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_id_stable_and_not_tenant() {
        let tenant = "tenant-abc";
        let key = "secret-key-1";
        let u1 = derive_stable_user_id(tenant, key);
        let u2 = derive_stable_user_id(tenant, key);
        assert_eq!(u1, u2);
        assert_ne!(u1, tenant);
        assert!(u1.starts_with("user-"));
        let other = derive_stable_user_id(tenant, "other-key");
        assert_ne!(u1, other);
    }
}
