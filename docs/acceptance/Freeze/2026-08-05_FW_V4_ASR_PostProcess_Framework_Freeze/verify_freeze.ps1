# Read-only freeze verification — does NOT modify the repository.
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
  [string]$Tag = "FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05",
  [string]$ExpectedKenlmSha = "532A335A09A006D1BA674F808814EE1D40C5B1D8F3527CA980E96723E7A62A4C"
)

$ErrorActionPreference = "Stop"
Set-Location $RepoRoot
$fail = 0

function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Bad($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; $script:fail++ }

Write-Host "RepoRoot=$RepoRoot"
Write-Host "Tag=$Tag"

git rev-parse -q --verify "refs/tags/$Tag" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  $tagCommit = (git rev-list -n 1 $Tag).Trim()
  Ok "Tag exists → $tagCommit"
  $identityPath = Join-Path $PSScriptRoot "baseline_identity.json"
  if (Test-Path $identityPath) {
    $id = Get-Content $identityPath -Raw | ConvertFrom-Json
    if ($id.gitCommit -eq "RESOLVE_FROM_TAG" -or $id.gitCommit -eq $tagCommit) {
      Ok "baseline_identity accepts tag peel ($tagCommit)"
    } elseif ($id.gitCommit -eq "PENDING_FREEZE_COMMIT") {
      Bad "baseline_identity.gitCommit still PENDING"
    } else {
      Bad "baseline_identity.gitCommit=$($id.gitCommit) != tag $tagCommit"
    }
  } else {
    Bad "baseline_identity.json missing"
  }
} else {
  Bad "Tag $Tag not found"
}

$ssot = @(
  "docs/current/INDEX.md",
  "docs/framework_snapshots/FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05/FRAMEWORK_FREEZE_SUMMARY.md",
  "docs/fw-detector/assembly/FROZEN_V1_2.md",
  "docs/fw-detector/INTERFACE_FREEZE.md",
  "docs/fw-detector/kenlm/KENLM_RUNTIME.md"
)
foreach ($p in $ssot) {
  if (Test-Path (Join-Path $RepoRoot $p)) { Ok "SSOT present: $p" } else { Bad "SSOT missing: $p" }
}

$manifest = Join-Path $PSScriptRoot "content_manifest.csv"
if (Test-Path $manifest) {
  $rows = Import-Csv $manifest
  foreach ($r in $rows) {
    if ($r.freezeStatus -ne "FROZEN") { continue }
    $abs = Join-Path $RepoRoot $r.relativePath
    if (-not (Test-Path $abs)) {
      if ($r.fileType -eq "kenlm_model") { Bad "KenLM model missing: $($r.relativePath)" }
      else { Bad "Manifest path missing: $($r.relativePath)" }
      continue
    }
    $h = (Get-FileHash $abs -Algorithm SHA256).Hash.ToLower()
    if ($h -eq $r.sha256.ToLower()) { Ok "SHA match $($r.relativePath)" }
    else { Bad "SHA mismatch $($r.relativePath)" }
  }
} else {
  Bad "content_manifest.csv missing"
}

$kenlm = Join-Path $RepoRoot "kenLM\model\zh_char_3gram.trie.bin"
if (Test-Path $kenlm) {
  $kh = (Get-FileHash $kenlm -Algorithm SHA256).Hash
  if ($kh -eq $ExpectedKenlmSha) { Ok "Production KenLM SHA matches" }
  else { Bad "Production KenLM SHA $kh != $ExpectedKenlmSha" }
} else {
  Bad "Production KenLM trie not found"
}

if ($fail -eq 0) {
  Write-Host "VERIFY_FREEZE_PASS" -ForegroundColor Green
  exit 0
} else {
  Write-Host "VERIFY_FREEZE_FAIL count=$fail" -ForegroundColor Red
  exit 1
}
