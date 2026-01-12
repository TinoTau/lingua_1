# Start Central Server
# Start scheduler and model hub services

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting Lingua Central Server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Check which services to start
$startScheduler = $true
$startModelHub = $true

# Parse command line arguments
if ($args.Count -gt 0) {
    foreach ($arg in $args) {
        switch ($arg.ToLower()) {
            "--scheduler-only" {
                $startScheduler = $true
                $startModelHub = $false
            }
            "--model-hub-only" {
                $startScheduler = $false
                $startModelHub = $true
            }
            "--no-scheduler" {
                $startScheduler = $false
            }
            "--no-model-hub" {
                $startModelHub = $false
            }
        }
    }
}

Write-Host "Services to start:" -ForegroundColor Yellow
Write-Host "  Scheduler: $(if ($startScheduler) { 'Yes' } else { 'No' })" -ForegroundColor Gray
Write-Host "  Model Hub: $(if ($startModelHub) { 'Yes' } else { 'No' })" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: Use --scheduler-only or --model-hub-only to start only one service" -ForegroundColor Cyan
Write-Host ""

# Start services in background jobs
$jobs = @()

# 1. Start Scheduler
if ($startScheduler) {
    Write-Host "Starting Scheduler..." -ForegroundColor Yellow
    $schedulerScript = Join-Path $scriptDir "start_scheduler.ps1"
    if (Test-Path $schedulerScript) {
        $job = Start-Job -ScriptBlock {
            param($scriptPath, $projectRoot)
            # Set working directory to project root for background job
            Set-Location $projectRoot
            & $scriptPath
        } -ArgumentList $schedulerScript, $projectRoot
        $jobs += $job
        Write-Host "  Scheduler started (Job ID: $($job.Id))" -ForegroundColor Green
    }
    else {
        Write-Host "  Error: Scheduler startup script not found" -ForegroundColor Red
    }
    Start-Sleep -Seconds 2
}

# 2. Start Model Hub
if ($startModelHub) {
    Write-Host "Starting Model Hub..." -ForegroundColor Yellow
    $modelHubScript = Join-Path $scriptDir "start_model_hub.ps1"
    if (Test-Path $modelHubScript) {
        $job = Start-Job -ScriptBlock {
            param($scriptPath, $projectRoot)
            # Set working directory to project root for background job
            Set-Location $projectRoot
            & $scriptPath
        } -ArgumentList $modelHubScript, $projectRoot
        $jobs += $job
        Write-Host "  Model Hub started (Job ID: $($job.Id))" -ForegroundColor Green
    }
    else {
        Write-Host "  Error: Model Hub startup script not found" -ForegroundColor Red
    }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Central Server Startup Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($jobs.Count -gt 0) {
    Write-Host "Running services (background jobs):" -ForegroundColor Yellow
    foreach ($job in $jobs) {
        Write-Host "  Job ID: $($job.Id) - $($job.State)" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Tips:" -ForegroundColor Cyan
    Write-Host "  - Check service status: Get-Job" -ForegroundColor Gray
    Write-Host "  - View service output: Receive-Job -Id <JobId>" -ForegroundColor Gray
    Write-Host "  - Stop all services: Get-Job | Stop-Job; Get-Job | Remove-Job" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Press Ctrl+C to exit (services will continue running in background)" -ForegroundColor Yellow
    Write-Host "To stop services, run: Get-Job | Stop-Job; Get-Job | Remove-Job" -ForegroundColor Yellow
    Write-Host ""
    
    # Wait for user to press Ctrl+C
    try {
        while ($true) {
            Start-Sleep -Seconds 1
            # Check if any job has failed
            $failedJobs = $jobs | Where-Object { $_.State -eq 'Failed' }
            if ($failedJobs.Count -gt 0) {
                Write-Host "Warning: Service failure detected" -ForegroundColor Red
                foreach ($job in $failedJobs) {
                    Write-Host "  Job ID $($job.Id) failed" -ForegroundColor Red
                    Receive-Job -Id $job.Id -ErrorAction SilentlyContinue | Write-Host
                }
            }
        }
    }
    catch {
        # User pressed Ctrl+C
        Write-Host ""
        Write-Host "Stopping services..." -ForegroundColor Yellow
        Get-Job | Stop-Job
        Get-Job | Remove-Job
        Write-Host "Services stopped" -ForegroundColor Green
    }
}
else {
    Write-Host "No services started" -ForegroundColor Yellow
}
