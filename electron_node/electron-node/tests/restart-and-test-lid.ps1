# 结束 5020、启动节点、等待、跑 LID 功能测试
$nodeDir = "D:\Programs\github\lingua_1\electron_node\electron-node"
$conn = Get-NetTCPConnection -LocalPort 5020 -ErrorAction SilentlyContinue
if ($conn) {
    $procId = $conn.OwningProcess | Select-Object -First 1
    Write-Host "Killing process $procId on 5020..."
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 4
}
Set-Location $nodeDir
Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory $nodeDir -WindowStyle Hidden
Write-Host "Waiting 30s for node to start..."
Start-Sleep -Seconds 30
Write-Host "Running LID tests..."
node tests/run-mock-asr-pipeline.js --wav "D:\Programs\github\lingua_1\expired\chinese.wav" --lid
node tests/run-mock-asr-pipeline.js --wav "D:\Programs\github\lingua_1\expired\english.wav" --lid
