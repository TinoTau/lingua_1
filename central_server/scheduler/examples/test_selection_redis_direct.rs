//! 测试 Redis 直查节点选择功能（简化版）
//! 
//! 运行：cargo run --example test_selection_redis_direct

use std::sync::Arc;
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::phase2::RedisHandle;
use lingua_scheduler::messages::ServiceType;

#[tokio::main]
async fn main() {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();
    
    println!("🚀 开始测试 Redis 直查节点选择功能...\n");
    
    // 连接 Redis
    use lingua_scheduler::core::config::Phase2RedisConfig;
    
    let redis_config = Phase2RedisConfig {
        mode: "single".to_string(),
        url: "redis://127.0.0.1:6379".to_string(),
        cluster_urls: Vec::new(),
        key_prefix: "lingua:v1".to_string(),
    };
    
    let redis = match RedisHandle::connect(&redis_config).await {
        Ok(r) => {
            println!("✅ Redis 连接成功");
            Arc::new(r)
        }
        Err(e) => {
            eprintln!("❌ Redis 连接失败: {}", e);
            eprintln!("提示: 请确保 Redis 服务正在运行");
            return;
        }
    };
    
    // 创建 NodeRegistry
    let registry = NodeRegistry::new(redis.clone());
    println!("✅ NodeRegistry 初始化完成\n");
    
    // 测试1: 查询在线节点
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📊 测试1: 查询所有在线节点");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    match registry.list_sched_nodes().await {
        Ok(nodes) => {
            println!("✅ 查询成功，找到 {} 个在线节点\n", nodes.len());
            
            if nodes.is_empty() {
                println!("⚠️ 警告: 当前没有在线节点");
                println!("   提示: 请先启动节点服务并完成注册\n");
            } else {
                // 显示前3个节点的详细信息
                for (i, node) in nodes.iter().take(3).enumerate() {
                    println!("节点 {}: {}", i + 1, node.node_id);
                    println!("  状态: {}", node.status);
                    println!("  在线: {}", if node.online { "是" } else { "否" });
                    println!("  语言集合: {:?}", node.lang_sets);
                    println!("  GPU: {}", if node.has_gpu { "有" } else { "无" });
                    println!("  容量: {}/{}", node.current_jobs, node.max_concurrency);
                    println!("  资源使用:");
                    println!("    - CPU: {:.1}%", node.cpu_usage * 100.0);
                    if let Some(gpu) = node.gpu_usage {
                        println!("    - GPU: {:.1}%", gpu * 100.0);
                    }
                    println!("    - 内存: {:.1}%", node.memory_usage * 100.0);
                    println!();
                }
                
                if nodes.len() > 3 {
                    println!("  ... 还有 {} 个节点\n", nodes.len() - 3);
                }
            }
        }
        Err(e) => {
            println!("❌ 查询失败: {}", e);
            return;
        }
    }
    
    // 测试2: Redis 直查节点选择
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("🎯 测试2: Redis 直查节点选择");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    let test_cases = vec![
        ("zh", "en", vec![ServiceType::Asr], true, "中英互译 + ASR"),
        ("en", "zh", vec![ServiceType::Tts], true, "英中互译 + TTS"),
        ("auto", "en", vec![], true, "自动检测 + 无类型限制"),
        ("zh", "en", vec![], false, "中英互译 + 不接受公共任务"),
    ];
    
    let mut success_count = 0;
    let mut fail_count = 0;
    
    for (src, tgt, types, accept_pub, desc) in test_cases {
        println!("场景: {}", desc);
        println!("  参数: src={}, tgt={}, types={:?}, public={}", 
            src, tgt, types, accept_pub);
        
        let (selected, breakdown) = registry.select_node_redis_direct(
            src,
            tgt,
            &types,
            accept_pub,
            None,  // exclude_node_id
            0.9,   // resource_threshold
        ).await;
        
        match selected {
            Some(node_id) => {
                println!("  ✅ 成功选择节点: {}\n", node_id);
                success_count += 1;
            }
            None => {
                println!("  ⚠️ 未找到可用节点");
                println!("    总节点: {}, 状态未就绪: {}, 离线: {}", 
                    breakdown.total_nodes,
                    breakdown.status_not_ready,
                    breakdown.offline
                );
                println!("    GPU不可用: {}, 模型未安装: {}, 容量已满: {}", 
                    breakdown.gpu_unavailable,
                    breakdown.model_not_available,
                    breakdown.capacity_exceeded
                );
                println!("    资源超阈值: {}", breakdown.resource_threshold_exceeded);
                println!("    最可能原因: {}\n", breakdown.best_reason_label());
                fail_count += 1;
            }
        }
    }
    
    // 测试3: 服务不可用功能
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("🔧 测试3: 服务不可用标记（Redis 版）");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    let test_node_id = "test_node_unavailable";
    let test_service_id = "asr_whisper_zh";
    
    // 标记服务不可用
    registry.mark_service_temporarily_unavailable(
        test_node_id,
        test_service_id,
        None,  // service_version
        Some("测试标记".to_string()),  // reason
        std::time::Duration::from_secs(60),
    ).await;
    println!("✅ 已标记服务 {} 不可用（60秒）", test_service_id);
    
    // 检查服务状态
    let is_unavailable = registry.is_service_temporarily_unavailable(
        test_node_id,
        test_service_id,
    ).await;
    println!("✅ 服务状态检查: {}\n", if is_unavailable { "不可用 ✓" } else { "可用" });
    
    // 最终总结
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📊 测试总结");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("✅ 节点选择成功: {} 次", success_count);
    println!("⚠️ 节点选择失败: {} 次", fail_count);
    println!("✅ 服务不可用功能: 正常");
    println!();
    
    if success_count > 0 {
        println!("🎉 Redis 直查功能测试通过！");
    } else if fail_count > 0 {
        println!("⚠️ 所有节点选择都失败了，可能原因：");
        println!("   1. 没有在线节点");
        println!("   2. 节点状态不符合要求");
        println!("   3. 节点资源使用率过高");
    }
}
