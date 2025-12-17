# 测试服务包 API
# 用于验证 Model Hub 和调度服务器的服务包接口是否正常工作

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "服务包 API 测试脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. 检查服务状态
Write-Host "`n[1/4] 检查服务状态..." -ForegroundColor Yellow
$port5000 = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
$port5010 = Get-NetTCPConnection -LocalPort 5010 -State Listen -ErrorAction SilentlyContinue

if (-not $port5000) {
    Write-Host "  ❌ Model Hub (端口 5000) 未运行" -ForegroundColor Red
    Write-Host "     请先启动 Model Hub 服务" -ForegroundColor Gray
    exit 1
} else {
    Write-Host "  ✅ Model Hub (端口 5000) 正在运行" -ForegroundColor Green
}

if (-not $port5010) {
    Write-Host "  ❌ 调度服务器 (端口 5010) 未运行" -ForegroundColor Red
    Write-Host "     请先启动调度服务器" -ForegroundColor Gray
    exit 1
} else {
    Write-Host "  ✅ 调度服务器 (端口 5010) 正在运行" -ForegroundColor Green
}

# 2. 检查索引文件
Write-Host "`n[2/4] 检查索引文件..." -ForegroundColor Yellow
$indexFile = Join-Path $PSScriptRoot "..\models\services\services_index.json"
if (Test-Path $indexFile) {
    $index = Get-Content $indexFile -Raw | ConvertFrom-Json
    Write-Host "  ✅ 索引文件存在" -ForegroundColor Green
    Write-Host "  📦 包含 $($index.PSObject.Properties.Count) 个服务包" -ForegroundColor Gray
} else {
    Write-Host "  ❌ 索引文件不存在: $indexFile" -ForegroundColor Red
    Write-Host "     请运行: python scripts\generate_services_index.py" -ForegroundColor Gray
    exit 1
}

# 3. 测试 Model Hub API
Write-Host "`n[3/4] 测试 Model Hub /api/services 接口..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:5000/api/services" -Method GET -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "  ✅ 接口调用成功 (状态码: $($response.StatusCode))" -ForegroundColor Green
        $json = $response.Content | ConvertFrom-Json
        Write-Host "  📦 返回服务包数量: $($json.services.Count)" -ForegroundColor Gray
        if ($json.services.Count -gt 0) {
            Write-Host "  `n  服务包列表:" -ForegroundColor Gray
            foreach ($service in $json.services) {
                Write-Host "    - $($service.service_id) (版本: $($service.latest_version), 变体数: $($service.variants.Count))" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "  ⚠️  接口返回异常状态码: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ 接口调用失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 4. 测试调度服务器统计接口
Write-Host "`n[4/4] 测试调度服务器统计接口..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:5010/api/stats" -Method GET -TimeoutSec 10 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "  ✅ 接口调用成功 (状态码: $($response.StatusCode))" -ForegroundColor Green
        $json = $response.Content | ConvertFrom-Json
        
        if ($json.nodes.PSObject.Properties.Name -contains "available_services") {
            $serviceCount = $json.nodes.available_services.Count
            $totalServices = $json.nodes.total_services
            Write-Host "  📦 可用服务包数量: $serviceCount" -ForegroundColor Gray
            Write-Host "  📊 总服务包数: $totalServices" -ForegroundColor Gray
            
            if ($serviceCount -gt 0) {
                Write-Host "  `n  服务包列表:" -ForegroundColor Gray
                foreach ($service in $json.nodes.available_services) {
                    Write-Host "    - $($service.service_id) (版本: $($service.latest_version))" -ForegroundColor Gray
                }
            } else {
                Write-Host "  ⚠️  未获取到服务包（可能 Model Hub 未响应）" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  ⚠️  响应中未找到 available_services 字段" -ForegroundColor Yellow
            Write-Host "     调度服务器代码可能未更新" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ⚠️  接口返回异常状态码: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ 接口调用失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "     可能原因：调度服务器无法连接到 Model Hub" -ForegroundColor Gray
}

# 总结
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "测试完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

