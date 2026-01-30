# 文档整理脚本 - PowerShell版本
# 移动根目录的剩余文档

$ErrorActionPreference = "SilentlyContinue"

Write-Host "=================================="
Write-Host "文档整理脚本"
Write-Host "=================================="
Write-Host ""

$moved = 0
$skipped = 0

# 决策文档
$decisionDocs = @(
    "决策部门文档索引.md",
    "决策部门最终审议文档_新架构V2.md",
    "决策部门审议文档_新架构.md"
)

Write-Host "移动决策文档..."
foreach ($doc in $decisionDocs) {
    if (Test-Path $doc) {
        Move-Item -Path $doc -Destination "docs\decision\" -Force
        Write-Host "[OK] $doc"
        $moved++
    } else {
        $skipped++
    }
}

# 项目管理文档
$projectDocs = @(
    "优化清理总结_最终版_2026_01_22.md",
    "剩余优化任务_实际可行.md",
    "备份代码启动脚本已创建_简化版.md",
    "硬编码清除_最终完成报告_2026_01_22.md",
    "硬编码清除_完成报告_2026_01_22.md",
    "硬编码清除_进度报告_2026_01_22.md",
    "硬编码清除_快速指南.md",
    "硬编码清除_部署指南.md",
    "硬编码清除计划_2026_01_22.md",
    "文档修正说明_2026_01_22.md",
    "文档统一修正完成_2026_01_22.md",
    "文档更新说明_V2.md"
)

Write-Host "`n移动项目管理文档..."
foreach ($doc in $projectDocs) {
    if (Test-Path $doc) {
        Move-Item -Path $doc -Destination "docs\project_management\" -Force
        Write-Host "[OK] $doc"
        $moved++
    } else {
        $skipped++
    }
}

# 项目总结报告
$summaryDocs = @(
    "优化完成_2026_01_22.md",
    "优化完成_请审阅.md",
    "最终清理完成报告_2026_01_22.md",
    "代码清理完成_2026_01_22.md",
    "警告清理完成_最终报告_2026_01_22.md",
    "最终完成报告_SSOT架构_2026_01_22.md",
    "阶段2完成_SSOT架构实现.md"
)

Write-Host "`n移动项目总结报告..."
foreach ($doc in $summaryDocs) {
    if (Test-Path $doc) {
        Move-Item -Path $doc -Destination "docs\project_summaries\" -Force
        Write-Host "[OK] $doc"
        $moved++
    } else {
        $skipped++
    }
}

# 测试报告
$testDocs = @(
    "测试总结_完整报告_2026_01_22.md"
)

Write-Host "`n移动测试报告..."
foreach ($doc in $testDocs) {
    if (Test-Path $doc) {
        Move-Item -Path $doc -Destination "docs\testing\" -Force
        Write-Host "[OK] $doc"
        $moved++
    } else {
        $skipped++
    }
}

# 问题排查
$troubleshootDocs = @(
    "问题修复总结_2026_01_22.md",
    "快速修复_Redis版本问题.md"
)

Write-Host "`n移动问题排查文档..."
foreach ($doc in $troubleshootDocs) {
    if (Test-Path $doc) {
        Move-Item -Path $doc -Destination "docs\troubleshooting\" -Force
        Write-Host "[OK] $doc"
        $moved++
    } else {
        $skipped++
    }
}

# 架构设计
$archDocs = @(
    "设计修正说明_AudioBuffer_2026_01_22.md",
    "节点管理架构统一规则.md"
)

Write-Host "`n移动架构设计文档..."
foreach ($doc in $archDocs) {
    if (Test-Path $doc) {
        if ($doc -eq "节点管理架构统一规则.md") {
            Move-Item -Path $doc -Destination "electron_node\docs\architecture\" -Force
        } else {
            Move-Item -Path $doc -Destination "docs\architecture\" -Force
        }
        Write-Host "[OK] $doc"
        $moved++
    } else {
        $skipped++
    }
}

# WebApp文档
if (Test-Path "WebSocket测试报告_2026_01_22.md") {
    Move-Item -Path "WebSocket测试报告_2026_01_22.md" -Destination "webapp\docs\" -Force
    Write-Host "[OK] WebSocket测试报告_2026_01_22.md"
    $moved++
}

# 根目录docs
if (Test-Path "请从这里开始.md") {
    Move-Item -Path "请从这里开始.md" -Destination "docs\" -Force
    Write-Host "[OK] 请从这里开始.md"
    $moved++
}

Write-Host "`n=================================="
Write-Host "完成: $moved 个文档已移动"
Write-Host "跳过: $skipped 个文档"
Write-Host "=================================="
