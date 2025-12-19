// Model Hub 服务目录缓存（用于 Dashboard/统计，避免请求时同步 HTTP）
//
// 设计目标：
// - 单机运行：Scheduler 内部后台刷新缓存即可
// - 未来 cluster：可把这个缓存实现替换为 Redis/独立聚合器，无需动调度主路径

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub service_id: String,
    pub name: String,
    pub latest_version: String,
    pub variants: Vec<ServiceVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceVariant {
    pub version: String,
    pub platform: String,
    pub artifact: ServiceArtifact,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceArtifact {
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone)]
struct CatalogSnapshot {
    services: Vec<ServiceInfo>,
    /// 最近一次尝试拉取的时间（成功/失败都会更新）
    fetched_at_ms: i64,
    /// 最近一次成功拉取的时间（仅成功更新）
    last_success_at_ms: i64,
    /// 连续失败次数（成功后归零）
    fail_count: u32,
    /// 最近一次成功更新时间（保持旧字段，便于兼容现有调用方）
    updated_at_ms: i64,
    last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ServiceCatalogMeta {
    pub fetched_at_ms: i64,
    pub last_success_at_ms: i64,
    pub fail_count: u32,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct ServiceCatalogCache {
    hub_base_url: String,
    refresh_interval: Duration,
    client: reqwest::Client,
    local_index_path: Option<PathBuf>,
    inner: Arc<RwLock<CatalogSnapshot>>,
}

impl ServiceCatalogCache {
    pub fn new(hub_base_url: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(3))
            .build()
            .expect("Failed to build reqwest client");

        Self {
            hub_base_url,
            refresh_interval: Duration::from_secs(30),
            client,
            local_index_path: None,
            inner: Arc::new(RwLock::new(CatalogSnapshot {
                services: Vec::new(),
                fetched_at_ms: 0,
                last_success_at_ms: 0,
                fail_count: 0,
                updated_at_ms: 0,
                last_error: None,
            })),
        }
    }

    /// 可选：提供本地 services_index.json 路径（单机冷启动/离线兜底）
    pub fn with_local_services_index_path(mut self, path: PathBuf) -> Self {
        self.local_index_path = Some(path);
        self
    }

    /// 可选：覆盖默认刷新间隔（秒）
    #[allow(dead_code)]
    pub fn with_refresh_interval(mut self, secs: u64) -> Self {
        self.refresh_interval = Duration::from_secs(secs.max(5));
        self
    }

    /// 获取当前缓存的服务目录（无网络 IO）
    pub async fn get_services(&self) -> Vec<ServiceInfo> {
        self.inner.read().await.services.clone()
    }

    #[allow(dead_code)]
    pub async fn last_updated_at_ms(&self) -> i64 {
        self.inner.read().await.updated_at_ms
    }

    #[allow(dead_code)]
    pub async fn last_error(&self) -> Option<String> {
        self.inner.read().await.last_error.clone()
    }

    pub async fn get_meta(&self) -> ServiceCatalogMeta {
        let guard = self.inner.read().await;
        ServiceCatalogMeta {
            fetched_at_ms: guard.fetched_at_ms,
            last_success_at_ms: guard.last_success_at_ms,
            fail_count: guard.fail_count,
            last_error: guard.last_error.clone(),
        }
    }

    /// 启动后台刷新任务（非阻塞）
    pub fn start_background_refresh(&self) {
        let this = self.clone();
        tokio::spawn(async move {
            // 启动后尽快刷新一次，避免冷启动空列表
            loop {
                if let Err(e) = this.refresh_once().await {
                    tracing::warn!("ServiceCatalog 刷新失败: {}", e);
                }

                // stale-while-revalidate + 失败退避：失败次数越多，间隔越长（上限 5 分钟）
                let delay = this.compute_next_delay().await;
                tokio::time::sleep(delay).await;
            }
        });
    }

    async fn refresh_once(&self) -> Result<(), String> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        match self.fetch_services_from_hub().await {
            Ok(services) => {
                let mut guard = self.inner.write().await;
                guard.services = services;
                guard.fetched_at_ms = now_ms;
                guard.last_success_at_ms = now_ms;
                guard.fail_count = 0;
                guard.updated_at_ms = now_ms;
                guard.last_error = None;
                Ok(())
            }
            Err(e) => {
                // Hub 刷新失败：继续使用旧缓存（stale-while-revalidate）
                // 但若提供本地 services_index.json，则尝试本地兜底（解决冷启动/离线为空的问题）
                let mut used_local = false;
                let mut local_services: Option<Vec<ServiceInfo>> = None;
                if let Some(p) = self.local_index_path.as_ref() {
                    match self.fetch_services_from_local_index(p).await {
                        Ok(svcs) if !svcs.is_empty() => {
                            used_local = true;
                            local_services = Some(svcs);
                        }
                        Ok(_) => {}
                        Err(le) => {
                            tracing::warn!("ServiceCatalog 本地兜底失败: {}", le);
                        }
                    }
                }

                let mut guard = self.inner.write().await;
                guard.fetched_at_ms = now_ms;
                guard.fail_count = guard.fail_count.saturating_add(1);
                if used_local {
                    if let Some(svcs) = local_services {
                        guard.services = svcs;
                        guard.updated_at_ms = now_ms;
                        guard.last_success_at_ms = now_ms;
                    }
                    guard.last_error = Some(format!("hub_failed: {}; used_local_index=true", e));
                    Ok(())
                } else {
                    guard.last_error = Some(e.clone());
                    Err(e)
                }
            }
        }
    }

