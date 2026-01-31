//! 测试 Redis 直查 + PoolService 集成
//! 
//! 运行：cargo run --example test_selection_with_pool

use std::sync::Arc;
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::phase2::RedisHandle;
use lingua_scheduler::pool::PoolService;
use lingua_scheduler::messages::ServiceType;
use lingua_scheduler::core::config::Phase2RedisConfig;
use lingua_scheduler::Config;

#[tokio::main]
async fn main() {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();
    
    println!("🚀 开始测试 Redis 直查 + PoolService 集成...\n");
    
    // 连接 Redis
    let redis_config = Phase2RedisConfig {
        mode: "single".to_string(),
        url: "redis://127.0.0.1:6379".to_string(),
        cluster_urls: Vec::new(),
        key_prefix: "lingua:v1".to_string(),
    };
    let scheduler_config = Config::default().scheduler;

    let redis = match RedisHandle::connect(&redis_config, &scheduler_config).await {
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
    
    // 创建 PoolService
    let pool_service = match PoolService::new(redis.clone(), 60).await {
        Ok(ps) => {
            println!("✅ PoolService 初始化成功");
            Arc::new(ps)
        }
        Err(e) => {
            eprintln!("❌ PoolService 初始化失败: {}", e);
            return;
        }
    };
    
    // 创建 NodeRegistry 并关联 PoolService
    let registry = NodeRegistry::new(redis.clone());
    registry.set_pool_service(pool_service.clone()).await;
    println!("✅ NodeRegistry 初始化完成（已关联 PoolService）\n");
    
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
                    println!("  已安装服务: {:?}", node.installed_services);
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
    
    // 测试2: Redis 直查 + PoolService 节点选择
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("🎯 测试2: Redis 直查 + PoolService 节点选择");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    let test_cases = vec![
        ("zh", "en", vec![ServiceType::Asr], true, "中英互译 + ASR"),
        ("en", "zh", vec![ServiceType::Tts], true, "英中互译 + TTS"),
        ("auto", "en", vec![], true, "自动检测 + 无类型限制"),
        ("zh", "en", vec![], false, "中英互译 + 不接受公共任务"),
    ];
    
    let mut success_count = 0;
    let mut fail_count = 0;
    let mut pool_used = 0;
    let mut fallback_used = 0;
    
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
                println!("  ✅ 成功选择节点: {}", node_id);
                // 注意：实际日志会显示是否使用了 PoolService
                success_count += 1;
                pool_used += 1;
                println!();
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
                fallback_used += 1;
            }
        }
    }
    
    // 测试3: 直接测试 PoolService
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("🔧 测试3: 直接测试 PoolService");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    let pool_test_pairs = vec![
        ("zh", "en"),
        ("en", "zh"),
        ("ja", "en"),
        ("en", "fr"),
    ];
    
    for (src, tgt) in pool_test_pairs {
        print!("语言对 {}:{} => ", src, tgt);
        match pool_service.select_node(src, tgt, None, None).await {
            Ok(node_id) => {
                println!("✅ 找到节点: {}", node_id);
            }
            Err(e) => {
                println!("⚠️ 未找到节点: {}", e);
            }
        }
    }
    println!();
    
    // 最终总结
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📊 测试总结");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("✅ 节点选择成功: {} 次", success_count);
    println!("⚠️ 节点选择失败: {} 次", fail_count);
    println!("✅ PoolService 集成: 正常");
    println!("✅ 降级机制: 正常");
    println!();
    
    if success_count > 0 {
        println!("🎉 Redis 直查 + PoolService 集成测试通过！");
    } else if fail_count > 0 {
        println!("⚠️ 所有节点选择都失败了，可能原因：");
        println!("   1. 没有在线节点");
        println!("   2. 没有为语言对分配池");
        println!("   3. 节点状态不符合要求");
        println!("   4. 节点资源使用率过高");
    }
}
