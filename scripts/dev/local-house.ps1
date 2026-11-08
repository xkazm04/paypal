# Local co-hosted HOUSE seller + rendezvous for automated e2e (sandbox money only).
#
#   ./scripts/dev/local-house.ps1            start (fresh throwaway keys, fresh ledger), print public info
#   ./scripts/dev/local-house.ps1 -Stop      stop the process this script started
#
# Throwaway Ed25519 seeds live only in this process's environment (and the child's). Nothing
# private is written to disk or printed. PayPal SANDBOX credentials are read from
# scripts/sandbox/.env.sandbox into the child's environment and never printed.
# Persisted under .build/local-house/ (gitignored): ledger, logs, pid, PUBLIC release json.
param(
    [int]$Port = 8787,
    [switch]$Stop,
    [string]$Item = 'monitor',
    [long]$FloorMinor = 1000,
    [long]$AskMinor = 2500,
    [long]$HumanOverMinor = 2500
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$work = Join-Path $repo '.build/local-house'
$pidFile = Join-Path $work 'house.pid'
New-Item -ItemType Directory -Force -Path $work | Out-Null

if ($Stop) {
    if (Test-Path $pidFile) {
        $p = [int](Get-Content $pidFile)
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Remove-Item $pidFile -Force
        'stopped local house (pid {0})' -f $p
    } else { 'no local house pid file' }
    return
}

# Own build dirs: never lock the main target dir.
$env:CARGO_TARGET_DIR = Join-Path $repo 'target-house'
$env:CARGO_HOME = Join-Path $repo '.build/cargo-home'
$env:TEMP = Join-Path $repo '.build/tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
Push-Location $repo
try {
    if (Test-Path $pidFile) { & $PSCommandPath -Stop | Out-Null }

    # Sandbox credentials (names only are ever mentioned).
    $envFile = Join-Path $repo 'scripts/sandbox/.env.sandbox'
    if (-not (Test-Path $envFile)) { throw 'scripts/sandbox/.env.sandbox is missing' }
    $sb = @{}
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $sb[$Matches[1]] = $Matches[2].Trim('"', "'") }
    }
    foreach ($k in 'PAYPAL_SANDBOX_CLIENT_ID', 'PAYPAL_SANDBOX_SECRET', 'PAYPAL_SANDBOX_MERCHANT_ID') {
        if (-not $sb[$k]) { throw "$k is not set in .env.sandbox" }
    }

    # Build the offline helpers and the server binary (first without the pin).
    & cargo build --quiet -p house-seller --bins
    if ($LASTEXITCODE -ne 0) { throw 'cargo build house-seller failed' }
    $bin = Join-Path $env:CARGO_TARGET_DIR 'debug'

    # (a) two fresh, distinct seeds, in memory only.
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    function New-Seed { $b = New-Object byte[] 32; $rng.GetBytes($b); [Convert]::ToBase64String($b) }
    $env:HOUSE_OWNER_KEY_BASE64 = New-Seed
    $env:HOUSE_AGENT_KEY_BASE64 = New-Seed

    # ULID for the mandate id (Crockford base32: 48-bit ms time + 80 random bits).
    function New-Ulid {
        $alpha = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
        $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $r = New-Object byte[] 10; $rng.GetBytes($r)
        [System.Numerics.BigInteger]$n = $ms
        foreach ($x in $r) { $n = ($n * 256) + $x }
        $s = ''
        for ($i = 0; $i -lt 26; $i++) { $s = $alpha[[int]($n % 32)] + $s; $n = [System.Numerics.BigInteger]::Divide($n, 32) }
        $s
    }

    # (b) sandbox-friendly seller mandate, signed offline, in memory.
    $agentPub = (& (Join-Path $bin 'house-public-key.exe')) -join ''
    if ($LASTEXITCODE -ne 0) { throw 'house-public-key failed' }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $exp = $now + 7 * 86400
    function Money($m) { [ordered]@{ minor = $m; currency = 'USD' } }
    $payload = [ordered]@{
        id = New-Ulid; version = 1
        agent_key = [int[]]($agentPub.Trim().Trim('[', ']').Split(','))
        clauses = @(
            [ordered]@{ type = 'roles'; roles = @('sell') },
            [ordered]@{ type = 'counterparties'; rule = [ordered]@{ type = 'paired' } },
            [ordered]@{ type = 'per_deal'; kind = 'haggle'; max_amount = (Money $AskMinor); categories = @('parts') },
            [ordered]@{ type = 'band'; item_refs = @($Item); floor = (Money $FloorMinor); ceiling = (Money $AskMinor); max_rounds = 6; deadline = $exp },
            [ordered]@{ type = 'velocity'; max_deals_day = 20; max_total_day = (Money 100000) },
            [ordered]@{ type = 'human_present_over'; amount = (Money $HumanOverMinor) },
            [ordered]@{ type = 'payees'; payees = @($sb['PAYPAL_SANDBOX_MERCHANT_ID']) }
        )
        not_before = $now - 60; expires = $exp
    }
    $env:HOUSE_MANDATE_PAYLOAD_JSON = $payload | ConvertTo-Json -Depth 10 -Compress
    $env:HOUSE_MANDATE_JSON = (& (Join-Path $bin 'house-sign.exe')) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'house-sign failed (mandate payload refused)' }
    Remove-Item Env:HOUSE_MANDATE_PAYLOAD_JSON
    $release = (& (Join-Path $bin 'house-release.exe')) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'house-release failed' }
    $env:TABLE_HOUSE_RELEASE_JSON = $release           # public compile pin, same for server + wallet
    [System.IO.File]::WriteAllText((Join-Path $work 'release.public.json'), $release, (New-Object System.Text.UTF8Encoding $false))

    # (c) rebuild the server with the pin, then start it detached on localhost.
    & cargo build --quiet -p house-seller --bin house-seller
    if ($LASTEXITCODE -ne 0) { throw 'cargo build house-seller (pinned) failed' }
    $ledger = Join-Path $work 'house.ledger.sqlite3'
    Get-ChildItem $work -Filter 'house.ledger.sqlite3*' | Remove-Item -Force
    $env:HOUSE_LEDGER_PATH = $ledger
    $env:HOUSE_PAYPAL_CLIENT_ID = $sb['PAYPAL_SANDBOX_CLIENT_ID']
    $env:HOUSE_PAYPAL_CLIENT_SECRET = $sb['PAYPAL_SANDBOX_SECRET']
    $env:PORT = "$Port"
    $proc = Start-Process -FilePath (Join-Path $bin 'house-seller.exe') -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $work 'house.out.log') -RedirectStandardError (Join-Path $work 'house.err.log')
    Set-Content $pidFile $proc.Id
    foreach ($n in 'HOUSE_OWNER_KEY_BASE64', 'HOUSE_AGENT_KEY_BASE64', 'HOUSE_MANDATE_JSON',
        'HOUSE_PAYPAL_CLIENT_ID', 'HOUSE_PAYPAL_CLIENT_SECRET') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }

    $ok = $false
    foreach ($i in 1..40) {
        Start-Sleep -Milliseconds 500
        if ($proc.HasExited) { throw "house exited early; see $work\house.err.log" }
        try { if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/healthz" -TimeoutSec 2).StatusCode -eq 200) { $ok = $true; break } } catch {}
    }
    if (-not $ok) { throw "healthz never answered; see $work\house.err.log" }

    # (d) public info only.
    $relayUrl = "http://127.0.0.1:$Port/"
    $pub = $release | ConvertFrom-Json
    "local HOUSE up, pid $($proc.Id), healthz 200"
    "TABLE_RELAY_URL=$relayUrl"
    "public release json: $work\release.public.json"
    "owner public key: $(($pub.owner_key) -join ',')"
    "agent public key: $(($pub.agent_key) -join ',')"
    "payee (public sandbox merchant ref): $($pub.payee)"
    ''
    '# (e) build + launch the wallet (debug) against it:'
    '$env:CARGO_TARGET_DIR = "<repo>\target-house"; $env:CARGO_HOME = "<repo>\.build\cargo-home"'
    '$env:TABLE_HOUSE_RELEASE_JSON = (Get-Content <repo>\.build\local-house\release.public.json -Raw)'
    'cargo build -p table-desktop'
    '$env:TABLE_RELAY_URL = "' + $relayUrl + '"; $env:TABLE_E2E_ALLOW_HTTP_RELAY = "1"'
    '& <repo>\target-house\debug\table-desktop.exe'
    "Stop: ./scripts/dev/local-house.ps1 -Stop"
}
finally { Pop-Location }