    async fn compute_next_delay(&self) -> Duration {
        // 连续失败 N 次后开始退避（建议 3）
        const FAIL_BACKOFF_AFTER: u32 = 3;
        const MAX_BACKOFF_SECS: u64 = 300; // 5 分钟

        let fail_count = self.inner.read().await.fail_count;
        if fail_count < FAIL_BACKOFF_AFTER {
            return self.refresh_interval;
        }

        let exp = (fail_count - FAIL_BACKOFF_AFTER + 1).min(8); // 限制指数，避免溢出
        let base_secs = self.refresh_interval.as_secs().max(5);
        let factor = 1u64.checked_shl(exp as u32).unwrap_or(u64::MAX);
        let backoff_secs = base_secs.saturating_mul(factor);
        Duration::from_secs(backoff_secs.min(MAX_BACKOFF_SECS))
    }

    async fn fetch_services_from_hub(&self) -> Result<Vec<ServiceInfo>, String> {
        use serde_json::Value;

        // 允许通过环境变量覆盖（保持向后兼容）
        let hub_url = std::env::var("MODEL_HUB_URL").unwrap_or_else(|_| self.hub_base_url.clone());
        let api_url = format!("{}/api/services", hub_url.trim_end_matches('/'));

        tracing::debug!("从 ModelHub 获取服务包列表: {}", api_url);

        let response = self
            .client
            .get(&api_url)
            .send()
            .await
            .map_err(|e| format!("请求 ModelHub 失败 ({}): {}", api_url, e))?;

        if !response.status().is_success() {
            return Err(format!("ModelHub 返回 HTTP 错误: {} (URL: {})", response.status(), api_url));
        }

        let json: Value = response
            .json()
            .await
            .map_err(|e| format!("解析 ModelHub 响应失败: {}", e))?;

        let services_array = json["services"]
            .as_array()
            .ok_or_else(|| "响应中没有 services 字段或不是数组".to_string())?;

        let mut result = Vec::with_capacity(services_array.len());
        for service in services_array {
            let service_id = service["service_id"]
                .as_str()
                .ok_or_else(|| "服务包缺少 service_id 字段".to_string())?
                .to_string();

            let name = service["name"].as_str().unwrap_or(&service_id).to_string();
            let latest_version = service["latest_version"].as_str().unwrap_or("1.0.0").to_string();

            let empty_vec: Vec<Value> = Vec::new();
            let variants_array = service["variants"].as_array().unwrap_or(&empty_vec);
            let mut variants = Vec::with_capacity(variants_array.len());

            for variant in variants_array {
                let version = variant["version"].as_str().unwrap_or("1.0.0").to_string();
                let platform = variant["platform"].as_str().unwrap_or("unknown").to_string();

                let artifact_obj = variant["artifact"]
                    .as_object()
                    .ok_or_else(|| "variant 缺少 artifact 字段".to_string())?;

                let artifact_type = artifact_obj["type"].as_str().unwrap_or("zip").to_string();
                let url = artifact_obj["url"].as_str().unwrap_or("").to_string();
                let sha256 = artifact_obj["sha256"].as_str().unwrap_or("").to_string();
                let size_bytes = artifact_obj["size_bytes"].as_u64().unwrap_or(0);

                variants.push(ServiceVariant {
                    version,
                    platform,
                    artifact: ServiceArtifact {
                        artifact_type,
                        url,
                        sha256,
                        size_bytes,
                    },
                });
            }

            result.push(ServiceInfo {
                service_id,
                name,
                latest_version,
                variants,
            });
        }

        tracing::info!("ServiceCatalog 刷新成功：{} 个服务包", result.len());
        Ok(result)
    }

    async fn fetch_services_from_local_index(&self, path: &PathBuf) -> Result<Vec<ServiceInfo>, String> {
        use serde_json::Value;

        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| format!("读取本地 services_index.json 失败 ({}): {}", path.display(), e))?;
        let json: Value = serde_json::from_str(&content)
            .map_err(|e| format!("解析本地 services_index.json 失败 ({}): {}", path.display(), e))?;

        let obj = json
            .as_object()
            .ok_or_else(|| "services_index.json 顶层不是 object".to_string())?;

        let mut result = Vec::with_capacity(obj.len());
        for (_k, service) in obj.iter() {
            let service_id = service["service_id"]
                .as_str()
                .ok_or_else(|| "服务包缺少 service_id 字段".to_string())?
                .to_string();
            let name = service["name"].as_str().unwrap_or(&service_id).to_string();
            let latest_version = service["latest_version"].as_str().unwrap_or("1.0.0").to_string();

            let empty_vec: Vec<Value> = Vec::new();
            let variants_array = service["variants"].as_array().unwrap_or(&empty_vec);
            let mut variants = Vec::with_capacity(variants_array.len());

            for variant in variants_array {
                let version = variant["version"].as_str().unwrap_or("1.0.0").to_string();
                let platform = variant["platform"].as_str().unwrap_or("unknown").to_string();

                let artifact_obj = variant["artifact"]
                    .as_object()
                    .ok_or_else(|| "variant 缺少 artifact 字段".to_string())?;
                let artifact_type = artifact_obj["type"].as_str().unwrap_or("zip").to_string();
                let url = artifact_obj["url"].as_str().unwrap_or("").to_string();
                let sha256 = artifact_obj["sha256"].as_str().unwrap_or("").to_string();
                let size_bytes = artifact_obj["size_bytes"].as_u64().unwrap_or(0);

                variants.push(ServiceVariant {
                    version,
                    platform,
                    artifact: ServiceArtifact {
                        artifact_type,
                        url,
                        sha256,
                        size_bytes,
                    },
                });
            }

            result.push(ServiceInfo {
                service_id,
                name,
                latest_version,
                variants,
            });
        }

        tracing::info!(
            local_index = %path.display(),
            count = result.len(),
            "ServiceCatalog 使用本地 services_index.json 兜底成功"
        );
        Ok(result)
    }
}


