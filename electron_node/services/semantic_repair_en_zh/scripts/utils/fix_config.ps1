# Fix Node Configuration - Disable Old Services, Enable New Service
# UTF-8 encoding

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "  Fix Node Configuration" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# Find config file
$appDataPath = [Environment]::GetFolderPath('ApplicationData')
$configPath = Join-Path $appDataPath "lingua-electron-node\electron-node-config.json"

Write-Host "Config file path: $configPath" -ForegroundColor Yellow
Write-Host ""

if (-Not (Test-Path $configPath)) {
    Write-Host "Config file not found. Please start the node once first." -ForegroundColor Yellow
    exit 0
}

# Read config
try {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    
    Write-Host "Current config:" -ForegroundColor Cyan
    Write-Host "  semanticRepairZhEnabled: $($config.servicePreferences.semanticRepairZhEnabled)" -ForegroundColor Gray
    Write-Host "  semanticRepairEnEnabled: $($config.servicePreferences.semanticRepairEnEnabled)" -ForegroundColor Gray
    Write-Host "  enNormalizeEnabled: $($config.servicePreferences.enNormalizeEnabled)" -ForegroundColor Gray
    Write-Host "  semanticRepairEnZhEnabled: $($config.servicePreferences.semanticRepairEnZhEnabled)" -ForegroundColor Gray
    Write-Host ""
    
    # Backup
    $backupPath = "$configPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $configPath $backupPath
    Write-Host "Backed up config to: $backupPath" -ForegroundColor Green
    Write-Host ""
    
    # Update config
    $needsUpdate = $false
    
    if ($config.servicePreferences.semanticRepairZhEnabled -ne $false) {
        Write-Host "  Disabling old service: semantic-repair-zh" -ForegroundColor Yellow
        $config.servicePreferences.semanticRepairZhEnabled = $false
        $needsUpdate = $true
    }
    
    if ($config.servicePreferences.semanticRepairEnEnabled -ne $false) {
        Write-Host "  Disabling old service: semantic-repair-en" -ForegroundColor Yellow
        $config.servicePreferences.semanticRepairEnEnabled = $false
        $needsUpdate = $true
    }
    
    if ($config.servicePreferences.enNormalizeEnabled -ne $false) {
        Write-Host "  Disabling old service: en-normalize" -ForegroundColor Yellow
        $config.servicePreferences.enNormalizeEnabled = $false
        $needsUpdate = $true
    }
    
    if ($config.servicePreferences.semanticRepairEnZhEnabled -ne $true) {
        Write-Host "  Enabling new service: semantic-repair-en-zh" -ForegroundColor Green
        $config.servicePreferences.semanticRepairEnZhEnabled = $true
        $needsUpdate = $true
    }
    
    if ($needsUpdate) {
        Write-Host ""
        Write-Host "Saving updated config..." -ForegroundColor Cyan
        
        # Save config
        $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
        
        Write-Host "Config updated successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Updated config:" -ForegroundColor Cyan
        Write-Host "  semanticRepairZhEnabled: $($config.servicePreferences.semanticRepairZhEnabled)" -ForegroundColor Gray
        Write-Host "  semanticRepairEnEnabled: $($config.servicePreferences.semanticRepairEnEnabled)" -ForegroundColor Gray
        Write-Host "  enNormalizeEnabled: $($config.servicePreferences.enNormalizeEnabled)" -ForegroundColor Gray
        Write-Host "  semanticRepairEnZhEnabled: $($config.servicePreferences.semanticRepairEnZhEnabled)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Please restart the node to apply changes" -ForegroundColor Yellow
    } else {
        Write-Host "Config is already up to date" -ForegroundColor Green
    }
    
} catch {
    Write-Host "Error updating config: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please manually edit the config file:" -ForegroundColor Yellow
    Write-Host "  Path: $configPath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Required changes:" -ForegroundColor Yellow
    Write-Host '  "servicePreferences": {' -ForegroundColor Gray
    Write-Host '    "semanticRepairZhEnabled": false,' -ForegroundColor Gray
    Write-Host '    "semanticRepairEnEnabled": false,' -ForegroundColor Gray
    Write-Host '    "enNormalizeEnabled": false,' -ForegroundColor Gray
    Write-Host '    "semanticRepairEnZhEnabled": true' -ForegroundColor Gray
    Write-Host '  }' -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "  Done!" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
