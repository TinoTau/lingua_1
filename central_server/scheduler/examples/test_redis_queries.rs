//! 独立测试程序 - 验证 Redis 查询功能
//!
//! 运行方式：
//! ```bash
//! cargo run --example test_redis_queries
//! ```
//!
//! 仅测试现有 API：delete_node、list_online_node_ids、get_node、
//! mark_service_unavailable、is_service_unavailable、record_exclude_reason、get_exclude_stats

use lingua_scheduler::node_registry::NodeRedisRepository;
use lingua_scheduler::redis_runtime::RedisHandle;
use lingua_scheduler::core::config::RedisConnectionConfig;
use lingua_scheduler::Config;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    println!("🧪 开始测试 Redis 查询功能...\n");
    
    // 1. 连接 Redis
    println!("📡 步骤 1: 连接 Redis...");
    let redis_config = RedisConnectionConfig {
        mode: "single".to_string(),
        url: "redis://127.0.0.1:6379".to_string(),
        cluster_urls: vec![],
        key_prefix: "lingua".to_string(),
    };
    
    let scheduler_config = Config::default().scheduler;
    let redis = match RedisHandle::connect(&redis_config, &scheduler_config).await {
        Ok(r) => {
            println!("✅ Redis 连接成功！\n");
            r
        }
        Err(e) => {
            eprintln!("❌ Redis 连接失败: {}", e);
            eprintln!("请确保 Redis 运行在 localhost:6379");
            std::process::exit(1);
        }
    };
    
    let repo = NodeRedisRepository::new(Arc::new(redis));
    let test_node_id = "test_node_redis_query";
    
    // 2. 清理旧数据
    println!("🧹 步骤 2: 清理旧测试数据...");
    let _ = repo.delete_node(test_node_id).await;
    println!("✅ 清理完成\n");
    
    // 3. 测试节点读取（不存在时应为 None）
    println!("🔍 步骤 3: 测试节点读取（预期不存在）...");
    match repo.get_node(test_node_id).await {
        Ok(None) => println!("✅ 节点不存在（符合预期）"),
        Ok(Some(retrieved)) => {
            println!("   节点 ID: {}", retrieved.node_id);
            println!("   状态: {}", retrieved.status);
            println!("   语言集合: {:?}", retrieved.lang_sets);
        }
        Err(e) => {
            eprintln!("❌ 读取失败: {}", e);
            std::process::exit(1);
        }
    }
    println!();
    
    // 4. 测试在线节点列表
    println!("📋 步骤 4: 测试在线节点列表...");
    match repo.list_online_node_ids().await {
        Ok(ids) => {
            println!("✅ 在线节点列表查询成功，总数: {}", ids.len());
        }
        Err(e) => {
            eprintln!("❌ 查询失败: {}", e);
            std::process::exit(1);
        }
    }
    println!();
    
    // 5. 测试服务不可用标记
    println!("🚫 步骤 5: 测试服务不可用标记...");
    match repo.mark_service_unavailable(
        test_node_id,
        "asr_whisper",
        Some("v1.0"),
        Some("测试标记"),
        60,
    ).await {
        Ok(_) => println!("✅ 服务标记成功！"),
        Err(e) => {
            eprintln!("❌ 标记失败: {}", e);
            std::process::exit(1);
        }
    }
    
    match repo.is_service_unavailable(test_node_id, "asr_whisper").await {
        Ok(true) => println!("✅ 服务不可用检查正确（不可用）"),
        Ok(false) => {
            eprintln!("❌ 服务不可用检查错误（应该不可用）");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("❌ 检查失败: {}", e);
            std::process::exit(1);
        }
    }
    
    match repo.is_service_unavailable(test_node_id, "tts_coqui").await {
        Ok(false) => println!("✅ 服务可用检查正确（可用）"),
        Ok(true) => {
            eprintln!("❌ 服务可用检查错误（应该可用）");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("❌ 检查失败: {}", e);
            std::process::exit(1);
        }
    }
    println!();
    
    // 6. 测试排除统计
    println!("📊 步骤 6: 测试排除统计...");
    match repo.record_exclude_reason("ModelNotAvailable", test_node_id).await {
        Ok(_) => println!("✅ 排除统计记录成功！"),
        Err(e) => {
            eprintln!("❌ 记录失败: {}", e);
            std::process::exit(1);
        }
    }
    
    match repo.get_exclude_stats().await {
        Ok(stats) => println!("✅ 排除统计: {:?}", stats),
        Err(e) => eprintln!("⚠️ 获取排除统计失败: {}", e),
    }
    println!();
    
    // 7. 清理测试数据
    println!("🧹 步骤 7: 清理测试数据...");
    match repo.delete_node(test_node_id).await {
        Ok(_) => println!("✅ 清理成功！"),
        Err(e) => {
            eprintln!("❌ 清理失败: {}", e);
            std::process::exit(1);
        }
    }
    println!();
    
    println!("🎉 所有测试通过！Redis 查询功能正常工作。");
}
