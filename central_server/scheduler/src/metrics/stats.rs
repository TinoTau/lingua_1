// 统计数据模块

use crate::core::AppState;
use crate::services::service_catalog::ServiceInfo;
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
    /// 每种 ServiceType 有多少节点正在提供算力（只统计 capability_by_type 中 ready=true 的）
    pub type_node_counts: HashMap<String, usize>,
    /// Model Hub中可用的服务包列表
    pub available_services: Vec<ServiceInfo>,
    /// 服务包总数
    pub total_services: usize,
    /// 每个 ServiceType 有多少节点正在使用（只统计 capability_by_type 中 ready=true 的，已安装未启用不计入）
    pub type_in_use_counts: HashMap<String, usize>,
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
    /// OBS-1: 按服务ID分组的处理效率（最近心跳周期的平均值）
    /// key: 服务ID（如 "faster-whisper-vad", "nmt-m2m100", "piper-tts", "your-tts" 等）
    /// value: 该服务的处理效率
    #[serde(skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub service_efficiencies: std::collections::HashMap<String, f64>,
    /// OBS-1: ASR 处理效率（向后兼容，从 service_efficiencies 中提取）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asr_efficiency: Option<f64>,
    /// OBS-1: NMT 处理效率（向后兼容，从 service_efficiencies 中提取）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nmt_efficiency: Option<f64>,
    /// OBS-1: TTS 处理效率（向后兼容，从 service_efficiencies 中提取）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tts_efficiency: Option<f64>,
}

impl DashboardStats {
    /// 空快照（用于冷启动/降级返回），保证字段结构稳定，避免前端解析失败。
    pub fn empty() -> Self {
        Self {
            web_clients: WebClientStats {
                active_users: 0,
                top_languages: Vec::new(),
                language_usage: HashMap::new(),
            },
            nodes: NodeStats {
                connected_nodes: 0,
                type_node_counts: HashMap::new(),
                available_services: Vec::new(),
                total_services: 0,
                type_in_use_counts: HashMap::new(),
                compute_power: ComputePowerStats {
                    total_cpu_power: 0.0,
                    total_gpu_power: 0.0,
                    total_memory_power: 0.0,
                    node_power_details: Vec::new(),
                },
            },
        }
    }

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
        // Redis 直查：获取所有节点
        let nodes = match state.node_registry.list_sched_nodes().await {
            Ok(n) => n,
            Err(_) => vec![],
        };
        
        // 统计在线节点数
        let connected_nodes = nodes.iter().filter(|n| n.online).count();
        
        // 统计每个 ServiceType 有多少节点提供
        let mut type_node_counts = HashMap::new();
        
        for node in nodes.iter() {
            if !node.online {
                continue;
            }
            
            // 基于 installed_services 统计（ServiceType::all() 单源）
            for service_type in &crate::messages::ServiceType::all() {
                let has_service = node.installed_services.iter().any(|s| &s.r#type == service_type);
                if has_service {
                    let type_str = format!("{:?}", service_type);
                    *type_node_counts.entry(type_str).or_insert(0) += 1;
                }
            }
        }
        
        // 从 ServiceCatalogCache 获取可用服务包列表
        let available_services = state.service_catalog.get_services().await;
        let total_services = available_services.len();

        // 计算算力统计（简化：Redis 直查架构）
        let compute_power = ComputePowerStats {
            total_cpu_power: 0.0,
            total_gpu_power: 0.0,
            total_memory_power: 0.0,
            node_power_details: vec![],
        };

        NodeStats {
            connected_nodes,
            type_node_counts: type_node_counts.clone(),
            available_services,
            total_services,
            type_in_use_counts: type_node_counts,
            compute_power,
        }
    }

}

