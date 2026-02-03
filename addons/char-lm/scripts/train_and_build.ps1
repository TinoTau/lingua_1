# 字符级 LM 训练 + 剪裁 + 生成 trie.bin
# 需先安装 KenLM 并将 lmplz、build_binary 放入 PATH，或设置 $env:KENLM_BIN
# 推荐在 WSL 中执行: bash train_and_build.sh

$ErrorActionPreference = "Stop"
# BASE = addons/char-lm（脚本所在目录的上一级）
$baseDir = Split-Path -Parent $PSScriptRoot
if (-not $baseDir) { $baseDir = Join-Path $PSScriptRoot ".." }
$dataDir = Join-Path $baseDir "data"
$modelsDir = Join-Path $baseDir "models"
$tokenized = Join-Path $dataDir "zh_char_tokenized.txt"
$arpa = Join-Path $modelsDir "zh_char_3gram.arpa"
$trieBin = Join-Path $modelsDir "zh_char_3gram.trie.bin"

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

# 1) Tokenize
if (-not (Test-Path (Join-Path $dataDir "zh_sentences.txt"))) {
    Write-Error "data/zh_sentences.txt not found. Add corpus first."
}
& python (Join-Path $PSScriptRoot "tokenize.py")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 2) lmplz (train + prune)
$kenlmBin = $env:KENLM_BIN
if (-not $kenlmBin) { $kenlmBin = "." }
$lmplz = Join-Path $kenlmBin "lmplz"
if (-not (Get-Command $lmplz -ErrorAction SilentlyContinue) -and -not (Test-Path $lmplz)) {
    $lmplz = "lmplz"
}
$tmpDir = $env:TEMP
if (-not $tmpDir) { $tmpDir = [System.IO.Path]::GetTempPath() }
Get-Content $tokenized -Encoding UTF8 | & $lmplz -o 3 -S 50% -T $tmpDir --prune 0 0 1 2>&1 | Set-Content $arpa -Encoding UTF8
if ($LASTEXITCODE -ne 0) {
    Write-Host "lmplz failed. Install KenLM (e.g. in WSL) and set KENLM_BIN or PATH."
    exit $LASTEXITCODE
}

# 3) build_binary trie
$buildBinary = Join-Path $kenlmBin "build_binary"
if (-not (Get-Command $buildBinary -ErrorAction SilentlyContinue) -and -not (Test-Path $buildBinary)) {
    $buildBinary = "build_binary"
}
& $buildBinary trie $arpa $trieBin
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Model: $trieBin"
Write-Host "Node: set CHAR_LM_PATH=$trieBin"
