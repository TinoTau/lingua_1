# Verify and Fix Service JSON Files
# Check all service.json files for correct IDs

Write-Host "Verifying service.json files..." -ForegroundColor Cyan

$servicesDir = "d:\Programs\github\lingua_1\electron_node\services"
$issues = @()

Get-ChildItem -Path "$servicesDir\*\service.json" | ForEach-Object {
    $filePath = $_.FullName
    $dirName = $_.Directory.Name
    
    try {
        $json = Get-Content $filePath -Raw | ConvertFrom-Json
        $serviceId = $json.id
        $port = $json.port
        
        # Expected ID (directory name with underscores replaced by hyphens)
        $expectedId = $dirName.Replace("_", "-")
        
        if ($serviceId -eq $expectedId) {
            Write-Host "  OK: $dirName -> id=$serviceId, port=$port" -ForegroundColor Green
        } else {
            Write-Host "  ERROR: $dirName -> id=$serviceId (expected: $expectedId), port=$port" -ForegroundColor Red
            $issues += @{
                Dir = $dirName
                CurrentId = $serviceId
                ExpectedId = $expectedId
                Port = $port
            }
        }
    } catch {
        Write-Host "  ERROR: $dirName -> Failed to parse JSON: $_" -ForegroundColor Red
    }
}

if ($issues.Count -gt 0) {
    Write-Host "`nFound $($issues.Count) issue(s):" -ForegroundColor Yellow
    $issues | ForEach-Object {
        Write-Host "  - $($_.Dir): '$($_.CurrentId)' should be '$($_.ExpectedId)'" -ForegroundColor Yellow
    }
} else {
    Write-Host "`nAll service.json files are correct!" -ForegroundColor Green
}
