# Read-only freeze identity verification — does NOT modify the repository.
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
Write-Host "Mode=READ_ONLY_IDENTITY_VERIFY"

# --- 1–4 Tag existence, annotated, object + peel ---
git rev-parse -q --verify "refs/tags/$Tag" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Bad "Tag $Tag not found"
  Write-Host "VERIFY_FREEZE_IDENTITY_FAIL count=$fail" -ForegroundColor Red
  exit 1
}

$tagType = (git cat-file -t $Tag).Trim()
if ($tagType -eq "tag") { Ok "Tag is annotated (type=tag)" }
else { Bad "Tag type=$tagType expected annotated tag" }

$tagObjectSha = (git rev-parse $Tag).Trim()
$freezeCommitSha = (git rev-list -n 1 $Tag).Trim()
Write-Host "TAG_OBJECT_SHA=$tagObjectSha"
Write-Host "FREEZE_COMMIT_SHA=$freezeCommitSha"
Ok "Tag Object SHA resolved"
Ok "Peeled Freeze Commit SHA resolved"

# --- 5 resolved_identity.json ---
$resolvedPath = Join-Path $PSScriptRoot "resolved_identity.json"
if (-not (Test-Path $resolvedPath)) {
  Bad "resolved_identity.json missing"
} else {
  $resolved = Get-Content $resolvedPath -Raw | ConvertFrom-Json
  if ($resolved.tagObjectSha -eq $tagObjectSha) { Ok "resolved_identity.tagObjectSha matches Git" }
  else { Bad "resolved_identity.tagObjectSha=$($resolved.tagObjectSha) != $tagObjectSha" }
  if ($resolved.freezeCommitSha -eq $freezeCommitSha) { Ok "resolved_identity.freezeCommitSha matches Git" }
  else { Bad "resolved_identity.freezeCommitSha=$($resolved.freezeCommitSha) != $freezeCommitSha" }
  if ($resolved.tagStability -and $resolved.tagStability.tagMoved -eq $false) {
    if ($resolved.tagStability.freezeCommitBefore -eq $freezeCommitSha -and $resolved.tagStability.freezeCommitAfter -eq $freezeCommitSha) {
      Ok "tagStability: Freeze Tag not moved"
    } else {
      Bad "tagStability freezeCommit before/after mismatch vs peel"
    }
  } else {
    Bad "tagStability.tagMoved must be false"
  }
}

# --- baseline_identity static peel ---
$identityPath = Join-Path $PSScriptRoot "baseline_identity.json"
if (-not (Test-Path $identityPath)) {
  Bad "baseline_identity.json missing"
} else {
  $id = Get-Content $identityPath -Raw | ConvertFrom-Json
  if ($id.gitCommit -eq "RESOLVE_FROM_TAG" -or $id.gitCommit -eq "PENDING_FREEZE_COMMIT") {
    Bad "baseline_identity.gitCommit still unresolved ($($id.gitCommit))"
  } elseif ($id.gitCommit -eq $freezeCommitSha) {
    Ok "baseline_identity.gitCommit == FREEZE_COMMIT_SHA"
  } else {
    Bad "baseline_identity.gitCommit=$($id.gitCommit) != FREEZE_COMMIT_SHA $freezeCommitSha"
  }
  if ($id.tagObjectSha -and $id.tagObjectSha -eq $tagObjectSha) {
    Ok "baseline_identity.tagObjectSha matches"
  } elseif (-not $id.tagObjectSha) {
    Bad "baseline_identity.tagObjectSha missing"
  } else {
    Bad "baseline_identity.tagObjectSha mismatch"
  }
}

# --- 6 content_manifest ---
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

# --- 7 production KenLM ---
$kenlm = Join-Path $RepoRoot "kenLM\model\zh_char_3gram.trie.bin"
if (Test-Path $kenlm) {
  $kh = (Get-FileHash $kenlm -Algorithm SHA256).Hash
  if ($kh -eq $ExpectedKenlmSha) { Ok "Production KenLM SHA matches" }
  else { Bad "Production KenLM SHA $kh != $ExpectedKenlmSha" }
} else {
  Bad "Production KenLM trie not found"
}

# --- 8 CURRENT SSOT present ---
$ssot = @(
  "docs/current/INDEX.md",
  "docs/framework_snapshots/FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05/FRAMEWORK_FREEZE_SUMMARY.md",
  "docs/fw-detector/assembly/FROZEN_V1_2.md",
  "docs/fw-detector/INTERFACE_FREEZE.md",
  "docs/fw-detector/kenlm/KENLM_RUNTIME.md",
  "docs/fw-detector/freeze/FROZEN.md"
)
foreach ($p in $ssot) {
  if (Test-Path (Join-Path $RepoRoot $p)) { Ok "SSOT present: $p" } else { Bad "SSOT missing: $p" }
}

# --- 9 runtime_behavior_seal all false ---
$sealPath = Join-Path $PSScriptRoot "runtime_behavior_seal.json"
if (-not (Test-Path $sealPath)) {
  Bad "runtime_behavior_seal.json missing"
} else {
  $seal = Get-Content $sealPath -Raw | ConvertFrom-Json
  $keys = @(
    "candidateTextChanged","candidateCountChanged","candidateOrderChanged","candidateIdChanged",
    "crossPathChanged","kenlmInputChanged","kenlmScoreChanged","finalPickChanged",
    "jobResultChanged","productionKenlmReplaced"
  )
  $allFalse = $true
  foreach ($k in $keys) {
    if ($seal.$k -ne $false) {
      Bad "runtime_behavior_seal.$k = $($seal.$k) (expected false)"
      $allFalse = $false
    }
  }
  if ($allFalse) { Ok "runtime_behavior_seal all unchanged (false)" }
}

# --- 10 no repo mutation by this script (informational) ---
Ok "Script performed no git write / file write-back operations"

if ($fail -eq 0) {
  Write-Host "VERIFY_FREEZE_IDENTITY_PASS" -ForegroundColor Green
  exit 0
} else {
  Write-Host "VERIFY_FREEZE_IDENTITY_FAIL count=$fail" -ForegroundColor Red
  exit 1
}
