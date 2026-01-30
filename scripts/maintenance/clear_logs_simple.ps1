# Simple Log Cleanup - Fast and Direct

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Quick Clear All Logs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$clearedCount = 0

# Define all log paths (explicit list, no recursive search)
$logFiles = @(
    "central_server\scheduler\logs\scheduler.log",
    "electron_node\electron-node\logs\electron-main.log",
    "electron_node\services\faster_whisper_vad\logs\faster-whisper-vad-service.log",
    "electron_node\services\nmt_m2m100\logs\nmt-service.log",
    "electron_node\services\piper_tts\logs\tts-service.log",
    "electron_node\services\node-inference\logs\node-inference.log",
    "electron_node\services\speaker_embedding\logs\speaker-embedding-service.log",
    "electron_node\services\your_tts\logs\yourtts-service.log"
)

foreach ($logFile in $logFiles) {
    if (Test-Path $logFile) {
        try {
            Clear-Content $logFile -ErrorAction Stop
            $name = Split-Path $logFile -Leaf
            Write-Host "Cleared: $name" -ForegroundColor Green
            $clearedCount++
        } catch {
            Write-Host "Failed: $logFile" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cleared $clearedCount log files" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
