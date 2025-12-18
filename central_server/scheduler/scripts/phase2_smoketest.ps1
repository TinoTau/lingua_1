$ErrorActionPreference = "Stop"

param(
  [string]$RedisUrl = "redis://127.0.0.1:6379",
  [string]$KeyPrefix = "lingua_smoke",
  [int]$PortA = 5011,
  [int]$PortB = 5012
)

Write-Host "Phase2 smoke test (manual): start two scheduler instances with Redis Streams routing enabled"
Write-Host "  RedisUrl  : $RedisUrl"
Write-Host "  KeyPrefix : $KeyPrefix"
Write-Host "  Ports     : $PortA / $PortB"

function New-SchedulerConfigToml {
  param(
    [int]$Port,
    [string]$KeyPrefix,
    [string]$RedisUrl,
    [string]$InstanceId
  )

@"
[server]
port = $Port
host = "0.0.0.0"

[model_hub]
base_url = "http://localhost:5000"
storage_path = "./models"

[scheduler]
max_concurrent_jobs_per_node = 4
job_timeout_seconds = 30
heartbeat_interval_seconds = 15

[scheduler.phase2]
enabled = true
instance_id = "$InstanceId"
owner_ttl_seconds = 45
stream_block_ms = 1000
stream_count = 64
stream_group = "scheduler"

[scheduler.phase2.redis]
mode = "single"
url = "$RedisUrl"
key_prefix = "$KeyPrefix"
"@
}

$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $root "scripts\.tmp_phase2"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$cfgA = Join-Path $tmp "config-a.toml"
$cfgB = Join-Path $tmp "config-b.toml"

New-SchedulerConfigToml -Port $PortA -KeyPrefix $KeyPrefix -RedisUrl $RedisUrl -InstanceId "sched-a" | Set-Content -Encoding UTF8 $cfgA
New-SchedulerConfigToml -Port $PortB -KeyPrefix $KeyPrefix -RedisUrl $RedisUrl -InstanceId "sched-b" | Set-Content -Encoding UTF8 $cfgB

Write-Host "Configs written:"
Write-Host "  $cfgA"
Write-Host "  $cfgB"
Write-Host ""
Write-Host "Next steps (manual):"
Write-Host "  1) In TWO terminals, run:"
Write-Host "     - cd $root; Copy-Item $cfgA .\\config.toml -Force; cargo run -q"
Write-Host "     - cd $root; Copy-Item $cfgB .\\config.toml -Force; cargo run -q"
Write-Host "  2) Connect a node to one instance, and a session to the other, then send an utterance."
Write-Host "     Expectation: job dispatch/result should still work via Redis Streams."
Write-Host ""
Write-Host "Tip: you can set `LINGUA_TEST_REDIS_URL=$RedisUrl` then run `cargo test -q` to include the Redis smoke test."


