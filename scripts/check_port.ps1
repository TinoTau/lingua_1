# Check if a port is in use and show the process
param(
    [Parameter(Mandatory = $true)]
    [int]$Port
)

Write-Host "Checking port $Port..." -ForegroundColor Cyan

# Get process using the port
$connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue

if ($connection) {
    $processId = $connection.OwningProcess
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    
    Write-Host "Port $Port is in use by:" -ForegroundColor Yellow
    Write-Host "  PID: $processId" -ForegroundColor White
    if ($process) {
        Write-Host "  Process: $($process.ProcessName)" -ForegroundColor White
        Write-Host "  Path: $($process.Path)" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "To stop the process, run:" -ForegroundColor Yellow
    Write-Host "  Stop-Process -Id $processId -Force" -ForegroundColor White
}
else {
    Write-Host "Port $Port is available" -ForegroundColor Green
}
            Write-Host "To stop the process, run:" -ForegroundColor Yellow
            Write-Host "  Stop-Process -Id $processId -Force" -ForegroundColor White
        } elseif ($process.ProcessName -eq "svchost") {
            Write-Host "  Type: Windows system service" -ForegroundColor Red
            Write-Host ""
            Write-Host "Warning: This is a system process. It may be:" -ForegroundColor Yellow
            Write-Host "  1. A previous service that didn't close properly" -ForegroundColor Gray
            Write-Host "  2. A Windows service using this port" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Try checking for Python processes:" -ForegroundColor Yellow
            Write-Host "  Get-Process python -ErrorAction SilentlyContinue | Select-Object Id, Path" -ForegroundColor White
        } else {
            Write-Host "  Type: Other process" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "To stop the process (if safe), run:" -ForegroundColor Yellow
            Write-Host "  Stop-Process -Id $processId -Force" -ForegroundColor White
        }
    }
} else {
    Write-Host "Port $Port is available" -ForegroundColor Green
}
