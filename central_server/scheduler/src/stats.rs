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
    /// Model Hub中可用的模型列表
    pub available_models: Vec<ModelInfo>,
    /// 每种模型有多少节点正在提供算力
    pub model_node_counts: HashMap<String, usize>,
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
pub struct ModelInfo {
    pub model_id: String,
    pub kind: String, // "asr" | "nmt" | "tts" | "vad" | "emotion" | "persona" | "other"
    pub src_lang: Option<String>,
    pub tgt_lang: Option<String>,
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
            
            let (src_count, tgt_count) = language_stats
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
        
        // 从Model Hub获取可用模型列表（通过HTTP API）
        let available_models = match Self::fetch_models_from_hub().await {
            Ok(models) => {
                tracing::debug!("成功获取 {} 个模型", models.len());
                models
            },
            Err(e) => {
                tracing::warn!("获取Model Hub模型列表失败: {}", e);
                tracing::warn!("请确保Model Hub服务正在运行 (http://localhost:5000)");
                Vec::new()
            }
        };

        // 计算算力统计
        let compute_power = Self::calculate_compute_power(&nodes);

        NodeStats {
            connected_nodes,
            available_models,
            model_node_counts,
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

    /// 从模型ID解析类型和语言信息
    fn parse_model_id(model_id: &str) -> (String, Option<String>, Option<String>) {
        // 简单的解析逻辑，可以根据实际模型ID格式调整
        let kind = if model_id.starts_with("whisper") {
            "asr".to_string()
        } else if model_id.contains("m2m100") || model_id.contains("nmt") {
            "nmt".to_string()
        } else if model_id.contains("tts") || model_id.contains("piper") || model_id.contains("yourtts") {
            "tts".to_string()
        } else if model_id.contains("vad") || model_id.contains("silero") {
            "vad".to_string()
        } else if model_id.contains("emotion") || model_id.contains("xlm-r") {
            "emotion".to_string()
        } else if model_id.contains("persona") || model_id.contains("embedding") {
            "persona".to_string()
        } else {
            "other".to_string()
        };

        // 尝试从模型ID中提取语言信息
        let src_lang = if model_id.contains("-zh-") || model_id.contains("-en-") {
            if let Some(parts) = model_id.split('-').nth(1) {
                Some(parts.to_string())
            } else {
                None
            }
        } else {
            None
        };

        let tgt_lang = if model_id.contains("-zh-") || model_id.contains("-en-") {
            if let Some(parts) = model_id.split('-').last() {
                Some(parts.to_string())
            } else {
                None
            }
        } else {
            None
        };

        (kind, src_lang, tgt_lang)
    }

    /// 从Model Hub HTTP API获取模型列表
    async fn fetch_models_from_hub() -> Result<Vec<ModelInfo>, String> {
        use serde_json::Value;
        
        // Model Hub默认地址
        let hub_url = std::env::var("MODEL_HUB_URL")
            .unwrap_or_else(|_| "http://localhost:5000".to_string());
        
        let api_url = format!("{}/api/models", hub_url);
        tracing::debug!("从Model Hub获取模型列表: {}", api_url);
        
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
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
        
        let models: Vec<Value> = response
            .json()
            .await
            .map_err(|e| {
                let err_msg = format!("解析Model Hub响应失败: {}", e);
                tracing::warn!("{}", err_msg);
                err_msg
            })?;
        
        tracing::debug!("从Model Hub获取到 {} 个模型", models.len());
        
        let mut result = Vec::new();
        for model in models {
            let model_id = model["id"].as_str().unwrap_or("unknown").to_string();
            let task = model["task"].as_str().unwrap_or("other").to_string();
            let languages = model["languages"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .map(|s| s.to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            
            // 处理每个版本
            if let Some(versions) = model["versions"].as_array() {
                if versions.is_empty() {
                    tracing::debug!("模型 {} 没有版本信息", model_id);
                    continue;
                }
                
                for version in versions {
                    let version_str = version["version"].as_str().unwrap_or("1.0.0").to_string();
                    let full_model_id = format!("{}@{}", model_id, version_str);
                    
                    // 处理语言信息
                    let (src_lang, tgt_lang) = if languages.is_empty() {
                        // 没有语言信息
                        (None, None)
                    } else if languages.len() == 1 {
                        // 单个语言：根据模型类型决定显示位置
                        let lang = languages.first().unwrap().clone();
                        if task == "tts" {
                            // TTS模型：从文本到语音，语言作为目标语言（语音的语言）
                            (None, Some(lang))
                        } else if task == "asr" {
                            // ASR模型：从语音到文本，语言作为源语言（语音的语言）
                            (Some(lang), None)
                        } else {
                            // 其他类型：默认作为源语言
                            (Some(lang), None)
                        }
                    } else {
                        // 多个语言：使用组合格式，如 "zh/en/ja" 表示支持这些语言
                        let lang_pair = languages.join("/");
                        if task == "nmt" {
                            // NMT模型：多语言表示支持这些语言之间的双向翻译
                            (Some(lang_pair.clone()), Some(lang_pair))
                        } else if task == "tts" {
                            // TTS模型：多语言表示支持生成这些语言的语音
                            (None, Some(lang_pair))
                        } else if task == "asr" {
                            // ASR模型：多语言表示支持识别这些语言的语音
                            (Some(lang_pair), None)
                        } else {
                            // 其他类型：同时显示在源语言和目标语言
                            (Some(lang_pair.clone()), Some(lang_pair))
                        }
                    };
                    
                    result.push(ModelInfo {
                        model_id: full_model_id,
                        kind: task.clone(),
                        src_lang,
                        tgt_lang,
                    });
                }
            } else {
                tracing::debug!("模型 {} 没有versions字段", model_id);
            }
        }
        
        tracing::info!("成功获取 {} 个模型版本", result.len());
        Ok(result)
    }
}

