//! 压力测试 - 1000 次节点选择
//! 
//! 测试在高并发场景下的性能和稳定性

use lingua_scheduler::redis_runtime::RedisHandle;
use lingua_scheduler::core::config::RedisConnectionConfig;
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::pool::PoolService;
use lingua_scheduler::messages::ServiceType;
use lingua_scheduler::Config;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 开始压力测试 - 1000 次节点选择\n");
    
    // 初始化
    println!("📡 初始化系统...");
    let redis_url = "redis://127.0.0.1:6379";
    let scheduler_config = Config::default().scheduler;
    let redis = match RedisHandle::connect(&RedisConnectionConfig {
        mode: "single".to_string(),
        url: redis_url.to_string(),
        cluster_urls: vec![],
        key_prefix: "scheduler:".to_string(),
    }, &scheduler_config).await {
        Ok(r) => Arc::new(r),
        Err(e) => {
            println!("❌ Redis 连接失败: {}", e);
            return Ok(());
        }
    };
    
    let mut node_registry = NodeRegistry::new(redis.clone());
    node_registry.set_resource_threshold(0.9);
    let node_registry = Arc::new(node_registry);
    
    if let Ok(pool_service) = PoolService::new(redis.clone(), 300).await {
        node_registry.set_pool_service(Arc::new(pool_service)).await;
        println!("✅ 系统初始化完成（含 PoolService）\n");
    } else {
        println!("⚠️ 系统初始化完成（无 PoolService）\n");
    }
    
    // 测试场景配置
    let test_scenarios = vec![
        ("zh", "en", vec![ServiceType::Asr]),
        ("en", "zh", vec![ServiceType::Tts]),
        ("ja", "en", vec![ServiceType::Nmt]),
        ("auto", "en", vec![]),
    ];
    
    // 统计数据
    let mut total_requests = 0;
    let mut successful_requests = 0;
    let mut failed_requests = 0;
    let mut total_duration = Duration::ZERO;
    let mut min_duration = Duration::MAX;
    let mut max_duration = Duration::ZERO;
    let mut durations = Vec::new();
    
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("⚡ 开始压力测试（1000 次请求）");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    let overall_start = Instant::now();
    
    // 执行 1000 次请求
    for i in 0..1000 {
        total_requests += 1;
        
        // 选择测试场景（轮询）
        let (src, tgt, types) = &test_scenarios[i % test_scenarios.len()];
        
        // 计时单次请求
        let start = Instant::now();
        let (selected, _) = node_registry.select_node_redis_direct(
            src,
            tgt,
            types,
            true,
            None,
            0.9,
        ).await;
        let duration = start.elapsed();
        
        // 统计
        durations.push(duration);
        total_duration += duration;
        min_duration = min_duration.min(duration);
        max_duration = max_duration.max(duration);
        
        if selected.is_some() {
            successful_requests += 1;
        } else {
            failed_requests += 1;
        }
        
        // 进度显示
        if (i + 1) % 100 == 0 {
            let progress = (i + 1) as f64 / 1000.0 * 100.0;
            let avg_ms = (total_duration.as_micros() / (i + 1) as u128) as f64 / 1000.0;
            println!("进度: {:4}/1000 ({:5.1}%) | 平均: {:.2}ms | 成功率: {:.1}%",
                i + 1, progress, avg_ms,
                (successful_requests as f64 / (i + 1) as f64) * 100.0
            );
        }
    }
    
    let overall_duration = overall_start.elapsed();
    
    // 计算统计数据
    let avg_duration = total_duration / total_requests as u32;
    
    // 计算 P50, P95, P99
    durations.sort();
    let p50 = durations[durations.len() / 2];
    let p95 = durations[durations.len() * 95 / 100];
    let p99 = durations[durations.len() * 99 / 100];
    
    // 输出结果
    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📊 压力测试结果");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    println!("请求统计:");
    println!("  总请求数:     {}", total_requests);
    println!("  成功请求:     {} ({:.1}%)", successful_requests, 
        (successful_requests as f64 / total_requests as f64) * 100.0);
    println!("  失败请求:     {} ({:.1}%)", failed_requests,
        (failed_requests as f64 / total_requests as f64) * 100.0);
    
    println!("\n性能指标:");
    println!("  总耗时:       {:?}", overall_duration);
    println!("  平均延迟:     {:?}", avg_duration);
    println!("  最小延迟:     {:?}", min_duration);
    println!("  最大延迟:     {:?}", max_duration);
    println!("  P50 延迟:     {:?}", p50);
    println!("  P95 延迟:     {:?}", p95);
    println!("  P99 延迟:     {:?}", p99);
    
    let qps = total_requests as f64 / overall_duration.as_secs_f64();
    println!("\n吞吐量:");
    println!("  QPS:          {:.0} 请求/秒", qps);
    println!("  每秒处理:     {:.0} 次选择", qps);
    
    println!("\n稳定性:");
    let variance = durations.iter()
        .map(|d| {
            let diff = d.as_micros() as i128 - avg_duration.as_micros() as i128;
            (diff * diff) as f64
        })
        .sum::<f64>() / durations.len() as f64;
    let std_dev = variance.sqrt();
    println!("  标准差:       {:.2} μs", std_dev);
    println!("  变异系数:     {:.2}%", 
        (std_dev / avg_duration.as_micros() as f64) * 100.0);
    
    // 性能评级
    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("⭐ 性能评级");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    let avg_ms = avg_duration.as_micros() as f64 / 1000.0;
    let rating = if avg_ms < 5.0 {
        "🌟🌟🌟🌟🌟 优秀 (< 5ms)"
    } else if avg_ms < 10.0 {
        "🌟🌟🌟🌟 良好 (< 10ms)"
    } else if avg_ms < 20.0 {
        "🌟🌟🌟 一般 (< 20ms)"
    } else if avg_ms < 50.0 {
        "🌟🌟 需要优化 (< 50ms)"
    } else {
        "🌟 性能较差 (≥ 50ms)"
    };
    
    println!("平均延迟评级: {}", rating);
    
    let success_rate = (successful_requests as f64 / total_requests as f64) * 100.0;
    let reliability_rating = if success_rate >= 95.0 {
        "🌟🌟🌟🌟🌟 优秀 (≥ 95%)"
    } else if success_rate >= 90.0 {
        "🌟🌟🌟🌟 良好 (≥ 90%)"
    } else if success_rate >= 80.0 {
        "🌟🌟🌟 一般 (≥ 80%)"
    } else {
        "🌟🌟 需要改进 (< 80%)"
    };
    
    println!("可靠性评级:   {}", reliability_rating);
    
    let qps_rating = if qps >= 100.0 {
        "🌟🌟🌟🌟🌟 优秀 (≥ 100 QPS)"
    } else if qps >= 50.0 {
        "🌟🌟🌟🌟 良好 (≥ 50 QPS)"
    } else if qps >= 20.0 {
        "🌟🌟🌟 一般 (≥ 20 QPS)"
    } else {
        "🌟🌟 需要优化 (< 20 QPS)"
    };
    
    println!("吞吐量评级:   {}", qps_rating);
    
    println!("\n🎉 压力测试完成！");
    
    Ok(())
}
