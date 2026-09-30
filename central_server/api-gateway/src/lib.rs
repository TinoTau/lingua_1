//! Lingua API Gateway / Web User Gateway library.

pub mod app_state;
pub mod config;
pub mod tenant;
pub mod auth;
pub mod rate_limit;
pub mod scheduler_client;
pub mod rest_api;
pub mod ws_api;
pub mod user_identity;
pub mod user_profile;
pub mod user_profile_repository;
pub mod session_proxy;
pub mod model2_metadata;
pub mod correction_proxy;
pub mod profile_delta;
pub mod domain_slots;
pub mod lexicon_readonly;
pub mod lexical_resolve;
pub mod domain_evidence;

pub use app_state::AppState;
pub use user_identity::{derive_stable_user_id, AuthContext, User};
pub use user_profile::{UserProfileError, UserProfileV1, USER_PROFILE_MAX_BYTES};
pub use user_profile_repository::{SqliteUserProfileRepository, UserProfileRepository};
pub use profile_delta::{ApplyDeltaResult, ProfileDeltaV1, MAX_PERSONAL_TERMS};
