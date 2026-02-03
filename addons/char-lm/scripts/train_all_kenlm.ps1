# 在 WSL 中执行中文/英文 KenLM 训练，输出到 semantic_repair_en_zh/models
# 前置：WSL 已安装，且 KenLM 已编译（见 clone_build_kenlm.sh）或 KENLM_BIN 已设置
$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
$charLmRoot = Split-Path -Parent $scriptDir
# 仓库根目录
$repoRoot = Split-Path -Parent (Split-Path -Parent $charLmRoot)
# 转为 WSL 路径：D:\x\y -> /mnt/d/x/y
$drive = $repoRoot[0].ToString().ToLower()
$unixPath = $repoRoot.Substring(2).Replace('\', '/')
$wslRepo = "/mnt/$drive$unixPath"
$wslCharLm = "$wslRepo/addons/char-lm"

Write-Host "Char-LM root: $charLmRoot" -ForegroundColor Cyan
Write-Host "WSL char-lm:  $wslCharLm" -ForegroundColor Cyan
Write-Host "Running KenLM training in WSL (train_zh_large.sh + train_en_large.sh)..." -ForegroundColor Yellow
$cmd = "cd '$wslCharLm' && bash scripts/train_zh_large.sh && bash scripts/train_en_large.sh"
wsl -e bash -c $cmd
if ($LASTEXITCODE -ne 0) {
    Write-Host "WSL training failed. Ensure WSL is installed and KenLM is built (see addons/char-lm/scripts/clone_build_kenlm.sh)." -ForegroundColor Red
    exit $LASTEXITCODE
}
$targetDir = Join-Path $repoRoot "electron_node\services\semantic_repair_en_zh\models"
Write-Host "Done. Models should be in: $targetDir" -ForegroundColor Green
Get-ChildItem $targetDir -Filter "*.trie.bin" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.Name) $([math]::Round($_.Length/1MB, 2)) MB" }
