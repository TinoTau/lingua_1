# 启动合并语义修复服务并测试：繁体 ASR -> 繁->简 -> 同音纠错 -> 语义修复
# 用法：
#   1) 若端口 5015 已被占用，可执行 .\scripts\kill_port_5015.ps1 释放
#   2) 在一个终端启动服务：cd 到服务根目录后执行 "$python service.py"，等待出现 "Application startup complete" 且 /health 返回 zh_repair=healthy（LLM 加载+预热可能需数分钟）
#   3) 在另一个终端运行本脚本（仅运行测试，不启动服务）

$ErrorActionPreference = "Stop"
$ServiceDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ServiceDir

$python = "python"
if (Test-Path "venv\Scripts\python.exe") { $python = "venv\Scripts\python.exe" }

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  繁体->简体+纠错+语义修复 测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "请确保已在一个终端启动服务: $python service.py" -ForegroundColor Yellow
Write-Host "并等待模型加载完成 (health 返回 zh_repair=healthy)，再继续。" -ForegroundColor Yellow
Write-Host ""

$env:PYTHONIOENCODING = "utf-8"
& $python tests\integration\test_traditional_to_simplified.py
exit $LASTEXITCODE
