# Loads scripts/sandbox/.env.sandbox into this process only, runs preflight, then the live sandbox tests.
param([string]$EnvFile = (Join-Path $PSScriptRoot '.env.sandbox'), [int[]]$Spikes = @(3,4,5,8))
$ErrorActionPreference = 'Continue'  # cargo writes progress to stderr
Get-Content -LiteralPath $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$' -and -not $_.TrimStart().StartsWith('#')) {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"',"'"))
    }
}
node (Join-Path $PSScriptRoot 'preflight.mjs') $EnvFile
if ($LASTEXITCODE -ne 0) { throw 'preflight failed' }
$env:TABLE_LIVE_SANDBOX = '1'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $root
try {
    & (Join-Path $root 'scripts/cargo.ps1') -CargoArgs @('test','-p','table-paypal','--test','client','--','--ignored','--nocapture','--test-threads=1')
    foreach ($s in $Spikes) {
        if ($s -eq 8 -and -not $env:PAYPAL_SANDBOX_INVOICE_EMAIL) { Write-Warning 'skip spike 8: no invoice email'; continue }
        & (Join-Path $root 'scripts/spike.ps1') -Spike $s
    }
} finally { Pop-Location }
