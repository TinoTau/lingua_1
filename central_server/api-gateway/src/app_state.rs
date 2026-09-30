use std::sync::Arc;

use crate::config::Config;
use crate::lexicon_readonly::SharedLexicon;
use crate::rate_limit::RateLimiter;
use crate::scheduler_client::SchedulerClient;
use crate::tenant::TenantManager;
use crate::user_profile_repository::SqliteUserProfileRepository;

#[derive(Clone)]
pub struct AppState {
    pub tenant_manager: Arc<TenantManager>,
    pub rate_limiter: Arc<RateLimiter>,
    pub scheduler_client: Arc<SchedulerClient>,
    pub profile_repo: Arc<SqliteUserProfileRepository>,
    /// Optional Lexicon SSOT for Stage D lexical writeback (None → unresolved-only).
    pub lexicon: Option<SharedLexicon>,
    pub config: Config,
}
