# Check ASR preload status from node and ASR service logs
# Run after integration test; checks for [ASR_PRELOAD] and related messages

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronNode = Split-Path -Parent $scriptDir
$repoRoot = (Resolve-Path (Join-Path $electronNode "..")).Path

Write-Host "=== ASR Preload Diagnostic ===" -ForegroundColor Green
Write-Host "  Repo root: $repoRoot" -ForegroundColor Gray
Write-Host ""

# Possible electron-main.log locations (logger uses process.cwd()/logs)
$mainLogCandidates = @(
    (Join-Path $repoRoot "logs\electron-main.log"),
    (Join-Path $electronNode "electron-node\logs\electron-main.log"),
    (Join-Path $electronNode "electron-node\main\logs\electron-main.log"),
    "$env:APPDATA\lingua-electron-node\logs\electron-main.log",
    "$env:LOCALAPPDATA\lingua-electron-node\logs\electron-main.log"
)

$mainLog = $null
foreach ($p in $mainLogCandidates) {
    if (Test-Path $p) {
        $mainLog = $p
        break
    }
}

$asrLog = Join-Path $electronNode "services\faster_whisper_vad\logs\faster-whisper-vad-service.log"
$asrLogExists = Test-Path $asrLog

Write-Host "1. Log files" -ForegroundColor Yellow
if ($mainLog) {
    $mainInfo = Get-Item $mainLog
    Write-Host "   [OK] electron-main.log: $mainLog" -ForegroundColor Green
    Write-Host "        Size: $([math]::Round($mainInfo.Length/1KB, 2)) KB, Modified: $($mainInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
} else {
    Write-Host "   [--] electron-main.log not found in:" -ForegroundColor Yellow
    $mainLogCandidates | ForEach-Object { Write-Host "        $_" -ForegroundColor Gray }
}

if ($asrLogExists) {
    $asrInfo = Get-Item $asrLog
    Write-Host "   [OK] faster-whisper-vad-service.log: $asrLog" -ForegroundColor Green
    Write-Host "        Size: $([math]::Round($asrInfo.Length/1KB, 2)) KB, Modified: $($asrInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
} else {
    Write-Host "   [--] faster-whisper-vad-service.log not found" -ForegroundColor Yellow
    Write-Host "        (ASR service writes to cwd/logs; worker logs go to stdout -> electron-main [stderr])" -ForegroundColor Gray
}
Write-Host ""

# Grep patterns (escape [ ] for PowerShell regex)
$preloadTag = "\[ASR_PRELOAD\]"
$preloadPatterns = @(
    "ASR_PRELOAD",
    "startup preload",
    "model loaded.*worker",
    "warmup completed",
    "ready_event set",
    "Application startup complete",
    "ASR Worker Manager started"
)
$healthPatterns = @(
    "Health check timeout",
    "assuming service is running",
    "model loaded, health check passed",
    "Service is now running"
)

Write-Host "2. ASR preload (worker + manager) in electron-main.log" -ForegroundColor Yellow
if (-not $mainLog) {
    Write-Host "   Skip (no main log)" -ForegroundColor Gray
} else {
    $raw = Get-Content $mainLog -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if (-not $raw) { $raw = "" }
    $lines = Get-Content $mainLog -Encoding UTF8 -ErrorAction SilentlyContinue
    $stderrLines = $lines | Where-Object { $_ -match '\[stderr\]' }

    $foundPreload = @()
    foreach ($pat in $preloadPatterns) {
        $m = $stderrLines | Select-String -Pattern $pat -AllMatches
        if ($m) {
            $foundPreload += $m
        }
    }
    # Also search full file for [ASR_PRELOAD]
    $tagMatches = $lines | Select-String -Pattern $preloadTag

    if ($tagMatches) {
        $n = $tagMatches.Count
        Write-Host "   [OK] [ASR_PRELOAD] found ($n lines):" -ForegroundColor Green
        $tagMatches | Select-Object -Last 20 | ForEach-Object {
            $t = $_.Line.Trim()
            if ($t.Length -gt 120) { $t = $t.Substring(0, 120) + "..." }
            Write-Host "      $t" -ForegroundColor Gray
        }
    } elseif ($foundPreload.Count -gt 0) {
        $n = $foundPreload.Count
        Write-Host "   [~] Preload-related lines (no [ASR_PRELOAD] tag) ($n):" -ForegroundColor Yellow
        $foundPreload | Select-Object -Last 10 | ForEach-Object {
            $t = $_.Line.Trim()
            if ($t.Length -gt 120) { $t = $t.Substring(0, 120) + "..." }
            Write-Host "      $t" -ForegroundColor Gray
        }
    } else {
        Write-Host "   [!!] No ASR preload messages found." -ForegroundColor Red
        Write-Host "        Worker logs appear in [stderr]. If ASR was never started, nothing will appear." -ForegroundColor Gray
    }
}
Write-Host ""

