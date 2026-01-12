# 逐个运行测试，找出卡住的测试

$ErrorActionPreference = "Continue"
$tests = @(
    # phase3_pool_redis_test.rs
    "node_registry::phase3_pool_redis_test::tests::test_pool_leader_election",
    "node_registry::phase3_pool_redis_test::tests::test_pool_config_redis_sync",
    "node_registry::phase3_pool_redis_test::tests::test_rebuild_auto_language_pools_with_redis",
    "node_registry::phase3_pool_redis_test::tests::test_pool_config_sync_multiple_instances",
    "node_registry::phase3_pool_redis_test::tests::test_pool_leader_failover",
    "node_registry::phase3_pool_redis_test::tests::test_pool_config_fallback_to_local",
    "node_registry::phase3_pool_redis_test::tests::test_redis_write_failure_behavior",
    "node_registry::phase3_pool_redis_test::tests::test_local_redis_config_consistency",
    "node_registry::phase3_pool_redis_test::tests::test_multi_instance_config_sync_consistency",
    "node_registry::phase3_pool_redis_test::tests::test_redis_write_retry_mechanism",
    "node_registry::phase3_pool_redis_test::tests::test_try_create_pool_for_node_sync_to_redis",
    
    # phase3_pool_heartbeat_test.rs
    "node_registry::phase3_pool_heartbeat_test::tests::test_heartbeat_pool_membership_update_on_language_change",
    "node_registry::phase3_pool_heartbeat_test::tests::test_heartbeat_pool_membership_sync_to_redis",
    
    # auto_language_pool_test.rs
    "node_registry::auto_language_pool_test::tests::test_auto_generate_language_pair_pools_basic",
    "node_registry::auto_language_pool_test::tests::test_language_pairs_filtered_by_semantic_service",
    "node_registry::auto_language_pool_test::tests::test_language_pairs_with_semantic_service_supporting_both_languages",
    "node_registry::auto_language_pool_test::tests::test_auto_generate_language_pair_pools_min_nodes_filter",
    "node_registry::auto_language_pool_test::tests::test_auto_generate_language_pair_pools_multiple_pairs",
    "node_registry::auto_language_pool_test::tests::test_node_allocation_requires_semantic_service_languages",
    "node_registry::auto_language_pool_test::tests::test_node_allocation_with_semantic_service_supporting_both_languages",
    "node_registry::auto_language_pool_test::tests::test_dynamic_pool_creation_for_new_language_pair",
    "node_registry::auto_language_pool_test::tests::test_auto_generate_language_pair_pools_max_pools_limit",
    
    # phase3_pool_registration_test.rs
    "node_registry::phase3_pool_registration_test::tests::test_node_registration_pool_allocation",
    "node_registry::phase3_pool_registration_test::tests::test_node_registration_multiple_nodes_different_languages",
    "node_registry::phase3_pool_registration_test::tests::test_node_registration_pool_config_not_cleared"
)

$results = @()
$timeoutSeconds = 30

foreach ($test in $tests) {
    Write-Host "`n=== 测试: $test ===" -ForegroundColor Cyan
    Write-Host "开始时间: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
    
    $startTime = Get-Date
    $job = Start-Job -ScriptBlock {
        param($testName)
        Set-Location $using:PWD
        cargo test --lib $testName -- --exact --nocapture 2>&1
    } -ArgumentList $test
    
    $completed = $job | Wait-Job -Timeout $timeoutSeconds
    
    if ($completed) {
        $output = $job | Receive-Job
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        
        $status = "完成"
        if ($output -match "test result: ok") {
            $status = "通过"
            Write-Host "✓ 通过 (耗时: $([math]::Round($duration, 2))秒)" -ForegroundColor Green
        } elseif ($output -match "test result: FAILED") {
            $status = "失败"
            Write-Host "✗ 失败 (耗时: $([math]::Round($duration, 2))秒)" -ForegroundColor Red
            Write-Host $output -ForegroundColor Yellow
        } else {
            Write-Host "? 未知状态 (耗时: $([math]::Round($duration, 2))秒)" -ForegroundColor Yellow
            Write-Host $output -ForegroundColor Yellow
        }
        
        $results += [PSCustomObject]@{
            Test = $test
            Status = $status
            Duration = [math]::Round($duration, 2)
        }
    } else {
        Write-Host "✗ 超时 (超过 $timeoutSeconds 秒)" -ForegroundColor Red
        Stop-Job $job
        Remove-Job $job -Force
        
        $results += [PSCustomObject]@{
            Test = $test
            Status = "超时"
            Duration = $timeoutSeconds
        }
    }
    
    Remove-Job $job -ErrorAction SilentlyContinue
}

Write-Host "`n=== 测试总结 ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$timeoutCount = ($results | Where-Object { $_.Status -eq "超时" }).Count
$failedCount = ($results | Where-Object { $_.Status -eq "失败" }).Count
$passedCount = ($results | Where-Object { $_.Status -eq "通过" }).Count

Write-Host "总计: $($results.Count) 个测试" -ForegroundColor White
Write-Host "通过: $passedCount" -ForegroundColor Green
Write-Host "失败: $failedCount" -ForegroundColor Red
Write-Host "超时: $timeoutCount" -ForegroundColor Red

if ($timeoutCount -gt 0) {
    Write-Host "`n超时的测试:" -ForegroundColor Yellow
    $results | Where-Object { $_.Status -eq "超时" } | ForEach-Object {
        Write-Host "  - $($_.Test)" -ForegroundColor Yellow
    }
}
