#[cfg(test)]
mod tests {
    use crate::redis_runtime::{RedisHandle, RedisRuntime};
    use serde_json::json;
    use super::*;

    include!("reservation_redis_try_reserve.rs");
    include!("reservation_redis_commit_release.rs");
    include!("reservation_redis_dec_lifecycle.rs");
}
