# 测试服务自动启动配置功能
# 测试内容：
# 1. 检查节点端是否连接到调度服务器
# 2. 测试手动启动服务时配置自动更新
# 3. 测试手动关闭服务时配置自动更新
# 4. 测试语言对列表上报

param(
    [string]$SchedulerUrl = "http://127.0.0.1:5010",
    [string]$NodeConfigPath = ""
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "服务自动启动配置测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查调度服务器状态
Write-Host "1. 检查调度服务器状态..." -ForegroundColor Yellow
try {
    $statsResponse = Invoke-RestMethod -Uri "$SchedulerUrl/api/v1/stats" -Method Get -TimeoutSec 5
    $connectedNodes = $statsResponse.nodes.connected_nodes
    Write-Host "   ✓ 调度服务器运行正常" -ForegroundColor Green
    Write-Host "   - 已连接节点数: $connectedNodes" -ForegroundColor Gray
    
    if ($connectedNodes -gt 0) {
        $nodeIds = $statsResponse.nodes.node_ids
        Write-Host "   - 节点ID: $($nodeIds -join ', ')" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠ 警告: 没有节点连接到调度服务器" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ✗ 无法连接到调度服务器: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# 2. 检查节点配置路径
Write-Host "2. 检查节点配置路径..." -ForegroundColor Yellow
if ([string]::IsNullOrEmpty($NodeConfigPath)) {
    # 尝试查找默认配置路径
    $appDataPath = $env:APPDATA
    if ([string]::IsNullOrEmpty($appDataPath)) {
        $appDataPath = "$env:HOME/.config"
    }
    $NodeConfigPath = Join-Path $appDataPath "electron-node\electron-node-config.json"
}

if (Test-Path $NodeConfigPath) {
    Write-Host "   ✓ 找到配置文件: $NodeConfigPath" -ForegroundColor Green
    $config = Get-Content $NodeConfigPath | ConvertFrom-Json
    Write-Host "   - 当前配置:" -ForegroundColor Gray
    Write-Host "     * rustEnabled: $($config.servicePreferences.rustEnabled)" -ForegroundColor Gray
    Write-Host "     * nmtEnabled: $($config.servicePreferences.nmtEnabled)" -ForegroundColor Gray
    Write-Host "     * ttsEnabled: $($config.servicePreferences.ttsEnabled)" -ForegroundColor Gray
    Write-Host "     * fasterWhisperVadEnabled: $($config.servicePreferences.fasterWhisperVadEnabled)" -ForegroundColor Gray
    if ($config.servicePreferences.semanticRepairZhEnabled) {
        Write-Host "     * semanticRepairZhEnabled: $($config.servicePreferences.semanticRepairZhEnabled)" -ForegroundColor Gray
    }
    if ($config.servicePreferences.semanticRepairEnEnabled) {
        Write-Host "     * semanticRepairEnEnabled: $($config.servicePreferences.semanticRepairEnEnabled)" -ForegroundColor Gray
    }
    if ($config.servicePreferences.enNormalizeEnabled) {
        Write-Host "     * enNormalizeEnabled: $($config.servicePreferences.enNormalizeEnabled)" -ForegroundColor Gray
    }
} else {
    Write-Host "   ⚠ 配置文件不存在: $NodeConfigPath" -ForegroundColor Yellow
    Write-Host "   请确保节点端已启动并创建配置文件" -ForegroundColor Yellow
}

Write-Host ""

# 3. 检查节点上报的语言能力
Write-Host "3. 检查节点上报的语言能力..." -ForegroundColor Yellow
try {
    $statsResponse = Invoke-RestMethod -Uri "$SchedulerUrl/api/v1/stats" -Method Get -TimeoutSec 5
    
    if ($statsResponse.nodes.connected_nodes -gt 0) {
        # 尝试获取节点详细信息（如果API支持）
        Write-Host "   ✓ 节点已连接" -ForegroundColor Green
        
        # 检查是否有语言对信息
        if ($statsResponse.nodes.available_services) {
            $serviceCount = $statsResponse.nodes.available_services.Count
            Write-Host "   - 可用服务数: $serviceCount" -ForegroundColor Gray
        }
        
        # 检查服务节点计数
        if ($statsResponse.nodes.service_node_counts) {
            Write-Host "   - 服务节点计数:" -ForegroundColor Gray
            $serviceNodeCounts = $statsResponse.nodes.service_node_counts
            foreach ($serviceId in $serviceNodeCounts.PSObject.Properties.Name) {
                $count = $serviceNodeCounts.$serviceId
                Write-Host "     * $serviceId : $count 个节点" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "   ⚠ 没有节点连接" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ✗ 无法获取节点信息: $_" -ForegroundColor Red
}

Write-Host ""

# 4. 测试说明
Write-Host "4. 手动测试步骤:" -ForegroundColor Yellow
Write-Host "   请按照以下步骤在节点端UI中手动测试:" -ForegroundColor White
Write-Host ""
Write-Host "   测试 1: 手动启动服务" -ForegroundColor Cyan
Write-Host "   1. 在节点端UI中，确保某个服务（如 NMT）的自动启动为关闭状态" -ForegroundColor Gray
Write-Host "   2. 手动启动该服务" -ForegroundColor Gray
Write-Host "   3. 检查配置文件，确认自动启动已更新为 true" -ForegroundColor Gray
Write-Host "   4. 查看节点端日志，应该看到: '用户手动启动服务，已更新自动启动配置为是'" -ForegroundColor Gray
Write-Host ""
Write-Host "   测试 2: 手动关闭服务" -ForegroundColor Cyan
Write-Host "   1. 在节点端UI中，确保某个服务（如 NMT）的自动启动为开启状态" -ForegroundColor Gray
Write-Host "   2. 手动关闭该服务" -ForegroundColor Gray
Write-Host "   3. 检查配置文件，确认自动启动已更新为 false" -ForegroundColor Gray
Write-Host "   4. 查看节点端日志，应该看到: '用户手动关闭服务，已更新自动启动配置为否'" -ForegroundColor Gray
Write-Host ""
Write-Host "   测试 3: 重启验证" -ForegroundColor Cyan
Write-Host "   1. 重启节点端应用" -ForegroundColor Gray
Write-Host "   2. 检查服务是否按照配置自动启动" -ForegroundColor Gray
Write-Host ""
Write-Host "   测试 4: 语言对列表上报" -ForegroundColor Cyan
Write-Host "   1. 查看节点端日志，搜索 '上报语言对列表到调度服务器'" -ForegroundColor Gray
Write-Host "   2. 检查日志中是否包含语言对列表信息" -ForegroundColor Gray
Write-Host "   3. 检查调度服务器日志，确认收到语言对列表" -ForegroundColor Gray
Write-Host ""

# 5. 检查日志文件位置
Write-Host "5. 日志文件位置:" -ForegroundColor Yellow
$logPaths = @(
    "节点端日志: electron_node\electron-node\logs\",
    "调度服务器日志: central_server\scheduler\logs\scheduler.log"
)

foreach ($logPath in $logPaths) {
    $parts = $logPath -split ": "
    $label = $parts[0]
    $path = $parts[1]
    
    $fullPath = Join-Path $PSScriptRoot "..\$path"
    if (Test-Path $fullPath) {
        Write-Host "   ✓ $label : $fullPath" -ForegroundColor Green
    } else {
        Write-Host "   ⚠ $label : $fullPath (不存在)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "测试脚本执行完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tip: Use the following commands to view real-time logs:" -ForegroundColor Yellow
Write-Host '  Get-Content electron_node\electron-node\logs\*.log -Tail 50 -Wait' -ForegroundColor White
Write-Host '  Get-Content central_server\scheduler\logs\scheduler.log -Tail 50 -Wait' -ForegroundColor White
