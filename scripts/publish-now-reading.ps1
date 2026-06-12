$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Invoke-Checked {
  param([Parameter(Mandatory = $true)][scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

Invoke-Checked { node scripts/update-now-reading.js }
Invoke-Checked { node scripts/generate-index.js }

$changes = git status --short
if (-not $changes) {
  Write-Host "No now-reading changes to publish."
  exit 0
}

git add index.html now-reading/index.html scripts/generate-index.js scripts/update-now-reading.js scripts/publish-now-reading.ps1

$staged = git diff --cached --name-only
if (-not $staged) {
  Write-Host "No staged now-reading changes to publish."
  exit 0
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
Invoke-Checked { git commit -m "Update now reading page ($timestamp)" }
Invoke-Checked { git push origin main }
