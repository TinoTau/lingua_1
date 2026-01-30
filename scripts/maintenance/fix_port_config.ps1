# Fix Service Port Configuration
# Add missing port definitions to service.json files

Write-Host "Fixing service.json port configurations..." -ForegroundColor Cyan

# Port mappings based on actual usage from logs and README
$portMappings = @{
    "nmt-m2m100"            = 5008
    "faster-whisper-vad"    = 6007
    "piper_tts"             = 5009
    "en_normalize"          = 5012
    "semantic_repair_zh"    = 5013
    "semantic_repair_en_zh" = 5015
    "speaker_embedding"     = 5014
    "your_tts"              = 5016
}

$servicesDir = "d:\Programs\github\lingua_1\electron_node\services"

foreach ($serviceId in $portMappings.Keys) {
    $port = $portMappings[$serviceId]
    $serviceDir = Join-Path $servicesDir $serviceId.Replace("-", "_")
    $serviceJsonPath = Join-Path $serviceDir "service.json"
    
    if (Test-Path $serviceJsonPath) {
        Write-Host "  Updating $serviceId..." -ForegroundColor Yellow
        
        # Read JSON
        $json = Get-Content $serviceJsonPath -Raw | ConvertFrom-Json
        
        # Add or update port
        $json | Add-Member -NotePropertyName "port" -NotePropertyValue $port -Force
        
        # Write back
        $json | ConvertTo-Json -Depth 10 | Set-Content $serviceJsonPath -Encoding UTF8
        
        Write-Host "    Added port: $port" -ForegroundColor Green
    }
    else {
        Write-Host "  SKIP: $serviceJsonPath not found" -ForegroundColor Gray
    }
}

Write-Host "`nDone! Please restart Electron." -ForegroundColor Green
