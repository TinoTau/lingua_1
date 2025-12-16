# Find detailed information about process using a port
param(
    [Parameter(Mandatory=$true)]
    [int]$Port
)

Write-Host "Checking port $Port..." -ForegroundColor Cyan
Write-Host ""

# Method 1: Get-NetTCPConnection
$connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($connection) {
    $processId = $connection.OwningProcess
    Write-Host "Found connection on port $Port:" -ForegroundColor Yellow
    Write-Host "  PID: $processId" -ForegroundColor White
    Write-Host "  State: $($connection.State)" -ForegroundColor White
    Write-Host ""
    
    # Get process details
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        Write-Host "Process details:" -ForegroundColor Yellow
        Write-Host "  Name: $($process.ProcessName)" -ForegroundColor White
        Write-Host "  PID: $($process.Id)" -ForegroundColor White
        if ($process.Path) {
            Write-Host "  Path: $($process.Path)" -ForegroundColor Gray
        }
        Write-Host ""
        
        # Try to get command line
        try {
            $wmiProcess = Get-WmiObject Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
            if ($wmiProcess -and $wmiProcess.CommandLine) {
                Write-Host "  Command Line: $($wmiProcess.CommandLine)" -ForegroundColor Gray
                Write-Host ""
                
                # Check if it's a Python/Piper process
                if ($wmiProcess.CommandLine -like "*piper*" -or $wmiProcess.CommandLine -like "*uvicorn*" -or $wmiProcess.CommandLine -like "*python*") {
                    Write-Host "This appears to be a Python/Piper service!" -ForegroundColor Green
                    Write-Host "You can stop it with:" -ForegroundColor Yellow
                    Write-Host "  Stop-Process -Id $processId -Force" -ForegroundColor White
                }
            }
        } catch {
            Write-Host "  Could not get command line details" -ForegroundColor Gray
        }
    }
    
    # Check all Python processes
    Write-Host ""
    Write-Host "All Python processes:" -ForegroundColor Cyan
    $pythonProcesses = Get-Process python -ErrorAction SilentlyContinue
    if ($pythonProcesses) {
        foreach ($proc in $pythonProcesses) {
            Write-Host "  PID: $($proc.Id) - $($proc.ProcessName)" -ForegroundColor White
            try {
                $wmiProc = Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
                if ($wmiProc -and $wmiProc.CommandLine) {
                    $cmdLine = $wmiProc.CommandLine
                    if ($cmdLine.Length -gt 100) {
                        $cmdLine = $cmdLine.Substring(0, 100) + "..."
                    }
                    Write-Host "    Command: $cmdLine" -ForegroundColor Gray
                }
            } catch {
                # Ignore errors
            }
        }
    } else {
        Write-Host "  No Python processes found" -ForegroundColor Gray
    }
} else {
    Write-Host "Port $Port is available" -ForegroundColor Green
}
