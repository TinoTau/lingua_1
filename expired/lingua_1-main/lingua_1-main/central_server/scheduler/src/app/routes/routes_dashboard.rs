// 仪表盘页面
pub async fn serve_dashboard() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../../dashboard.html"))
}

// 算力页面
pub async fn serve_compute_power() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../../../compute-power.html"))
}

// 模型页面
pub async fn serve_models() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../../../models.html"))
}

// 语言页面
pub async fn serve_languages() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../../../languages.html"))
}

// 集群监控页面
pub async fn serve_cluster() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../../cluster.html"))
}

