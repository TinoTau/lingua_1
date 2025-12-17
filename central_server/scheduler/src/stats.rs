// 统计数据模块

use crate::app_state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct DashboardStats {
    pub web_clients: WebClientStats,
    pub nodes: NodeStats,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebClientStats {
    /// 当前活跃的Web端用户数（WebSocket连接数）
    pub active_users: usize,
    /// 最热门的十种语言（按使用次数排序）
    pub top_languages: Vec<LanguageUsage>,
    /// 每种语言的使用统计（包括输入和输出）
    pub language_usage: HashMap<String, LanguageUsageStats>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LanguageUsage {
    pub language: String,
    pub count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LanguageUsageStats {
    /// 作为源语言使用的次数
    pub as_source: usize,
    /// 作为目标语言使用的次数
    pub as_target: usize,
    /// 总使用次数（输入+输出）
    pub total: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NodeStats {
    /// 当前连接的节点数
    pub connected_nodes: usize,
    /// 每种模型有多少节点正在提供算力
    pub model_node_counts: HashMap<String, usize>,
    /// Model Hub中可用的服务包列表
    pub available_services: Vec<ServiceInfo>,
    /// 服务包总数
    pub total_services: usize,
    /// 每个服务包有多少节点正在使用
    pub service_node_counts: HashMap<String, usize>,
    /// 算力统计
    pub compute_power: ComputePowerStats,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComputePowerStats {
    /// 总CPU可用算力（所有节点的CPU核心数总和）
    pub total_cpu_power: f64,
    /// 总GPU可用算力（所有节点的GPU显存总和，单位：GB）
    pub total_gpu_power: f64,
    /// 总内存可用算力（所有节点的内存总和，单位：GB）
    pub total_memory_power: f64,
    /// 每个节点的算力详情
    pub node_power_details: Vec<NodePowerDetail>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NodePowerDetail {
    /// 节点ID
    pub node_id: String,
    /// 节点名称
    pub node_name: String,
    /// CPU可用算力（核心数 * 可用百分比）
    pub cpu_power: f64,
    /// GPU可用算力（GPU数量 * 显存GB * 可用百分比，单位：GB）
    pub gpu_power: f64,
    /// 内存可用算力（GB * 可用百分比，单位：GB）
    pub memory_power: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub service_id: String,
    pub name: String,
    pub latest_version: String,
    pub variants: Vec<ServiceVariant>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceVariant {
    pub version: String,
    pub platform: String,
    pub artifact: ServiceArtifact,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceArtifact {
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
}

impl DashboardStats {
    pub async fn collect(state: &AppState) -> Self {
        // 收集Web端统计
        let web_clients = Self::collect_web_client_stats(state).await;
        
        // 收集节点端统计
        let nodes = Self::collect_node_stats(state).await;

        Self {
            web_clients,
            nodes,
        }
    }

    async fn collect_web_client_stats(state: &AppState) -> WebClientStats {
        // 获取所有活跃会话
        let sessions = state.session_manager.list_all_sessions().await;
        
        // 统计活跃用户数（通过session_connections统计WebSocket连接）
        let active_connections = state.session_connections.count().await;
        
        // 统计语言使用情况
        let mut language_counts: HashMap<String, usize> = HashMap::new();
        let mut language_stats: HashMap<String, (usize, usize)> = HashMap::new(); // (source_count, target_count)
        
        for session in &sessions {
            // 统计源语言
            if session.src_lang != "auto" {
                let count = language_counts.entry(session.src_lang.clone()).or_insert(0);
                *count += 1;
                
                let (src_count, _tgt_count) = language_stats
                    .entry(session.src_lang.clone())
                    .or_insert((0, 0));
                *src_count += 1;
            }
            
            // 统计目标语言
            let count = language_counts.entry(session.tgt_lang.clone()).or_insert(0);
            *count += 1;
            
            let (_src_count, tgt_count) = language_stats
                .entry(session.tgt_lang.clone())
                .or_insert((0, 0));
            *tgt_count += 1;
            
            // 如果是双向模式，还需要统计lang_a和lang_b
            if session.mode.as_deref() == Some("two_way_auto") {
                if let Some(lang_a) = &session.lang_a {
                    let count = language_counts.entry(lang_a.clone()).or_insert(0);
                    *count += 1;
                    let (src_count, tgt_count) = language_stats
                        .entry(lang_a.clone())
                        .or_insert((0, 0));
                    *src_count += 1;
                    *tgt_count += 1;
                }
                if let Some(lang_b) = &session.lang_b {
                    let count = language_counts.entry(lang_b.clone()).or_insert(0);
                    *count += 1;
                    let (src_count, tgt_count) = language_stats
                        .entry(lang_b.clone())
                        .or_insert((0, 0));
                    *src_count += 1;
                    *tgt_count += 1;
                }
            }
        }
        
        // 获取最热门的十种语言
        let mut top_languages: Vec<LanguageUsage> = language_counts
            .iter()
            .map(|(lang, count)| LanguageUsage {
                language: lang.clone(),
                count: *count,
            })
            .collect();
        top_languages.sort_by(|a, b| b.count.cmp(&a.count));
        top_languages.truncate(10);
        
        // 构建语言使用统计
        let language_usage: HashMap<String, LanguageUsageStats> = language_stats
            .iter()
            .map(|(lang, (src_count, tgt_count))| {
                (
                    lang.clone(),
                    LanguageUsageStats {
                        as_source: *src_count,
                        as_target: *tgt_count,
                        total: *src_count + *tgt_count,
                    },
                )
            })
            .collect();

        WebClientStats {
            active_users: active_connections,
            top_languages,
            language_usage,
        }
    }

    async fn collect_node_stats(state: &AppState) -> NodeStats {
        // 获取所有节点
        let nodes = state.node_registry.nodes.read().await;
        
        // 统计在线节点数
        let connected_nodes = nodes.values().filter(|n| n.online).count();
        
        // 统计每个模型有多少节点提供
        let mut model_node_counts: HashMap<String, usize> = HashMap::new();
        for node in nodes.values() {
            if !node.online {
                continue;
            }
            
            // 从capability_state统计
            if !node.capability_state.is_empty() {
                for (model_id, status) in &node.capability_state {
                    if matches!(status, crate::messages::ModelStatus::Ready) {
                        *model_node_counts.entry(model_id.clone()).or_insert(0) += 1;
                    }
                }
            } else {
                // 如果capability_state为空，从installed_models统计
                for model in &node.installed_models {
                    if model.enabled.unwrap_or(true) {
                        *model_node_counts.entry(model.model_id.clone()).or_insert(0) += 1;
                    }
                }
            }
        }
        
        // 从Model Hub获取可用服务包列表（通过HTTP API）
        let available_services = match Self::fetch_services_from_hub().await {
            Ok(services) => {
                tracing::debug!("成功获取 {} 个服务包", services.len());
                services
            },
            Err(e) => {
                tracing::warn!("获取Model Hub服务包列表失败: {}", e);
                tracing::warn!("请确保Model Hub服务正在运行 (http://127.0.0.1:5000)");
                Vec::new()
            }
        };
        let total_services = available_services.len();

        // 统计每个服务包有多少节点在使用
        // 优先从节点的 installed_services 获取，如果没有则从 installed_models 推断
        let mut service_node_counts: HashMap<String, usize> = HashMap::new();
        for node in nodes.values() {
            if !node.online {
                continue;
            }
            
            // 优先使用节点直接报告的服务包信息
            if !node.installed_services.is_empty() {
                for service in &node.installed_services {
                    *service_node_counts.entry(service.service_id.clone()).or_insert(0) += 1;
                }
            } else {
                // 如果没有服务包信息，从节点的模型推断服务包（向后兼容）
                let mut used_services = std::collections::HashSet::new();
                
                for model in &node.installed_models {
                    if !model.enabled.unwrap_or(true) {
                        continue;
                    }
                    
                    // 根据模型类型推断服务包
                    let model_id_lower = model.model_id.to_lowercase();
                    if model_id_lower.contains("m2m100") || model_id_lower.contains("nmt") {
                        used_services.insert("nmt-m2m100");
                    } else if model_id_lower.contains("piper") || (model_id_lower.contains("tts") && !model_id_lower.contains("your")) {
                        used_services.insert("piper-tts");
                    } else if model_id_lower.contains("yourtts") || model_id_lower.contains("your_tts") {
                        used_services.insert("your-tts");
                    } else if model_id_lower.contains("whisper") || model_id_lower.contains("asr") {
                        // ASR 模型可能来自 node-inference 服务包
                        used_services.insert("node-inference");
                    }
                }
                
                // 如果节点有多个模型，可能使用了 node-inference 服务包（包含多个模型）
                if node.installed_models.len() > 3 {
                    used_services.insert("node-inference");
                }
                
                // 统计服务包使用
                for service_id in used_services {
                    *service_node_counts.entry(service_id.to_string()).or_insert(0) += 1;
                }
            }
        }

        // 计算算力统计
        let compute_power = Self::calculate_compute_power(&nodes);

        NodeStats {
            connected_nodes,
            model_node_counts,
            available_services,
            total_services,
            service_node_counts,
            compute_power,
        }
    }

    /// 计算所有节点的可用算力
    /// 
    /// 算力计算公式：
    /// - CPU算力 = (25% - 当前CPU使用率) * CPU核心数 / 100
    /// - GPU算力 = (25% - 当前GPU使用率) * GPU数量 * GPU显存(GB) / 100
    /// - 内存算力 = (75% - 当前内存使用率) * 内存大小(GB) / 100
    fn calculate_compute_power(nodes: &tokio::sync::RwLockReadGuard<'_, std::collections::HashMap<String, crate::node_registry::Node>>) -> ComputePowerStats {
        const CPU_THRESHOLD: f32 = 25.0;
        const GPU_THRESHOLD: f32 = 25.0;
        const MEMORY_THRESHOLD: f32 = 75.0;
        
        let mut node_power_details = Vec::new();
        let mut total_cpu_power = 0.0;
        let mut total_gpu_power = 0.0;
        let mut total_memory_power = 0.0;

        for node in nodes.values() {
            if !node.online {
                continue;
            }

            // 计算CPU可用算力（核心数）
            let cpu_available = (CPU_THRESHOLD - node.cpu_usage).max(0.0);
            let cpu_power = cpu_available as f64 * node.hardware.cpu_cores as f64 / 100.0;

            // 计算GPU可用算力（显存GB）
            let gpu_power = if let Some(gpu_usage) = node.gpu_usage {
                if let Some(ref gpus) = node.hardware.gpus {
                    let mut total_gpu_power = 0.0;
                    for gpu in gpus {
                        let gpu_available = (GPU_THRESHOLD - gpu_usage).max(0.0);
                        total_gpu_power += gpu_available as f64 * gpu.memory_gb as f64 / 100.0;
                    }
                    total_gpu_power
                } else {
                    0.0
                }
            } else {
                0.0
            };

            // 计算内存可用算力（GB）
            let memory_available = (MEMORY_THRESHOLD - node.memory_usage).max(0.0);
            let memory_power = memory_available as f64 * node.hardware.memory_gb as f64 / 100.0;

            node_power_details.push(NodePowerDetail {
                node_id: node.node_id.clone(),
                node_name: node.name.clone(),
                cpu_power,
                gpu_power,
                memory_power,
            });

            total_cpu_power += cpu_power;
            total_gpu_power += gpu_power;
            total_memory_power += memory_power;
        }

        ComputePowerStats {
            total_cpu_power,
            total_gpu_power,
            total_memory_power,
            node_power_details,
        }
    }

    /// 从Model Hub HTTP API获取服务包列表
    async fn fetch_services_from_hub() -> Result<Vec<ServiceInfo>, String> {
        use serde_json::Value;
        
        // Model Hub默认地址（使用 127.0.0.1 而不是 localhost，避免 IPv6 解析问题）
        let hub_url = std::env::var("MODEL_HUB_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:5000".to_string());
        
        let api_url = format!("{}/api/services", hub_url);
        tracing::debug!("从Model Hub获取服务包列表: {}", api_url);
        
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
        
        let response = client
            .get(&api_url)
            .send()
            .await
            .map_err(|e| {
                let err_msg = format!("请求Model Hub失败 ({}): {}", api_url, e);
                tracing::warn!("{}", err_msg);
                err_msg
            })?;
        
        if !response.status().is_success() {
            let status = response.status();
            let err_msg = format!("Model Hub返回HTTP错误: {} (URL: {})", status, api_url);
            tracing::warn!("{}", err_msg);
            return Err(err_msg);
        }
        
        let json: Value = response
            .json()
            .await
            .map_err(|e| {
                let err_msg = format!("解析Model Hub响应失败: {}", e);
                tracing::warn!("{}", err_msg);
                err_msg
            })?;
        
        // 解析响应：{"services": [...]}
        let services_array = json["services"]
            .as_array()
            .ok_or_else(|| "响应中没有services字段或不是数组".to_string())?;
        
        tracing::debug!("从Model Hub获取到 {} 个服务包", services_array.len());
        
        let mut result = Vec::new();
        for service in services_array {
            let service_id = service["service_id"]
                .as_str()
                .ok_or_else(|| "服务包缺少service_id字段".to_string())?
                .to_string();
            
            let name = service["name"]
                .as_str()
                .unwrap_or(&service_id)
                .to_string();
            
            let latest_version = service["latest_version"]
                .as_str()
                .unwrap_or("1.0.0")
                .to_string();
            
            // 解析variants
            let empty_vec: Vec<Value> = Vec::new();
            let variants_array = service["variants"]
                .as_array()
                .unwrap_or(&empty_vec);
            
            let mut variants = Vec::new();
            for variant in variants_array {
                let version = variant["version"]
                    .as_str()
                    .unwrap_or("1.0.0")
                    .to_string();
                
                let platform = variant["platform"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string();
                
                let artifact_obj = variant["artifact"]
                    .as_object()
                    .ok_or_else(|| "variant缺少artifact字段".to_string())?;
                
                let artifact_type = artifact_obj["type"]
                    .as_str()
                    .unwrap_or("zip")
                    .to_string();
                
                let url = artifact_obj["url"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                
                let sha256 = artifact_obj["sha256"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                
                let size_bytes = artifact_obj["size_bytes"]
                    .as_u64()
                    .unwrap_or(0);
                
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
        
        tracing::info!("成功获取 {} 个服务包", result.len());
        Ok(result)
    }
}

