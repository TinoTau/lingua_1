pub mod routes_handlers;
pub mod routes_api;
pub mod routes_dashboard;

pub use routes_handlers::{handle_session_ws, handle_node_ws, start_server};
pub use routes_api::{
    health_check, get_stats, get_metrics, get_cluster_stats,
    get_prometheus_metrics,
    submit_correction,
    refresh_session_profile,
};
pub use routes_dashboard::{
    serve_dashboard, serve_compute_power, serve_models, serve_languages, serve_cluster,
};

use crate::core::AppState;
use axum::{
    routing::{get, post},
    Router,
};

pub fn create_router(app_state: AppState) -> Router {
    Router::new()
        .route("/ws/session", get(handle_session_ws))
        .route("/ws/node", get(handle_node_ws))
        .route("/health", get(health_check))
        .route("/api/v1/stats", get(get_stats))
        .route("/api/v1/metrics", get(get_metrics))
        .route("/api/v1/cluster", get(get_cluster_stats))
        .route("/api/v1/corrections", post(submit_correction))
        .route("/api/v1/sessions/profile-refresh", post(refresh_session_profile))
        .route("/metrics", get(get_prometheus_metrics))
        .route("/dashboard", get(serve_dashboard))
        .route("/cluster", get(serve_cluster))
        .route("/compute-power", get(serve_compute_power))
        .route("/models", get(serve_models))
        .route("/languages", get(serve_languages))
        .with_state(app_state)
}

