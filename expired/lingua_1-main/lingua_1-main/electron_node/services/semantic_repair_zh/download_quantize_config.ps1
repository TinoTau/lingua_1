# 下载 quantize_config.json 脚本
# 用于从 Hugging Face 下载 GPTQ 量化配置文件
# 如果直接下载失败，会尝试从 config.json 中提取并创建

param(
    [string]$ModelRepo = "Qwen/Qwen2.5-3B-Instruct-GPTQ-Int4",
    [string]$ModelPath = "./models/qwen2.5-3b-instruct-zh"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Download quantize_config.json" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查模型路径
if (-not (Test-Path $ModelPath)) {
    Write-Host "❌ Model path does not exist: $ModelPath" -ForegroundColor Red
    exit 1
}

Write-Host "Model path: $ModelPath" -ForegroundColor Yellow
Write-Host ""

# 如果未指定模型仓库，尝试常见的仓库名称
if ([string]::IsNullOrEmpty($ModelRepo)) {
    Write-Host "No model repository specified. Trying common repositories..." -ForegroundColor Yellow
    Write-Host ""
    
    $repos = @(
        "Qwen/Qwen2.5-3B-Instruct-GPTQ",
        "Qwen/Qwen2.5-3B-Instruct-GPTQ-Int4",
        "TheBloke/Qwen2.5-3B-Instruct-GPTQ",
        "TheBloke/Qwen2.5-3B-Instruct-AWQ"
    )
    
    foreach ($repo in $repos) {
        Write-Host "Trying: $repo" -ForegroundColor Gray
        try {
            $env:PYTHONIOENCODING = "utf-8"
            $result = hf download $repo quantize_config.json --local-dir $ModelPath 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host ""
                Write-Host "✅ Successfully downloaded from: $repo" -ForegroundColor Green
                Write-Host "File saved to: $ModelPath\quantize_config.json" -ForegroundColor Green
                exit 0
            }
        }
        catch {
            Write-Host "  ❌ Failed: $_" -ForegroundColor DarkGray
        }
    }
    
    Write-Host ""
    Write-Host "❌ Could not find quantize_config.json in any of the common repositories." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please specify the correct model repository manually:" -ForegroundColor Yellow
    Write-Host "  .\download_quantize_config.ps1 -ModelRepo <repository_name>" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Example:" -ForegroundColor Yellow
    Write-Host "  .\download_quantize_config.ps1 -ModelRepo Qwen/Qwen2.5-3B-Instruct-GPTQ" -ForegroundColor Yellow
    exit 1
}
    else {
        Write-Host "Downloading from specified repository: $ModelRepo" -ForegroundColor Yellow
        Write-Host ""
        
        # 首先尝试直接下载 quantize_config.json
        try {
            $env:PYTHONIOENCODING = "utf-8"
            hf download $ModelRepo quantize_config.json --local-dir $ModelPath 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $ModelPath "quantize_config.json"))) {
                Write-Host ""
                Write-Host "✅ Successfully downloaded quantize_config.json" -ForegroundColor Green
                Write-Host "File saved to: $ModelPath\quantize_config.json" -ForegroundColor Green
                exit 0
            }
        }
        catch {
            Write-Host "  ⚠️  Direct download failed, will try alternative method..." -ForegroundColor Yellow
        }
        
        # 如果直接下载失败，尝试从 config.json 中提取
        Write-Host ""
        Write-Host "Attempting to extract from config.json..." -ForegroundColor Yellow
        Write-Host ""
        
        try {
            # 先下载包含量化配置的 config.json
            $env:PYTHONIOENCODING = "utf-8"
            hf download $ModelRepo config.json --local-dir $ModelPath 2>&1 | Out-Null
            
            if ($LASTEXITCODE -eq 0) {
                # 使用 Python 脚本从 config.json 创建 quantize_config.json
                $scriptPath = Join-Path $PSScriptRoot "create_quantize_config.py"
                if (Test-Path $scriptPath) {
                    python $scriptPath $ModelPath
                    if ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $ModelPath "quantize_config.json"))) {
                        Write-Host ""
                        Write-Host "✅ Successfully created quantize_config.json from config.json" -ForegroundColor Green
                        Write-Host "File saved to: $ModelPath\quantize_config.json" -ForegroundColor Green
                        exit 0
                    }
                }
            }
        }
        catch {
            Write-Host "  ❌ Error: $_" -ForegroundColor Red
        }
        
        Write-Host ""
        Write-Host "❌ Failed to download or create quantize_config.json" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please check:" -ForegroundColor Yellow
        Write-Host "  1. Repository name is correct: $ModelRepo" -ForegroundColor Yellow
        Write-Host "  2. You have access to the repository" -ForegroundColor Yellow
        Write-Host "  3. Model path exists: $ModelPath" -ForegroundColor Yellow
        exit 1
    }
