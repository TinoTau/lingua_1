# Cleanup Orphaned Processes Script
# Used to cleanup Node.js, Python, and esBuilder processes left after integration tests

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cleanup Orphaned Processes Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Find and display related processes
Write-Host "[1/4] Scanning related processes..." -ForegroundColor Yellow

# Node.js processes (exclude system processes)
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -notlike "*\Windows\*" -and $_.Path -notlike "*\Program Files\*" -and $_.Path -notlike "*\Program Files (x86)\*"
}

# Python processes (exclude system Python)
$pythonProcesses = Get-Process -Name "python*" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -notlike "*\Windows\*" -and $_.Path -notlike "*\Program Files\*" -and $_.Path -notlike "*\Program Files (x86)\*"
}

# esBuilder.exe processes
$esBuilderProcesses = Get-Process -Name "esBuilder*" -ErrorAction SilentlyContinue

# Display statistics
Write-Host "  Found Node.js processes: $($nodeProcesses.Count)" -ForegroundColor $(if ($nodeProcesses.Count -gt 0) { "Yellow" } else { "Green" })
Write-Host "  Found Python processes: $($pythonProcesses.Count)" -ForegroundColor $(if ($pythonProcesses.Count -gt 0) { "Yellow" } else { "Green" })
Write-Host "  Found esBuilder processes: $($esBuilderProcesses.Count)" -ForegroundColor $(if ($esBuilderProcesses.Count -gt 0) { "Yellow" } else { "Green" })
Write-Host ""

# 2. Display detailed information
if ($nodeProcesses.Count -gt 0 -or $pythonProcesses.Count -gt 0 -or $esBuilderProcesses.Count -gt 0) {
    Write-Host "[2/4] Process Details:" -ForegroundColor Yellow
    Write-Host ""
    
    if ($nodeProcesses.Count -gt 0) {
        Write-Host "  Node.js Processes:" -ForegroundColor Cyan
        $nodeProcesses | ForEach-Object {
            $cmdLine = ""
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" | Select-Object -ExpandProperty CommandLine) -replace "`"", ""
            } catch {
                $cmdLine = "N/A"
            }
            $displayCmd = if ($cmdLine.Length -gt 80) { $cmdLine.Substring(0, 80) + "..." } else { $cmdLine }
            Write-Host "    PID: $($_.Id) | Path: $($_.Path) | Command: $displayCmd" -ForegroundColor Gray
        }
        Write-Host ""
    }
    
    if ($pythonProcesses.Count -gt 0) {
        Write-Host "  Python Processes:" -ForegroundColor Cyan
        $pythonProcesses | ForEach-Object {
            $cmdLine = ""
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" | Select-Object -ExpandProperty CommandLine) -replace "`"", ""
            } catch {
                $cmdLine = "N/A"
            }
            $displayCmd = if ($cmdLine.Length -gt 80) { $cmdLine.Substring(0, 80) + "..." } else { $cmdLine }
            Write-Host "    PID: $($_.Id) | Path: $($_.Path) | Command: $displayCmd" -ForegroundColor Gray
        }
        Write-Host ""
    }
    
    if ($esBuilderProcesses.Count -gt 0) {
        Write-Host "  esBuilder Processes:" -ForegroundColor Cyan
        $esBuilderProcesses | ForEach-Object {
            $cmdLine = ""
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" | Select-Object -ExpandProperty CommandLine) -replace "`"", ""
            } catch {
                $cmdLine = "N/A"
            }
            $displayCmd = if ($cmdLine.Length -gt 80) { $cmdLine.Substring(0, 80) + "..." } else { $cmdLine }
            Write-Host "    PID: $($_.Id) | Path: $($_.Path) | Command: $displayCmd" -ForegroundColor Gray
        }
        Write-Host ""
    }
} else {
    Write-Host "[2/4] No related processes found, no cleanup needed" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# 3. Execute cleanup
Write-Host "[3/3] Executing cleanup..." -ForegroundColor Yellow
$totalProcesses = $nodeProcesses.Count + $pythonProcesses.Count + $esBuilderProcesses.Count
Write-Host "  Will cleanup $totalProcesses process(es)" -ForegroundColor Yellow
Write-Host ""
Write-Host ""

$killedCount = 0
$failedCount = 0

# Cleanup Node.js processes
foreach ($proc in $nodeProcesses) {
    try {
        Write-Host "  Terminating Node.js process (PID: $($proc.Id))..." -ForegroundColor Gray
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        $killedCount++
        Start-Sleep -Milliseconds 100
    } catch {
        Write-Host "    Failed: $($_.Exception.Message)" -ForegroundColor Red
        $failedCount++
    }
}

# Cleanup Python processes
foreach ($proc in $pythonProcesses) {
    try {
        Write-Host "  Terminating Python process (PID: $($proc.Id))..." -ForegroundColor Gray
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        $killedCount++
        Start-Sleep -Milliseconds 100
    } catch {
        Write-Host "    Failed: $($_.Exception.Message)" -ForegroundColor Red
        $failedCount++
    }
}

# Cleanup esBuilder processes
foreach ($proc in $esBuilderProcesses) {
    try {
        Write-Host "  Terminating esBuilder process (PID: $($proc.Id))..." -ForegroundColor Gray
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        $killedCount++
        Start-Sleep -Milliseconds 100
    } catch {
        Write-Host "    Failed: $($_.Exception.Message)" -ForegroundColor Red
        $failedCount++
    }
}

# Wait for processes to fully exit
Start-Sleep -Seconds 1

# 4. Verify cleanup results
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cleanup Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Successfully cleaned: $killedCount process(es)" -ForegroundColor Green
if ($failedCount -gt 0) {
    Write-Host "  Failed to clean: $failedCount process(es)" -ForegroundColor Red
}

# Check again
$remainingNode = (Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -notlike "*\Windows\*" -and $_.Path -notlike "*\Program Files\*" -and $_.Path -notlike "*\Program Files (x86)\*"
}).Count
$remainingPython = (Get-Process -Name "python*" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -notlike "*\Windows\*" -and $_.Path -notlike "*\Program Files\*" -and $_.Path -notlike "*\Program Files (x86)\*"
}).Count
$remainingEsBuilder = (Get-Process -Name "esBuilder*" -ErrorAction SilentlyContinue).Count

if ($remainingNode -eq 0 -and $remainingPython -eq 0 -and $remainingEsBuilder -eq 0) {
    Write-Host "  All related processes have been cleaned up" -ForegroundColor Green
} else {
    Write-Host "  Remaining processes:" -ForegroundColor Yellow
    if ($remainingNode -gt 0) { Write-Host "    - Node.js: $remainingNode process(es)" -ForegroundColor Yellow }
    if ($remainingPython -gt 0) { Write-Host "    - Python: $remainingPython process(es)" -ForegroundColor Yellow }
    if ($remainingEsBuilder -gt 0) { Write-Host "    - esBuilder: $remainingEsBuilder process(es)" -ForegroundColor Yellow }
    Write-Host "  Note: These processes may need manual termination or system restart" -ForegroundColor Yellow
}

Write-Host ""
