param(
  [string]$EnvDir = $env:OAK_ENV_DIR,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $EnvDir) {
  $EnvDir = "D:\Coding\my-oak-research-env"
  Write-Host "OAK_ENV_DIR is not set, fallback to: $EnvDir"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $repoRoot "config/env"
if (-not (Test-Path $sourceDir)) {
  Write-Error "Missing source directory: $sourceDir"
}

New-Item -ItemType Directory -Path $EnvDir -Force | Out-Null

$map = @(
  @{ Src = ".env.common.example"; Dst = ".env.common" },
  @{ Src = ".env.apps.web.example"; Dst = ".env.apps.web" },
  @{ Src = ".env.apps.worker.example"; Dst = ".env.apps.worker" },
  @{ Src = ".env.apps.gather.example"; Dst = ".env.apps.gather" }
)

foreach ($item in $map) {
  $src = Join-Path $sourceDir $item.Src
  $dst = Join-Path $EnvDir $item.Dst

  if (-not (Test-Path $src)) {
    continue
  }

  if ((Test-Path $dst) -and -not $Force) {
    Write-Host "skip: $dst"
    continue
  }

  Copy-Item -Path $src -Destination $dst -Force
  Write-Host "write: $dst"
}

Write-Host "Done. Shared env dir: $EnvDir"
