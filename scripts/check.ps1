# Keep dependency caches, build output and temporary files inside the repository.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$env:CARGO_HOME = Join-Path $repoRoot '.build/cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $repoRoot 'target'
$env:TEMP = Join-Path $repoRoot '.build/tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
function Invoke-CargoCheck {
    param([string[]]$CargoArguments)
    # Windows PowerShell treats redirected native stderr as ErrorRecord objects.
    $ErrorActionPreference = 'Continue'
    & cargo @CargoArguments 2>&1 | ForEach-Object { $_.ToString() }
    if ($LASTEXITCODE -ne 0) { throw "cargo $($CargoArguments -join ' ') failed" }
}
function Invoke-Client {
    param([string[]]$PnpmArguments)
    $ErrorActionPreference = 'Continue'
    & pnpm --dir (Join-Path $repoRoot 'apps/desktop/client') @PnpmArguments 2>&1 | ForEach-Object { $_.ToString() }
    if ($LASTEXITCODE -ne 0) { throw "pnpm $($PnpmArguments -join ' ') failed" }
}
Push-Location $repoRoot
try {
    # The Tauri shell embeds apps/desktop/client/dist at compile time: build the client first.
    Invoke-Client -PnpmArguments @('install', '--frozen-lockfile')
    Invoke-Client -PnpmArguments @('typecheck')
    Invoke-Client -PnpmArguments @('test')
    Invoke-Client -PnpmArguments @('build')
    Invoke-CargoCheck -CargoArguments @('fmt', '--all', '--check')
    Invoke-CargoCheck -CargoArguments @('clippy', '--workspace', '--all-targets', '--', '-D', 'warnings')
    Invoke-CargoCheck -CargoArguments @('test', '--workspace')
} finally { Pop-Location }
