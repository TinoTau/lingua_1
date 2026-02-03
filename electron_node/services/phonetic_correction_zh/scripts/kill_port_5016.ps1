# 清理占用 5016 端口的进程（同音纠错服务默认端口）
$port = 5016
$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if (-not $conn) {
    Write-Host "端口 $port 未被占用。" -ForegroundColor Green
    exit 0
}
foreach ($c in $conn) {
    $pid = $c.OwningProcess
    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
    Write-Host "终止进程 PID=$pid ($($proc.ProcessName)) 占用 $port ..." -ForegroundColor Yellow
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
}
Write-Host "端口 $port 已释放。" -ForegroundColor Green
