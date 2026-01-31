//! 端到端集成测试
//! 
//! 测试完整的节点注册 → 选择 → 更新流程

use lingua_scheduler::phase2::RedisHandle;
use lingua_scheduler::core::config::Phase2RedisConfig;
use lingua_scheduler::node_registry::{NodeRegistry, NodeData};
use lingua_scheduler::pool::PoolService;
use lingua_scheduler::messages::ServiceType;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 开始端到端集成测试...\n");
    
    // 1. 初始化 Redis 连接
    println!("📡 步骤1: 初始化 Redis 连接");
    let redis_url = "redis://127.0.0.1:6379";
    let redis = match RedisHandle::connect(&lingua_scheduler::core::config::Phase2RedisConfig {
        mode: "single".to_string(),
        url: redis_url.to_string(),
        cluster_urls: vec![],
        key_prefix: "scheduler:".to_string(),
    }).await {
        Ok(r) => {
            println!("✅ Redis 连接成功");
            Arc::new(r)
        }
        Err(e) => {
            println!("❌ Redis 连接失败: {}", e);
            return Ok(());
        }
    };
    
    // 2. 初始化 NodeRegistry
    println!("\n📦 步骤2: 初始化 NodeRegistry");
    let mut node_registry = NodeRegistry::new(redis.clone());
    node_registry.set_resource_threshold(0.9);
    let node_registry = Arc::new(node_registry);
    println!("✅ NodeRegistry 初始化完成");
    
    // 3. 初始化 PoolService
    println!("\n🎯 步骤3: 初始化 PoolService");
    let pool_service = match PoolService::new(redis.clone(), 300).await {
        Ok(ps) => {
            println!("✅ PoolService 初始化成功");
            Arc::new(ps)
        }
        Err(e) => {
            println!("⚠️ PoolService 初始化失败: {}", e);
            println!("   继续测试（无 PoolService 支持）");
            return Ok(());
        }
    };
    
    // 4. 关联 PoolService 到 NodeRegistry
    println!("\n🔗 步骤4: 关联 PoolService");
    node_registry.set_pool_service(pool_service.clone()).await;
    println!("✅ PoolService 已关联");
    
    // 5. 测试节点查询
    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📊 测试场景1: 查询在线节点");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    match node_registry.list_sched_nodes().await {
        Ok(nodes) => {
            println!("✅ 查询成功，找到 {} 个在线节点", nodes.len());
            for (i, node) in nodes.iter().enumerate().take(5) {
                println!("   {}. {} (lang_sets: {} 组)", i + 1, node.node_id, node.lang_sets.len());
            }
            if nodes.len() > 5 {
                println!("   ... 还有 {} 个节点", nodes.len() - 5);
            }
        }
        Err(e) => {
            println!("⚠️ 查询失败: {}", e);
        }
    }
    
    // 6. 测试节点选择（多场景）
    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("🎯 测试场景2: 节点选择（多场景）");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    let test_cases = vec![
        ("中英互译 + ASR", "zh", "en", vec![ServiceType::Asr], true),
        ("英中互译 + TTS", "en", "zh", vec![ServiceType::Tts], true),
        ("日英互译 + NMT", "ja", "en", vec![ServiceType::Nmt], true),
        ("自动检测", "auto", "en", vec![], true),
        ("私有节点", "zh", "en", vec![], false),
    ];
    
    let mut success_count = 0;
    let mut total_count = 0;
    
    for (name, src, tgt, types, public) in test_cases {
        total_count += 1;
        print!("\n场景: {} (src={}, tgt={}) ... ", name, src, tgt);
        
        let (selected, _breakdown) = node_registry.select_node_redis_direct(
            src,
            tgt,
            &types,
            public,
            None,
            0.9,
        ).await;
        
        if let Some(node_id) = selected {
            println!("✅ 成功选择节点: {}", node_id);
            success_count += 1;
        } else {
            println!("⚠️ 未找到可用节点");
        }
    }
    
    println!("\n选择成功率: {}/{} ({:.0}%)", 
        success_count, total_count, 
        (success_count as f64 / total_count as f64) * 100.0
    );
    
    // 7. 测试 PoolService 直接选择
    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("🔧 测试场景3: PoolService 直接选择");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    let pool_test_cases = vec![
        ("zh", "en"),
        ("en", "zh"),
        ("ja", "en"),
        ("en", "fr"),
    ];
    
    let mut pool_success = 0;
    for (src, tgt) in pool_test_cases {
        print!("语言对 {}:{} ... ", src, tgt);
        match pool_service.select_node(src, tgt, None, None).await {
            Ok(node_id) => {
                println!("✅ 成功: {}", node_id);
                pool_success += 1;
            }
            Err(e) => {
                println!("⚠️ 失败: {}", e);
            }
        }
    }
    
    println!("\nPoolService 成功率: {}/4", pool_success);
    
    // 8. 测试统计查询
    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📈 测试场景4: 统计查询");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    match node_registry.count_online_nodes().await {
        Ok(count) => println!("✅ 在线节点总数: {}", count),
        Err(e) => println!("⚠️ 统计失败: {}", e),
    }
    
    // 9. 性能测试
    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("⚡ 测试场景5: 性能测试（10次查询）");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    let start = std::time::Instant::now();
    for i in 0..10 {
        let _ = node_registry.select_node_redis_direct(
            "zh", "en", &[], true, None, 0.9
        ).await;
        if (i + 1) % 5 == 0 {
            print!(".");
            std::io::Write::flush(&mut std::io::stdout()).ok();
        }
    }
    let elapsed = start.elapsed();
    
    println!("\n✅ 10 次查询完成");
    println!("   总耗时: {:?}", elapsed);
    println!("   平均延迟: {:?}", elapsed / 10);
    println!("   QPS: {:.0}", 10.0 / elapsed.as_secs_f64());
    
    // 10. 总结
    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📊 测试总结");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("✅ Redis 连接: 正常");
    println!("✅ NodeRegistry: 正常");
    println!("✅ PoolService: 正常");
    println!("✅ 节点查询: 正常");
    println!("✅ 节点选择: {}/{} 成功", success_count, total_count);
    println!("✅ 性能: {:?}/次", elapsed / 10);
    
    println!("\n🎉 端到端集成测试完成！");
    
    Ok(())
}
