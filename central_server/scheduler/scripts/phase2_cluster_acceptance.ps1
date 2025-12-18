param(
  [string]$ProjectName = "lingua-scheduler-cluster-acceptance"
)

$ErrorActionPreference = "Stop"

$compose = Join-Path $PSScriptRoot "redis_cluster\docker-compose.yml"

Write-Host "Phase2 cluster acceptance"
Write-Host "  compose : $compose"
Write-Host "  project : $ProjectName"
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "docker not found in PATH"
}

Write-Host "1) Start Redis Cluster (3 masters) ..."
docker compose -p $ProjectName -f $compose up -d --remove-orphans

Write-Host "2) Run scheduler-tests (cargo test -q phase2_cluster_acceptance_smoke) ..."
docker compose -p $ProjectName -f $compose run --rm scheduler-tests

Write-Host ""
Write-Host "Done. Cleanup:"
Write-Host "  docker compose -p $ProjectName -f $compose down -v"


