param(
  [string]$RedisUrl = "redis://127.0.0.1:6379",
  [string]$KeyPrefix = "",
  [int]$Repeat = 1,
  [switch]$NoCapture,
  [switch]$NoPrereqCheck
)

$ErrorActionPreference = "Stop"

function Test-RedisReachable {
  param([string]$Url)

  if ($NoPrereqCheck) { return $true }

  # Best-effort: use redis-cli if available; otherwise just skip the check.
  $redisCli = (Get-Command redis-cli -ErrorAction SilentlyContinue)
  if (-not $redisCli) {
    Write-Host "PrereqCheck: redis-cli not found; skipping Redis ping check."
    return $true
  }

  try {
    $out = & $redisCli.Source -u $Url PING 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    return ($out -match "PONG")
  } catch {
    return $false
  }
}

Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  if ($Repeat -lt 1) { $Repeat = 1 }

  if ([string]::IsNullOrWhiteSpace($KeyPrefix)) {
    $KeyPrefix = "lingua_ws_e2e_" + (Get-Random)
  }

  Write-Host "== Phase2 WS E2E (mock node+session, real websockets) =="
  Write-Host "RedisUrl  : $RedisUrl"
  Write-Host "KeyPrefix : $KeyPrefix (passed into env LINGUA_TEST_KEY_PREFIX)"
  Write-Host "Repeat    : $Repeat"
  Write-Host ""
  Write-Host "Info: This test starts two scheduler instances (in-process)."
  Write-Host "      Node connects to A; Session connects to B; verifies cross-instance Streams routing."
  Write-Host "Prereq: Redis must be reachable (default: $RedisUrl)."
  Write-Host ""

  if (-not (Test-RedisReachable -Url $RedisUrl)) {
    throw "Redis prereq check failed: cannot PING $RedisUrl"
  }

  $env:LINGUA_TEST_PHASE2_WS_E2E = "1"
  $env:LINGUA_TEST_REDIS_MODE = "single"
  $env:LINGUA_TEST_REDIS_URL = $RedisUrl

  # The test reads this env (if set) to build a deterministic Redis key prefix.
  $env:LINGUA_TEST_KEY_PREFIX = $KeyPrefix

  $args = @("test", "-q", "phase2_ws_e2e_real_websocket_minimal")
  if (-not $NoCapture) {
    $args += @("--", "--nocapture")
  }

  for ($i = 1; $i -le $Repeat; $i++) {
    Write-Host ("--- Run {0}/{1} ---" -f $i, $Repeat)
    & cargo @args
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
}
finally {
  Pop-Location
}


