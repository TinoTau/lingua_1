param(
  [string]$RedisUrl = "redis://127.0.0.1:6379",
  [int]$WsE2ERepeat = 1,
  [switch]$SkipWsE2E,
  [switch]$RunClusterAcceptance,
  [switch]$NoCapture
)

$ErrorActionPreference = "Stop"

function Info([string]$msg) { Write-Host ("[INFO]  " + $msg) -ForegroundColor Cyan }
function Warn([string]$msg) { Write-Host ("[WARN]  " + $msg) -ForegroundColor Yellow }
function Fail([string]$msg) { Write-Host ("[ERROR] " + $msg) -ForegroundColor Red; exit 1 }

Info "Release gate: lingua-scheduler"
Info ("PWD: " + (Get-Location))
Info ("RedisUrl: " + $RedisUrl)
Info ("WsE2ERepeat: " + $WsE2ERepeat)
Info ("RunClusterAcceptance: " + $RunClusterAcceptance)

# 1) Unit + integration tests
Info "Step 1/3: cargo test -q"
& cargo test -q
if ($LASTEXITCODE -ne 0) { Fail "cargo test failed" }

# 2) Phase2 WS E2E (real websockets, mock node+session)
if (-not $SkipWsE2E) {
  Info "Step 2/3: Phase2 WS E2E"
  $args = @("-RedisUrl", $RedisUrl, "-Repeat", $WsE2ERepeat, "-NoPrereqCheck")
  if ($NoCapture) { $args += "-NoCapture" }
  & "$PSScriptRoot\phase2_ws_e2e.ps1" @args
  if ($LASTEXITCODE -ne 0) { Fail "phase2_ws_e2e failed" }
} else {
  Warn "Step 2/3 skipped: Phase2 WS E2E"
}

# 3) Optional: Phase2 cluster acceptance (requires Docker)
if ($RunClusterAcceptance) {
  Info "Step 3/3: Phase2 cluster acceptance"
  & "$PSScriptRoot\phase2_cluster_acceptance.ps1"
  if ($LASTEXITCODE -ne 0) { Fail "phase2_cluster_acceptance failed" }
} else {
  Warn "Step 3/3 skipped: cluster acceptance"
}

Info "Release gate PASSED"


