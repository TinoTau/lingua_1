# 测试命令集合
# 用于逐个测试或批量测试

Write-Host "=== 单元测试命令集合 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 单个测试（不依赖 Redis）
Write-Host "1. 不依赖 Redis 的测试:" -ForegroundColor Yellow
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_pool_config_fallback_to_local -- --exact" -ForegroundColor White
Write-Host ""

# 2. 需要 Redis 的测试（会自动跳过如果 Redis 不可用）
Write-Host "2. 需要 Redis 的测试（会自动跳过如果 Redis 不可用）:" -ForegroundColor Yellow
Write-Host "   # phase3_pool_redis_test.rs" -ForegroundColor Gray
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_pool_leader_election -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_pool_config_redis_sync -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_rebuild_auto_language_pools_with_redis -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_pool_config_sync_multiple_instances -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_pool_leader_failover -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_redis_write_failure_behavior -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_local_redis_config_consistency -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_multi_instance_config_sync_consistency -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_redis_write_retry_mechanism -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test::tests::test_try_create_pool_for_node_sync_to_redis -- --exact" -ForegroundColor White
Write-Host ""

# 3. 批量测试
Write-Host "3. 批量测试:" -ForegroundColor Yellow
Write-Host "   # 所有 phase3_pool_redis_test 测试" -ForegroundColor Gray
Write-Host "   cargo test --lib node_registry::phase3_pool_redis_test -- --test-threads=1" -ForegroundColor White
Write-Host ""
Write-Host "   # 所有 node_registry 测试" -ForegroundColor Gray
Write-Host "   cargo test --lib node_registry -- --test-threads=1" -ForegroundColor White
Write-Host ""
Write-Host "   # 所有测试（单线程，避免并发问题）" -ForegroundColor Gray
Write-Host "   cargo test --lib -- --test-threads=1" -ForegroundColor White
Write-Host ""

# 4. 其他测试文件
Write-Host "4. 其他测试文件:" -ForegroundColor Yellow
Write-Host "   # phase3_pool_heartbeat_test" -ForegroundColor Gray
Write-Host "   cargo test --lib node_registry::phase3_pool_heartbeat_test -- --test-threads=1" -ForegroundColor White
Write-Host ""
Write-Host "   # auto_language_pool_test" -ForegroundColor Gray
Write-Host "   cargo test --lib node_registry::auto_language_pool_test -- --test-threads=1" -ForegroundColor White
Write-Host ""
Write-Host "   # phase3_pool_registration_test" -ForegroundColor Gray
Write-Host "   cargo test --lib node_registry::phase3_pool_registration_test -- --test-threads=1" -ForegroundColor White
Write-Host ""

# 5. 快速验证（不依赖 Redis）
Write-Host "5. 快速验证（不依赖 Redis）:" -ForegroundColor Yellow
Write-Host "   cargo test --lib node_registry::management_state_test -- --exact" -ForegroundColor White
Write-Host "   cargo test --lib node_registry::auto_language_pool_test::tests::test_auto_generate_language_pair_pools_basic -- --exact" -ForegroundColor White
Write-Host ""

Write-Host "=== 使用说明 ===" -ForegroundColor Cyan
Write-Host "  - 使用 --test-threads=1 避免并发问题" -ForegroundColor White
Write-Host "  - 需要 Redis 的测试会在 Redis 不可用时自动跳过（1秒内）" -ForegroundColor White
Write-Host "  - 如果测试卡住，按 Ctrl+C 中断" -ForegroundColor White
Write-Host ""
