pub mod app_state;
pub mod config;
pub mod dispatcher;
pub mod session;
pub mod session_runtime;
pub mod job_idempotency;
pub mod job_result_deduplicator;

#[cfg(test)]
mod session_runtime_test;

pub use app_state::AppState;
pub use config::Config;
pub use dispatcher::JobDispatcher;
pub use session::SessionManager;
// SessionRuntimeManager（调度路径改造时使用，目前仅在测试中使用）
#[cfg(test)]
pub use session_runtime::{SessionRuntimeManager, SessionRuntimeState, SessionEntry};
pub use job_idempotency::JobIdempotencyManager;
pub use job_result_deduplicator::JobResultDeduplicator;

