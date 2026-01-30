param([string]$RedisHost = "127.0.0.1", [int]$RedisPort = 6379)
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$luaPath = Join-Path $scriptDir "redis_clear_lingua.lua"
$lua = Get-Content $luaPath -Raw -Encoding UTF8

if (-not (Get-Command redis-cli -ErrorAction SilentlyContinue)) {
    Write-Host "redis-cli not found. Install Redis or add to PATH."
    exit 1
}

$addr = $RedisHost + ":" + $RedisPort
Write-Host ('Clearing Redis lingua:v1:* @ ' + $addr + ' ...')
$out = & redis-cli -h $RedisHost -p $RedisPort EVAL $lua 0 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "redis-cli EVAL failed: $out"
    exit 1
}
$n = [int]$out
Write-Host "Deleted $n keys."
exit 0
