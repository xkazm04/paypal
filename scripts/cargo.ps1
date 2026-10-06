param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CargoArgs)
$repoRoot = Split-Path -Parent $PSScriptRoot
$env:CARGO_HOME = Join-Path $repoRoot '.build/cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $repoRoot 'target'
$env:TEMP = Join-Path $repoRoot '.build/tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
& cargo @CargoArgs
exit $LASTEXITCODE