Write-Host "3. Health check (ServiceProcessRunner) in electron-main.log" -ForegroundColor Yellow
if (-not $mainLog) {
    Write-Host "   Skip (no main log)" -ForegroundColor Gray
} else {
    $lines = Get-Content $mainLog -Encoding UTF8 -ErrorAction SilentlyContinue
    $timeout = $lines | Select-String -Pattern "faster-whisper-vad" | Select-String -Pattern "Health check timeout|assuming service is running"
    $passed = $lines | Select-String -Pattern "faster-whisper-vad" | Select-String -Pattern "model loaded, health check passed|Service is now running"
    $ok = $lines | Select-String -Pattern "faster-whisper-vad" | Select-String -Pattern "model loaded, health check passed"

    if ($ok) {
        Write-Host "   [OK] Health check waited for model (status=ok):" -ForegroundColor Green
        $ok | Select-Object -Last 3 | ForEach-Object { Write-Host "      $($_.Line.Trim())" -ForegroundColor Gray }
    } elseif ($passed) {
        Write-Host "   [~] Service marked running (check if 'model loaded'):" -ForegroundColor Yellow
        $passed | Select-Object -Last 3 | ForEach-Object { Write-Host "      $($_.Line.Trim())" -ForegroundColor Gray }
    } elseif ($timeout) {
        Write-Host "   [!!] Health check TIMEOUT (node assumed running without status=ok):" -ForegroundColor Red
        $timeout | Select-Object -Last 3 | ForEach-Object { Write-Host "      $($_.Line.Trim())" -ForegroundColor Gray }
        Write-Host "        -> If before ASR ready: first job hits cold model -> long GPU hold -> GPU_USAGE_HIGH." -ForegroundColor Gray
    } else {
        Write-Host "   [--] No health-check lines for faster-whisper-vad found." -ForegroundColor Gray
    }
}
Write-Host ""

Write-Host "4. ASR service file log (faster-whisper-vad-service.log)" -ForegroundColor Yellow
if (-not $asrLogExists) {
    Write-Host "   Skip (file not found)" -ForegroundColor Gray
} else {
    $asrContent = Get-Content $asrLog -Encoding UTF8 -ErrorAction SilentlyContinue
    $asrPreload = $asrContent | Select-String -Pattern $preloadTag
    if ($asrPreload) {
        $n = $asrPreload.Count
        Write-Host "   [OK] [ASR_PRELOAD] in service log ($n lines)" -ForegroundColor Green
        $asrPreload | Select-Object -Last 10 | ForEach-Object { Write-Host "      $($_.Line.Trim())" -ForegroundColor Gray }
    } else {
        $any = $asrContent | Select-String -Pattern "startup preload|model loaded|warmup completed|Worker Manager started"
        if ($any) {
            Write-Host "   [~] Preload-related in service log:" -ForegroundColor Yellow
            $any | Select-Object -Last 5 | ForEach-Object { Write-Host "      $($_.Line.Trim())" -ForegroundColor Gray }
        } else {
            Write-Host "   [--] No preload-related lines in service log" -ForegroundColor Gray
        }
    }
}
Write-Host ""

Write-Host "5. Summary" -ForegroundColor Yellow
if ($mainLog) {
    $tagCount = (Get-Content $mainLog -Encoding UTF8 -ErrorAction SilentlyContinue | Select-String -Pattern $preloadTag | Measure-Object).Count
    $timeout20 = @(Get-Content $mainLog -Encoding UTF8 -ErrorAction SilentlyContinue | Select-String -Pattern "faster-whisper-vad" | Select-String -Pattern "Health check timeout after 20s")
    $timeout120 = @(Get-Content $mainLog -Encoding UTF8 -ErrorAction SilentlyContinue | Select-String -Pattern "faster-whisper-vad" | Select-String -Pattern "Health check timeout after 120s|Health check timeout after 180s")
    $assuming = @(Get-Content $mainLog -Encoding UTF8 -ErrorAction SilentlyContinue | Select-String -Pattern "faster-whisper-vad" | Select-String -Pattern "assuming service is running")
    if ($tagCount -ge 4) {
        Write-Host "   [OK] ASR preload likely completed (multiple [ASR_PRELOAD])." -ForegroundColor Green
    } elseif ($tagCount -gt 0) {
        Write-Host "   [~] ASR preload partially logged ($tagCount [ASR_PRELOAD])." -ForegroundColor Yellow
    } else {
        Write-Host "   [!!] No [ASR_PRELOAD] in logs -> preload may not have run or logs not captured." -ForegroundColor Red
    }
    if ($timeout20.Count -gt 0) {
        Write-Host "   [!!] Health check timed out at 20s -> node marked ASR running too early." -ForegroundColor Red
        Write-Host "        Fix: use 180s for faster-whisper-vad (ServiceProcessRunner MODEL_PRELOAD_*)." -ForegroundColor Gray
    } elseif ($assuming.Count -gt 0 -and $timeout120.Count -gt 0) {
        Write-Host "   [!!] Health check timed out at 120s/180s -> ASR startup took longer than wait." -ForegroundColor Red
        Write-Host "        ASR preload may have completed (check faster-whisper-vad-service.log). Increase MODEL_PRELOAD_HEALTH_CHECK_MAX_ATTEMPTS if needed." -ForegroundColor Gray
    }
} else {
    Write-Host "   Run integration test, then re-run this script. Ensure electron-main.log exists." -ForegroundColor Gray
}
Write-Host ""
Write-Host "Done." -ForegroundColor Green
